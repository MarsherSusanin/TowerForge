import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
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
  fs.writeFileSync(path.join(projectDir, "imports", "frontier.wav"), silentWav());
  fs.writeFileSync(path.join(projectDir, ".env"), "PRIVATE_TEST_TOKEN=not-exposed\n");

  studioProcess = spawn(process.execPath, [path.join(repoRoot, "packages", "studio", "server.mjs"), "--project", projectDir], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(studioPort) },
    stdio: "pipe"
  });
  await waitForHttp(`${studioUrl}/api/project`);
});

test.afterAll(async () => {
  playerServer?.close();
  if (studioProcess && studioProcess.exitCode === null && studioProcess.signalCode === null) {
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

  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);
  await expect(page).toHaveTitle(/TowerForge Editor/);
  await expect(page.getByText("TowerForge Editor", { exact: true })).toBeVisible();
  await expect(page.locator("#ai-dock")).toBeHidden();
  await expect(page.locator("#ai-dock")).toHaveAttribute("aria-hidden", "true");

  await expect(page.getByRole("heading", { name: "Project Home" })).toBeVisible();
  await page.getByRole("button", { name: "Run Release Doctor" }).click();
  await expect(page.locator("#project-home-body")).toContainText("Project validation");
  await expect(page.locator("#project-home-body")).toContainText("Build targets");
  await expect(page.locator("#project-home-body")).toContainText("Saved revision checked");

  for (const collection of ["enemies", "towers", "missions"]) {
    const recipeResponse = await request.get(`${studioUrl}/api/recipes?collection=${collection}`);
    expect(recipeResponse.ok()).toBe(true);
    expect((await recipeResponse.json()).recipes.length).toBeGreaterThanOrEqual(4);
  }

  await page.getByRole("tab", { name: /Settings/ }).click();
  await expect(page.getByText("AI Connections", { exact: true })).toBeVisible();
  await expect(page.locator("#ai-connections-list").getByText("Codex (ChatGPT)", { exact: true })).toBeVisible();
  await expect(page.locator("#ai-connections-list").getByText("Claude Code", { exact: true })).toBeVisible();
  await page.locator("#setting-ai-provider").selectOption("openai");
  await expect(page.locator("#setting-ai-model")).toHaveValue("gpt-5.6-terra");
  await expect(page.locator("#setting-ai-model option")).toContainText(["GPT-5.6 Terra (balanced)", "GPT-5.6 Sol (deep)", "GPT-5.6 Luna (cheap)"]);
  await page.locator('[data-ai-key-input="openai"]').fill("openai-e2e-key");
  await page.locator('[data-ai-save-key="openai"]').click();
  await expect(page.locator('[data-ai-remove-key="openai"]')).toBeVisible();
  await page.locator("#setting-ai-reasoning").selectOption("high");
  await page.locator("#setting-ai-custom-model").fill("gpt-custom-towerforge");
  await page.locator("#setting-ai-add-model").click();
  await expect(page.locator("#setting-ai-model")).toHaveValue("gpt-custom-towerforge");
  await page.locator("#setting-ai-open-chat").click();
  await expect(page.locator("#ai-dock")).toBeVisible();
  await expect(page.locator("#ai-provider")).toHaveValue("openai");
  await expect(page.locator("#ai-reasoning")).toHaveValue("high");
  await expect(page.locator("#ai-mode")).toHaveValue("ask");
  await page.locator("#ai-mode").selectOption("act");
  expect(await page.evaluate(() => localStorage.getItem("towerforge:ai-permission-mode"))).toBe("act");
  await page.locator("#ai-file-input").setInputFiles(path.join(projectDir, "imports", "tower.png"));
  await expect(page.locator(".ai-attachment-chip")).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("towerforge:ai-keys")))).toEqual({ openai: "openai-e2e-key" });

  await page.getByRole("tab", { name: /Scripts/ }).click();
  await expect(page.locator("#project-tree")).toContainText("starter-gameplay.tower.json");
  await page.locator(".tree-row").filter({ hasText: "starter-gameplay.tower.json" }).click();
  await expect(page.locator("#script-editor")).toBeEnabled();
  const originalScript = await page.locator("#script-editor").inputValue();
  await page.locator("#script-editor").fill(originalScript.replace("Starter gameplay hooks", "Authored gameplay hooks"));
  await expect(page.locator("#script-editor-state")).toHaveText("Unsaved");
  await page.locator("#btn-script-save").click();
  await expect(page.locator("#script-editor-state")).toHaveText("Valid JSON");
  expect(fs.readFileSync(path.join(projectDir, "scripts", "gameplay", "starter-gameplay.tower.json"), "utf8")).toContain("Authored gameplay hooks");
  const treeResponse = await request.get(`${studioUrl}/api/project/tree`);
  expect(treeResponse.ok()).toBe(true);
  expect(JSON.stringify(await treeResponse.json())).not.toContain(".env");

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
  await expect(page.locator("#pt-difficulty option")).toHaveCount(3);
  await page.locator("#pt-difficulty").selectOption("veteran");
  await expect(page.locator("#pt-msg")).toContainText("Veteran");
  await clickHexTile(page, "#playtest-canvas", { q: 12, r: 8 }, { width: 15, height: 20 });
  await expect(page.locator("#pt-towers-count")).toHaveText("1");
  await expect(page.locator("#pt-event-timeline")).toContainText("towerPlaced");
  await page.locator("#pt-interaction-mode").selectOption("inspect");
  await clickHexTile(page, "#playtest-canvas", { q: 12, r: 8 }, { width: 15, height: 20 });
  await expect(page.locator("#pt-inspector")).toContainText("Arrow Tower");
  await page.locator("#pt-inspector [data-pt-target-mode]").selectOption("strongest");
  await expect(page.locator("#pt-event-timeline")).toContainText("towerTargetModeChanged");
  await page.locator("#pt-inspector [data-pt-sell]").click();
  await expect(page.locator("#pt-towers-count")).toHaveText("0");
  await expect(page.locator("#pt-event-timeline")).toContainText("towerSold");
  await page.locator("#pt-interaction-mode").selectOption("build");
  await page.locator("#playtest-canvas").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pt-towers-count")).toHaveText("1");
  await expect(page.locator("#pt-kills-leaks")).toHaveText("0 / 0");
  await expect(page.locator("#pt-objectives")).toContainText("0/1");
  await page.locator("#pt-pause").click();
  await expect(page.locator("#pt-pause")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#pt-step").click();
  await expect(page.locator("#pt-speed")).toHaveValue("0");

  await page.getByRole("tab", { name: /Balance/ }).click();
  await page.locator("#btn-run-balance").click();
  await expect(page.locator("#balance-results")).toContainText("Placement-sensitive");
  await page.locator("#balance-results details").first().click();
  await expect(page.locator("#balance-results")).toContainText("inputs and outcomes");
  await expect(page.locator("#balance-results")).toContainText("far_path");

  await page.getByRole("tab", { name: /Missions/ }).click();
  await expect(page.locator("#mission-list .balance-tag").first()).toBeVisible();
  await page.locator("#mission-list .entity-item").first().click();
  await page.locator("#mission-dup-btn").click();
  await expect(page.locator("#mf-id")).toHaveValue("tutorial_01_copy");
  await expect(page.locator("#mission-list .entity-item")).toHaveCount(2);
  await page.locator("#mission-del-btn").click();
  await page.locator("#confirm-overlay").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("#mission-list .entity-item")).toHaveCount(1);
  await page.locator("#btn-add-mission").click();
  await expect(page.locator("#recipe-overlay")).toBeVisible();
  await page.locator("#recipe-list").getByRole("button", { name: /Timed Survival/ }).click();
  await expect(page.locator("#mf-label")).toHaveValue("Timed Survival");
  await expect(page.locator(".mf-objective-kind")).toHaveValue("surviveSeconds");
  await page.locator("#mission-del-btn").click();
  await page.locator("#confirm-overlay").getByRole("button", { name: "Delete" }).click();
  await page.locator("#mission-list .entity-item").first().click();
  await page.locator("#mf-economy-enable").check();
  await page.locator("#mf-econ-refund").fill("0.55");
  await page.locator("#mf-econ-passive-coins").fill("1");
  await page.locator("#mf-econ-passive-coins").blur();
  await page.locator("#mf-objective-add").click();
  const objectiveRow = page.locator("[data-objective-index]").last();
  await objectiveRow.locator(".mf-objective-kind").selectOption("killCount");
  await objectiveRow.locator(".mf-objective-target").fill("8");
  await objectiveRow.locator(".mf-objective-target").blur();
  await page.locator("#mf-star-add").click();
  const starRow = page.locator("[data-star-index]").last();
  await starRow.locator(".mf-star-label").fill("Keep the core healthy");
  await starRow.locator(".mf-star-target").fill("5");
  await starRow.locator(".mf-star-target").blur();
  await page.locator("#btn-save").click();
  await expect(page.locator("#dirty-badge")).not.toHaveClass(/visible/);

  await page.getByRole("tab", { name: /Assets/ }).click();
  await expect(page.locator("#story-comics-json")).toHaveValue(/frontier_briefing/);
  await expect(page.locator("#battle-backgrounds-json")).toHaveValue(/frontier_before_battle/);
  const frostTheme = page.locator(".theme-pack-card").filter({ hasText: "Frostbound Citadel" });
  await expect(frostTheme).toBeVisible();
  await frostTheme.getByRole("button", { name: "Preview & Apply" }).click();
  await page.locator("#confirm-overlay").getByRole("button", { name: "Apply theme" }).click();
  await expect(frostTheme.getByRole("button", { name: "Applied" })).toBeDisabled();
  await expect(page.locator("#visuals-json")).toHaveValue(/frostbound-citadel/);
  await page.locator("#asset-source-path").fill("imports/tower.png");
  await page.locator("#asset-target-path").fill("sprites/tower.png");
  await page.locator("#asset-id").fill("tower");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported tower.")).toBeVisible();
  await page.locator("#asset-source-path").fill("imports/frontier.wav");
  await page.locator("#asset-target-path").fill("music/frontier.wav");
  await page.locator("#asset-id").fill("frontier");
  await page.locator("#asset-kind").selectOption("music");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Imported frontier.")).toBeVisible();
  await page.locator("#music-bindings .music-bind").first().selectOption("frontier");
  await page.locator("#music-bindings .music-preview").first().click();
  await expect(page.locator("#music-bindings .music-preview").first()).toHaveAttribute("aria-pressed", "true");
  await page.locator("#btn-save").click();
  await expect(page.locator("#dirty-badge")).not.toHaveClass(/visible/);

  const validateResponse = await request.get(`${studioUrl}/api/validate`);
  expect(validateResponse.ok()).toBe(true);
  const validation = await validateResponse.json();
  expect(validation.ok).toBe(true);

  await page.getByRole("tab", { name: /Build Targets/ }).click();
  await page.locator(".btn-target-build").first().click();
  await expect(page.getByText("Build completed.")).toBeVisible({ timeout: 30_000 });
  expect(fs.existsSync(path.join(projectDir, "dist", "assets", "sprites", "tower.png"))).toBe(true);
  expect(fs.existsSync(path.join(projectDir, "dist", "assets", "music", "frontier.wav"))).toBe(true);
  expect(fs.existsSync(path.join(projectDir, "dist", "assets", "themes", "frostbound-citadel", "battle-background.png"))).toBe(true);
  const projectData = fs.readFileSync(path.join(projectDir, "dist", "project-data.js"), "utf8");
  expect(projectData).toContain("storyComics");
  expect(projectData).toContain("battleBackgrounds");
  expect(projectData).toContain("musicByMission");
  expect(projectData).toContain("starter_gameplay");
  await page.locator("#build-open-preview").click();
  await expect(page.locator("#build-preview-overlay")).toBeVisible();
  await expect(page.frameLocator("#build-preview-frame").getByRole("heading", { name: /Starter Tower Defense|TowerForge/i })).toBeVisible();
  const previewPath = new URL(await page.locator("#build-preview-frame").getAttribute("src"), studioUrl).pathname;
  await page.locator("#build-preview-close").click();
  await expect(page.locator("#build-preview-overlay")).toBeHidden();
  const traversalResponse = await request.get(`${studioUrl}${previewPath}%2e%2e%2fproject.json`);
  expect(traversalResponse.status()).toBe(404);

  playerServer = await startStaticServer(path.join(projectDir, "dist"), playerPort);
  const playerPage = await browser.newPage();
  const playerConsole = [];
  playerPage.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) playerConsole.push(`${message.type()}: ${message.text()}`);
  });
  await playerPage.goto(playerUrl);
  await expect(playerPage.getByRole("heading", { name: /Starter Tower Defense|TowerForge/i })).toBeVisible();
  await expect(playerPage.locator("#playfield")).toBeVisible();
  await expect(playerPage.locator("#story-overlay")).toBeVisible();
  await expect(playerPage.locator("#story-text")).toContainText("first wave");
  await playerPage.locator("#story-next").click();
  await playerPage.locator("#story-next").click();
  await expect(playerPage.locator("#story-overlay")).toBeHidden();
  await expect(playerPage.locator("#music-volume")).toBeEnabled();
  await playerPage.locator("#music-volume").fill("0.7");
  await expect(playerPage.locator("#music-volume")).toHaveValue("0.7");
  await playerPage.locator("#pause-run").click();
  await expect(playerPage.locator("#pause-run")).toHaveAttribute("aria-pressed", "true");
  await playerPage.keyboard.press("Space");
  await expect(playerPage.locator("#pause-run")).toHaveAttribute("aria-pressed", "false");
  await playerPage.locator("#start-wave").click();
  await playerPage.locator("#playfield").click({ position: { x: 180, y: 180 } });
  await expect(playerPage.locator("#stat-wave")).not.toHaveText("-");
  await expect(playerPage.locator("#stat-towers")).toHaveText("1");
  await expect(playerPage.locator("#stat-objectives")).toContainText("0/2");
  await expect(playerPage.locator("#target-mode")).toBeEnabled();
  await playerPage.locator("#target-mode").selectOption("weakest");
  await expect(playerPage.locator("#target-mode")).toHaveValue("weakest");
  await playerPage.locator("#sell-mode").click();
  await expect(playerPage.locator("#sell-mode")).toHaveAttribute("aria-pressed", "true");
  await playerPage.locator("#playfield").click({ position: { x: 180, y: 180 } });
  await expect(playerPage.locator("#stat-towers")).toHaveText("0");
  expect(await canvasHasPixels(playerPage)).toBe(true);
  expect(playerConsole).toEqual([]);
  expect(consoleMessages).toEqual([]);
});

