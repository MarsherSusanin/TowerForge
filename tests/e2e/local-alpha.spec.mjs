import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const studioPort = 5184;
const playerPort = 5185;
const studioUrl = `http://127.0.0.1:${studioPort}`;
const playerUrl = `http://127.0.0.1:${playerPort}`;

let tmpRoot;
let projectDir;
let studioProcess;
let playerServer;

test.beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mycelium-e2e-"));
  projectDir = path.join(tmpRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, "imports"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "imports", "spore.png"), Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  ));

  studioProcess = spawn(process.execPath, [path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(studioPort) },
    stdio: "pipe"
  });
  await waitForHttp(`${studioUrl}/api/project`);
});

test.afterAll(async () => {
  playerServer?.close();
  if (studioProcess) {
    studioProcess.kill();
    await new Promise((resolve) => studioProcess.once("exit", resolve));
  }
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("local alpha constructor flow", async ({ page, request, browser }) => {
  const consoleMessages = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
  });

  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/Mycelium Studio/);
  await expect(page.getByText("Mycelium Studio")).toBeVisible();

  await page.getByRole("tab", { name: /Maps/ }).click();
  await expect(page.getByText("Map Authoring")).toBeVisible();
  await page.getByRole("button", { name: "Compile Maps" }).click();
  await expect(page.getByText("Maps compiled.")).toBeVisible();

  await page.getByRole("tab", { name: /Assets/ }).click();
  await page.locator("#asset-source-path").fill("imports/spore.png");
  await page.locator("#asset-target-path").fill("sprites/spore.png");
  await page.locator("#asset-id").fill("spore");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported spore.")).toBeVisible();

  const validateResponse = await request.get(`${studioUrl}/api/validate`);
  expect(validateResponse.ok()).toBe(true);
  const validation = await validateResponse.json();
  expect(validation.ok).toBe(true);

  await page.getByRole("tab", { name: /Build Targets/ }).click();
  await page.locator(".btn-target-build").first().click();
  await expect(page.getByText("Build completed.")).toBeVisible({ timeout: 30_000 });
  expect(fs.existsSync(path.join(projectDir, "dist", "assets", "sprites", "spore.png"))).toBe(true);

  playerServer = await startStaticServer(path.join(projectDir, "dist"), playerPort);
  const playerPage = await browser.newPage();
  const playerConsole = [];
  playerPage.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) playerConsole.push(`${message.type()}: ${message.text()}`);
  });
  await playerPage.goto(playerUrl);
  await expect(playerPage.getByRole("heading", { name: /Starter Tower Defense|Mycelium/i })).toBeVisible();
  await expect(playerPage.locator("#playfield")).toBeVisible();
  await playerPage.locator("#start-wave").click();
  await playerPage.locator("#playfield").click({ position: { x: 180, y: 180 } });
  await expect(playerPage.locator("#stat-wave")).not.toHaveText("-");
  expect(await canvasHasPixels(playerPage)).toBe(true);
  expect(playerConsole).toEqual([]);
  expect(consoleMessages).toEqual([]);
});

async function canvasHasPixels(page) {
  return page.locator("#playfield").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
    return false;
  });
}

function startStaticServer(root, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.resolve(root, "." + decodeURIComponent(requested));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

async function waitForHttp(url) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json") || filePath.endsWith(".webmanifest")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
