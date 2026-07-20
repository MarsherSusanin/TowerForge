import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyThemePack, getThemePackPreviewPath, listThemePacks, previewThemePack } from "./theme-packs.mjs";

const STARTER = path.resolve("examples/starter.tdproj");
let tempDir;
let projectDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-themes-"));
  projectDir = path.join(tempDir, "theme-test.tdproj");
  fs.cpSync(STARTER, projectDir, { recursive: true });
});

afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe("bundled theme packs", () => {
  it("lists validated packs without exposing their source filesystem paths", () => {
    const packs = listThemePacks();
    expect(packs.map((pack) => pack.id)).toEqual(["frostbound-citadel", "verdant-frontier"]);
    expect(packs.every((pack) => !Object.hasOwn(pack, "sourcePath"))).toBe(true);
    expect(fs.statSync(getThemePackPreviewPath("verdant-frontier")).isFile()).toBe(true);
    expect(() => getThemePackPreviewPath("../escape")).toThrow(/Invalid theme pack id/);
  });

  it("previews, revision-guards, validates, and commits a theme", async () => {
    const preview = previewThemePack(projectDir, "verdant-frontier");
    expect(preview.changes.missionIds).toContain("tutorial_01");
    const conflict = await applyThemePack(projectDir, "verdant-frontier", { ifRevision: "stale" });
    expect(conflict).toMatchObject({ ok: false, conflict: true });
    expect(fs.existsSync(path.join(projectDir, "assets/themes/verdant-frontier/battle-background.png"))).toBe(false);

    const applied = await applyThemePack(projectDir, "verdant-frontier", { ifRevision: preview.revision });
    expect(applied).toMatchObject({ ok: true, dryRun: false, validation: { ok: true } });
    expect(fs.existsSync(path.join(projectDir, "assets/themes/verdant-frontier/battle-background.png"))).toBe(true);
    const visuals = JSON.parse(fs.readFileSync(path.join(projectDir, "content/visuals.json"), "utf8"));
    const backgrounds = JSON.parse(fs.readFileSync(path.join(projectDir, "content/battle-backgrounds.json"), "utf8"));
    expect(visuals.theme.id).toBe("verdant-frontier");
    expect(backgrounds.definitions.tutorial_01.spriteId).toBe("theme_verdant_frontier_background");
  });

  it("restores catalogs and the copied asset when validation fails", async () => {
    const balancePath = path.join(projectDir, "content/balance.json");
    const balance = JSON.parse(fs.readFileSync(balancePath, "utf8"));
    balance.missions.tutorial_01.mapId = "missing_map";
    fs.writeFileSync(balancePath, `${JSON.stringify(balance, null, 2)}\n`);
    const visualsPath = path.join(projectDir, "content/visuals.json");
    const before = fs.readFileSync(visualsPath);
    const result = await applyThemePack(projectDir, "frostbound-citadel");
    expect(result).toMatchObject({ ok: false, rolledBack: true });
    expect(fs.readFileSync(visualsPath).equals(before)).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "assets/themes/frostbound-citadel/battle-background.png"))).toBe(false);
  });
});