test("single-file build runs directly from file URL", async ({ page }) => {
  execFileSync(process.execPath, [
    path.join(repoRoot, "packages", "cli", "build.mjs"),
    "--project", projectDir,
    "--out", "single-e2e",
    "--single-file"
  ], { cwd: repoRoot, stdio: "pipe" });
  const htmlPath = path.join(projectDir, "single-e2e", "index.single.html");
  expect(fs.existsSync(htmlPath)).toBe(true);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(pathToFileURL(htmlPath).href);
  await expect(page.getByRole("heading", { name: /Starter Tower Defense|TowerForge/i })).toBeVisible();
  await expect(page.locator("#mission-select option")).toHaveCount(1);
  await expect(page.locator("#story-overlay")).toBeVisible();
  await page.locator("#story-skip").click();
  await expect(page.locator("#story-overlay")).toBeHidden();
  await page.locator("#start-wave").click();
  await expect(page.locator("#stat-wave")).not.toHaveText("-");
  expect(errors).toEqual([]);
});

test("desktop command bridge drives navigation and guards unsaved changes", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);

  await dispatchDesktopCommand(page, "navigate.ai");
  await expect(page.locator("#ai-dock")).toBeVisible();
  await expect(page.locator("#sidebar-ai-chat")).toHaveClass(/active/);

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
  await page.locator("#validation-ask-ai").click();
  await expect(page.locator("#validation-overlay")).toBeHidden();
  await expect(page.locator("#ai-dock")).toBeVisible();
  await expect(page.locator("#ai-mode")).toHaveValue("ask");
  await expect(page.locator("#ai-input")).toHaveValue(/validation result/);

  await page.locator("#btn-activity").click();
  await expect(page.locator("html")).toHaveAttribute("data-workbench", "open");
  await expect(page.locator("#workbench-tab-activity")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#workbench-body")).toContainText("Project validation");
  await page.locator("#workbench-tab-problems").click();
  await expect(page.locator("#workbench-tab-problems")).toHaveAttribute("aria-selected", "true");
  await page.locator("#workbench-close").click();
  await expect(page.locator("html")).toHaveAttribute("data-workbench", "closed");

  await dispatchDesktopCommand(page, "view.command_palette");
  await expect(page.locator("#cmdk-overlay")).toBeVisible();
  await dispatchDesktopCommand(page, "view.command_palette");
  await expect(page.locator("#cmdk-overlay")).toBeHidden();
});

