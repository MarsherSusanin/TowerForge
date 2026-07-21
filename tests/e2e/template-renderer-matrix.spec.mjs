import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { createProject, TEMPLATE_NAMES } from "../../packages/cli/lib/create-project.mjs";
import { applyThemePack } from "../../packages/cli/lib/theme-packs.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = 5190;
const combinations = TEMPLATE_NAMES.flatMap((template) =>
  ["hex", "square"].flatMap((grid) => ["canvas", "phaser"].map((renderer) => ({ template, grid, renderer })))
);
let tempDir;
let server;

test.beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-browser-matrix-"));
  for (const { template, grid, renderer } of combinations) {
    const { projectDir } = createProject({ name: `${template}_${grid}_${renderer}`, parentDir: tempDir, templateName: template, gridKind: grid });
    const themed = await applyThemePack(projectDir, "verdant-frontier");
    if (!themed.ok) throw new Error(`Could not apply conformance theme to ${template}/${grid}/${renderer}: ${themed.error}`);
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
    const grid = parts.shift();
    const renderer = parts.shift();
    if (!TEMPLATE_NAMES.includes(template) || !["hex", "square"].includes(grid) || !["canvas", "phaser"].includes(renderer)) return respond404(response);
    const projectDir = path.join(tempDir, `${template}_${grid}_${renderer}.tdproj`, "dist");
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

test("all templates boot with real tiles and exact pointer/keyboard placement across grids and renderers", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  for (const { template, grid, renderer } of combinations) {
    const tileResponses = [];
    const responseListener = (response) => { if (/tiles-(?:hex|square)\.png$/.test(new URL(response.url()).pathname) && response.ok()) tileResponses.push(response.url()); };
    page.on("response", responseListener);
    await page.goto(`http://127.0.0.1:${port}/${template}/${grid}/${renderer}/`);
    await page.waitForFunction(() => window.__towerforgeBootOk === true);
    await expect(page.locator("#boot-error")).toBeHidden();
    await expect(page.locator("#difficulty-select option")).toHaveCount(3);
    await expect(page.locator("#meta-upgrades .meta-upgrade")).toHaveCount(3);
    await expect.poll(() => tileResponses.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(100);
    const canvas = renderer === "phaser" ? page.locator("#playfield canvas") : page.locator("canvas#playfield");
    await expect(canvas).toBeVisible();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshot = PNG.sync.read(await canvas.screenshot());
    const colors = new Set();
    let opaque = 0;
    const step = Math.max(4, Math.floor(screenshot.data.length / 20_000 / 4) * 4);
    for (let index = 0; index < screenshot.data.length; index += step) {
      if (screenshot.data[index + 3] > 8) opaque += 1;
      colors.add((screenshot.data[index] << 16) | (screenshot.data[index + 1] << 8) | screenshot.data[index + 2]);
    }
    const pixels = { opaque, colors: colors.size };
    expect(pixels.opaque, `${template}/${grid}/${renderer} canvas is blank`).toBeGreaterThan(100);
    expect(pixels.colors, `${template}/${grid}/${renderer} tiles are visually flat`).toBeGreaterThan(12);

    const target = await page.evaluate(() => {
      const snapshot = window.__towerforgeInspect();
      const tile = snapshot.tiles.find((item) => item.terrain === "buildable" && !item.occupiedBy);
      return { coord: { q: tile.q, r: tile.r }, ...window.__towerforgeTilePoint(tile) };
    });
    expect(await page.evaluate((point) => window.__towerforgePickPoint(point), target)).toEqual(target.coord);
    await expect(page.locator("#stat-towers"), `${template}/${grid}/${renderer} starts with towers`).toHaveText("0");
    await page.mouse.click(target.x, target.y);
    await expect(page.locator("#stat-towers")).toHaveText("1");
    expect(await page.evaluate(() => window.__towerforgeLastPointerCoord), `${template}/${grid}/${renderer} pointer mapping`).toEqual(target.coord);
    const placed = await page.evaluate(() => window.__towerforgeInspect().towers[0]?.coord);
    expect(placed, `${template}/${grid}/${renderer} placement coordinate`).toEqual(target.coord);

    await page.locator("#reset-run").click();
    await expect(page.locator("#stat-towers")).toHaveText("0");
    await page.locator("#playfield").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#stat-towers")).toHaveText("1");
    page.off("response", responseListener);
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
