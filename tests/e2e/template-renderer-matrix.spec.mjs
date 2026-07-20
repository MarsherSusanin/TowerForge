import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createProject, TEMPLATE_NAMES } from "../../packages/cli/lib/create-project.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = 5190;
const combinations = TEMPLATE_NAMES.flatMap((template) => ["canvas", "phaser"].map((renderer) => ({ template, renderer })));
let tempDir;
let server;

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-browser-matrix-"));
  for (const { template, renderer } of combinations) {
    const { projectDir } = createProject({ name: `${template}_${renderer}`, parentDir: tempDir, templateName: template });
    const targetsPath = path.join(projectDir, "build-targets.json");
    const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
    targets.targets.matrix = { ...targets.targets["web-pwa"], id: "matrix", renderer, webDir: "dist" };
    fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`);
    execFileSync(process.execPath, [path.join(repoRoot, "packages/cli/build.mjs"), "--project", projectDir, "--target", "matrix"], {
      cwd: repoRoot,
      stdio: "ignore",
      env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" }
    });
  }
  server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname).replace(/^\/+/, "");
    const parts = relative.split("/");
    const template = parts.shift();
    const renderer = parts.shift();
    if (!TEMPLATE_NAMES.includes(template) || !["canvas", "phaser"].includes(renderer)) return respond404(response);
    const projectDir = path.join(tempDir, `${template}_${renderer}.tdproj`, "dist");
    const filePath = path.resolve(projectDir, parts.join("/") || "index.html");
    const confined = path.relative(projectDir, filePath);
    if (confined.startsWith("..") || path.isAbsolute(confined) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return respond404(response);
    response.writeHead(200, { "Content-Type": contentType(filePath), "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", (error) => error ? reject(error) : resolve()));
});

test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test("all templates boot and support keyboard placement in both renderers", async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  for (const { template, renderer } of combinations) {
    await page.goto(`http://127.0.0.1:${port}/${template}/${renderer}/`);
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await expect(page.locator("#boot-error")).toBeHidden();
    await expect(page.locator("#difficulty-select option")).toHaveCount(3);
    await expect(page.locator("#meta-upgrades .meta-upgrade")).toHaveCount(3);
    await page.locator("#playfield").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#stat-towers")).toHaveText("1");
    if (renderer === "phaser") await expect(page.locator("#playfield canvas")).toHaveCount(1);
    else await expect(page.locator("canvas#playfield")).toBeVisible();
  }
  expect(browserErrors).toEqual([]);
});

function respond404(response) {
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
}

function contentType(filePath) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  })[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}