test("AI chat sends scoped editor context and requires explicit review of writes", async ({ page }) => {
  let requestBody;
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
    localStorage.setItem("towerforge:ai-provider", "openai");
    localStorage.setItem("towerforge:ai-keys", JSON.stringify({ openai: "openai-e2e-key" }));
    localStorage.setItem("towerforge:ai-permission-mode", "act");
  });
  await page.route("**/api/ai/chat", async (route) => {
    requestBody = route.request().postDataJSON();
    const messages = [...requestBody.messages, { role: "assistant", content: "Applied a scoped test change." }];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: `${JSON.stringify({ type: "text", text: "Applied a scoped test change." })}\n${JSON.stringify({ type: "done", messages, appliedPatch: true })}\n`
    });
  });

  await page.goto(studioUrl);
  await page.getByRole("tab", { name: /Enemies/ }).click();
  await page.locator("#enemy-list .entity-item").first().click();
  await page.locator("#btn-ai-chat").click();
  await expect(page.locator("#ai-mode")).toHaveValue("act");
  await page.locator("#ai-input").fill("Review the selected enemy.");
  await page.locator("#ai-send").click();

  await expect(page.locator(".ai-review-card")).toBeVisible();
  expect(requestBody.mode).toBe("act");
  expect(requestBody.context).toMatchObject({
    activeTab: "enemies",
    selection: { collection: "enemies", id: "basic_grunt" }
  });
  expect(requestBody.context.project).not.toHaveProperty("projectDir");
  await page.locator("[data-ai-review-keep]").click();
  await expect(page.locator(".ai-review-card")).toContainText("Changes kept.");
});

