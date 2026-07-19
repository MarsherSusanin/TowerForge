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
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-e2e-"));
  projectDir = path.join(tmpRoot, "starter.tdproj");
  fs.cpSync(path.join(repoRoot, "examples", "starter.tdproj"), projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, "imports"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "imports", "tower.png"), Buffer.from(
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

  await page.addInitScript(() => localStorage.setItem("towerforge:welcomed", "1"));
  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/TowerForge Editor/);
  await expect(page.getByText("TowerForge Editor", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /AI Designer/ }).click();
  await expect(page.locator("#ai-provider")).toHaveValue("codex");
  await expect(page.locator("#ai-provider option")).toHaveText([
    "Codex (ChatGPT)",
    "Claude Code",
    "Anthropic API",
    "OpenAI API",
    "OpenRouter"
  ]);
  await page.locator("#ai-provider").selectOption("openai");
  await expect(page.locator("#ai-model")).toHaveValue("gpt-5.6-terra");
  await expect(page.locator("#ai-model option")).toContainText(["GPT-5.6 Terra (balanced)", "GPT-5.6 Sol (deep)", "GPT-5.6 Luna (cheap)"]);
  await page.locator("#ai-key-input").fill("openai-e2e-key");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("button", { name: "Key saved" })).toBeVisible();
  await page.getByRole("button", { name: "Add custom model" }).click();
  await page.locator("#ai-model-input").fill("gpt-custom-towerforge");
  await page.getByRole("button", { name: "Add model" }).click();
  await expect(page.locator("#ai-model")).toHaveValue("gpt-custom-towerforge");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("towerforge:ai-keys")))).toEqual({ openai: "openai-e2e-key" });

  await page.getByRole("tab", { name: /Maps/ }).click();
  await expect(page.getByText("Map Authoring")).toBeVisible();
  const originalPath = JSON.parse(await page.locator("#map-path-field").inputValue());
  await page.locator("#map-paint-mode").selectOption("path");

  await clickHexTile(page, "#map-editor-canvas", { q: 7, r: 9 }, { width: 15, height: 20 });
  await expect.poll(async () => JSON.parse(await page.locator("#map-path-field").inputValue()).length).toBe(originalPath.length - 1);

  await page.getByRole("button", { name: "Clear route" }).click();
  await page.locator("#confirm-overlay").getByRole("button", { name: "Clear route" }).click();
  await expect.poll(async () => JSON.parse(await page.locator("#map-path-field").inputValue())).toEqual([]);

  await clickHexTile(page, "#map-editor-canvas", { q: 6, r: 0 }, { width: 15, height: 20 });
  await clickHexTile(page, "#map-editor-canvas", { q: 6, r: 1 }, { width: 15, height: 20 });
  await expect.poll(async () => JSON.parse(await page.locator("#map-path-field").inputValue())).toEqual([{ q: 6, r: 0 }, { q: 6, r: 1 }]);

  await page.locator("#map-path-field").fill(JSON.stringify(originalPath));
  await page.locator("#map-path-field").blur();
  await expect.poll(async () => JSON.parse(await page.locator("#map-path-field").inputValue())).toEqual(originalPath);
  await page.getByRole("button", { name: "Compile Maps" }).click();
  await expect(page.getByText("Maps compiled.")).toBeVisible();

  await page.getByRole("tab", { name: /Playtest/ }).click();
  await expect(page.locator("#playtest-canvas")).toBeVisible();
  await clickHexTile(page, "#playtest-canvas", { q: 12, r: 8 }, { width: 15, height: 20 });
  await expect(page.locator("#pt-towers-count")).toHaveText("1");

  await page.getByRole("tab", { name: /Assets/ }).click();
  await page.locator("#asset-source-path").fill("imports/tower.png");
  await page.locator("#asset-target-path").fill("sprites/tower.png");
  await page.locator("#asset-id").fill("tower");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported tower.")).toBeVisible();

  const validateResponse = await request.get(`${studioUrl}/api/validate`);
  expect(validateResponse.ok()).toBe(true);
  const validation = await validateResponse.json();
  expect(validation.ok).toBe(true);

  await page.getByRole("tab", { name: /Build Targets/ }).click();
  await page.locator(".btn-target-build").first().click();
  await expect(page.getByText("Build completed.")).toBeVisible({ timeout: 30_000 });
  expect(fs.existsSync(path.join(projectDir, "dist", "assets", "sprites", "tower.png"))).toBe(true);

  playerServer = await startStaticServer(path.join(projectDir, "dist"), playerPort);
  const playerPage = await browser.newPage();
  const playerConsole = [];
  playerPage.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) playerConsole.push(`${message.type()}: ${message.text()}`);
  });
  await playerPage.goto(playerUrl);
  await expect(playerPage.getByRole("heading", { name: /Starter Tower Defense|TowerForge/i })).toBeVisible();
  await expect(playerPage.locator("#playfield")).toBeVisible();
  await playerPage.locator("#start-wave").click();
  await playerPage.locator("#playfield").click({ position: { x: 180, y: 180 } });
  await expect(playerPage.locator("#stat-wave")).not.toHaveText("-");
  expect(await canvasHasPixels(playerPage)).toBe(true);
  expect(playerConsole).toEqual([]);
  expect(consoleMessages).toEqual([]);
});

