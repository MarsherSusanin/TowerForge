import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, TEMPLATE_NAMES } from "./create-project.mjs";

const repoRoot = path.resolve(".");
const combinations = TEMPLATE_NAMES.flatMap((template) => ["canvas", "phaser"].map((renderer) => ({ template, renderer })));
let tempDir;

beforeAll(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-conformance-")); });
afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe("template x renderer conformance matrix", () => {
  it.each(combinations)("builds $template with $renderer and emits the complete product contract", ({ template, renderer }) => {
    const name = `${template}_${renderer}`;
    const { projectDir } = createProject({ name, parentDir: tempDir, templateName: template });
    const targetsPath = path.join(projectDir, "build-targets.json");
    const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
    targets.targets[renderer] = {
      ...targets.targets["web-pwa"],
      id: renderer,
      renderer,
      webDir: `dist-${renderer}`
    };
    fs.writeFileSync(targetsPath, `${JSON.stringify(targets, null, 2)}\n`);

    const output = execFileSync(process.execPath, [
      path.join(repoRoot, "packages/cli/build.mjs"), "--project", projectDir, "--target", renderer, "--json"
    ], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TOWERFORGE_BUNDLED_RUNTIME: "1" } });
    const result = JSON.parse(output);
    expect(result).toMatchObject({ ok: true, targetId: renderer, missingAssets: [], invalidAssets: [] });

    const player = fs.readFileSync(path.join(result.outDir, "player.mjs"), "utf8");
    const html = fs.readFileSync(path.join(result.outDir, "index.html"), "utf8");
    const projectData = fs.readFileSync(path.join(result.outDir, "project-data.js"), "utf8");
    expect(html).toContain('id="playfield" tabindex="0"');
    expect(html).toContain('id="difficulty-select"');
    expect(player).toContain("window.__towerforgeBootOk = true");
    expect(player).toContain("moveKeyboardCursor");
    expect(player).toContain("metaUpgradeLevels: progress.upgradeLevels");
    expect(projectData).toContain('"difficulties"');
    expect(projectData).toContain('"metaProgression"');
    expect(projectData).toContain('"starter_gameplay"');
    if (renderer === "canvas") {
      expect(player).toContain("createCanvasRenderer");
      expect(player).not.toContain("new Phaser.Game");
    } else {
      expect(player).toContain("new Phaser.Game");
      expect(fs.existsSync(path.join(result.outDir, "vendor/phaser.min.js"))).toBe(true);
    }
  }, 30_000);
});