test("sidebar exposes app info and persists its collapsed state", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "en");
  });
  await page.goto(studioUrl);

  await expect(page.locator("#sidebar-version")).toHaveText(`v${appVersion}`);
  await expect(page.locator(".sidebar-copyright")).toHaveText("© Lindforge Studios");
  await page.locator("#sidebar-about").click();
  await expect(page.locator("#about-overlay")).toBeVisible();
  await expect(page.locator("#about-version")).toHaveText(`Version ${appVersion}`);
  await expect(page.locator("#about-source-link")).toHaveAttribute("href", "https://github.com/Lindforge-Studios/TowerForge");
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

test("Russian is default and language switching persists", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("towerforge:welcomed", "1"));
  await page.goto(studioUrl);

  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("tab", { name: "Настройки" })).toBeVisible();
  await page.getByRole("tab", { name: "Настройки" }).click();
  await expect(page.getByRole("heading", { name: "Константы и настройки" })).toBeVisible();
  await expect(page.locator("#setting-language")).toHaveValue("ru");

  await page.locator("#setting-language").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Constants & Settings" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("towerforge:language"))).toBe("en");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible();
});

test("Russian locale covers the primary authoring surfaces", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("towerforge:welcomed", "1");
    localStorage.setItem("towerforge:language", "ru");
  });
  await page.goto(studioUrl);

  const surfaces = [
    ["home", "Обзор проекта"],
    ["waves", "Редактор волн"],
    ["enemies", "Редактор врагов"],
    ["towers", "Редактор башен"],
    ["missions", "Редактор миссий"],
    ["worldmap", "Редактор карты мира"],
    ["maps", "Редактор карт"],
    ["scripts", "Проект и скрипты"],
    ["assets", "Каталог ресурсов"],
    ["settings", "Константы и настройки"],
    ["buildtargets", "Цели сборки"],
    ["playtest", "Тестирование"],
    ["balance", "Баланс"],
  ];
  for (const [tab, heading] of surfaces) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator(`#tab-${tab}`).getByText(heading, { exact: true }).first()).toBeVisible();
  }

  await page.locator('[data-tab="enemies"]').click();
  await page.locator("#enemy-list .entity-item").first().click();
  await expect(page.locator("#enemy-detail")).toContainText("Основные характеристики");
  await page.locator('[data-tab="towers"]').click();
  await page.locator("#tower-list .entity-item").first().click();
  await expect(page.locator("#tower-detail")).toContainText("Модель атаки");
  await page.locator('[data-tab="missions"]').click();
  await page.locator("#mission-list .entity-item").first().click();
  await expect(page.locator("#mission-detail")).toContainText("Цели миссии");
  await page.locator('[data-tab="maps"]').click();
  await expect(page.locator("#map-source-detail")).toContainText("Параметры карты");
  await page.locator("#btn-ai-chat").click();
  await expect(page.locator("#ai-dock")).toContainText("Настройки ИИ");
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

function silentWav(sampleCount = 800) {
  const buffer = Buffer.alloc(44 + sampleCount, 128);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(8000, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount, 40);
  return buffer;
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