test("desktop command bridge drives navigation and guards unsaved changes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("towerforge:welcomed", "1"));
  await page.goto(studioUrl);

  await dispatchDesktopCommand(page, "navigate.ai");
  await expect(page.getByRole("tab", { name: /AI Designer/ })).toHaveClass(/active/);

  await dispatchDesktopCommand(page, "navigate.settings");
  await page.locator("#setting-project-name").fill("DesktopMenuDraft");
  await page.locator("#setting-project-name").blur();
  await expect(page.locator("#dirty-badge")).toHaveClass(/visible/);

  await dispatchDesktopCommand(page, "lifecycle.close");
  await expect(page.locator("#unsaved-overlay")).toBeVisible();
  await page.locator("#unsaved-overlay").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#unsaved-overlay")).toBeHidden();
  await expect(page.locator("#dirty-badge")).toHaveClass(/visible/);

  await dispatchDesktopCommand(page, "file.save");
  await expect(page.locator("#dirty-badge")).not.toHaveClass(/visible/);

  await dispatchDesktopCommand(page, "project.validate");
  await expect(page.locator("#validation-overlay")).toBeVisible();
  await page.locator("#btn-close-validation").click();

  await dispatchDesktopCommand(page, "view.command_palette");
  await expect(page.locator("#cmdk-overlay")).toBeVisible();
  await dispatchDesktopCommand(page, "view.command_palette");
  await expect(page.locator("#cmdk-overlay")).toBeHidden();
});

test("sidebar exposes app info and persists its collapsed state", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("towerforge:welcomed", "1"));
  await page.goto(studioUrl);

  await expect(page.locator("#sidebar-version")).toHaveText("v0.1.0");
  await expect(page.locator(".sidebar-copyright")).toHaveText("© Lindforge Studios");
  await page.locator("#sidebar-about").click();
  await expect(page.locator("#about-overlay")).toBeVisible();
  await expect(page.locator("#about-version")).toHaveText("Version 0.1.0");
  await expect(page.locator("#about-source-link")).toHaveAttribute("href", "https://github.com/MarsherSusanin/TowerForge");
  await expect(page.locator("#about-site-link")).toHaveAttribute("href", "https://lindforge.com");
  await expect(page.locator("#about-telegram-link")).toHaveAttribute("href", "https://t.me/lindforge");
  await page.locator("#about-close").click();

  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
  await expect(page.locator("#sidebar-toggle")).toHaveAttribute("aria-label", "Expand navigation");
  await expect(page.getByRole("tab", { name: "Waves" })).toHaveAttribute("title", "Waves");
  await expect.poll(async () => (await page.locator("#sidebar").boundingBox())?.width).toBe(48);
  expect(await page.evaluate(() => localStorage.getItem("towerforge:sidebar-collapsed"))).toBe("1");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "collapsed");
  await page.locator("#sidebar-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-sidebar", "expanded");
});

async function dispatchDesktopCommand(page, id, payload = {}) {
  await page.evaluate(({ commandId, commandPayload }) => {
    window.dispatchEvent(new CustomEvent("towerforge:desktop-command", {
      detail: { id: commandId, ...commandPayload }
    }));
  }, { commandId: id, commandPayload: payload });
}

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

async function clickHexTile(page, selector, coord, mapSize) {
  const canvas = page.locator(selector);
  const position = await canvas.evaluate((element, args) => {
    const radius = Math.min(
      element.width / ((args.mapSize.width + 1) * 1.65),
      element.height / ((args.mapSize.height + 1) * 1.45)
    );
    const x = radius * 1.5 + args.coord.q * radius * 1.48 + (args.coord.r % 2) * radius * 0.74;
    const y = radius * 1.5 + args.coord.r * radius * 1.28;
    const rect = element.getBoundingClientRect();
    return { x: x / (element.width / rect.width), y: y / (element.height / rect.height) };
  }, { coord, mapSize });
  await canvas.click({ position });
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
