import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyVisualAssets, importProjectAsset } from "./assets.mjs";

let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "towerforge-assets-"));
  fs.mkdirSync(path.join(projectDir, "imports"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "imports", "tower.png"), "png", "utf8");
  fs.writeFileSync(path.join(projectDir, "imports", "герой.png"), "hero", "utf8");
  fs.writeFileSync(path.join(projectDir, "imports", "враг.png"), "enemy", "utf8");
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("asset catalog helpers", () => {
  it("imports project-relative assets into assetsRoot and updates visuals", () => {
    const result = importProjectAsset(projectDir, { assetsRoot: "assets", atlases: {}, sprites: {}, bindings: {} }, {
      sourcePath: "imports/tower.png",
      targetPath: "sprites/tower.png",
      id: "tower",
      kind: "sprite"
    });

    expect(result.asset).toEqual({ id: "tower", kind: "sprite", path: "assets/sprites/tower.png" });
    expect(result.visuals.sprites.tower.src).toBe("assets/sprites/tower.png");
    expect(fs.existsSync(path.join(projectDir, "assets", "sprites", "tower.png"))).toBe(true);
  });

  it("uniquifies auto-derived ids so two non-ASCII filenames don't overwrite each other", () => {
    let visuals = { assetsRoot: "assets", atlases: {}, sprites: {}, bindings: {} };
    // No explicit id: both Cyrillic basenames used to sanitize to "_" and collide.
    const first = importProjectAsset(projectDir, visuals, { sourcePath: "imports/герой.png", targetPath: "герой.png", kind: "sprite" });
    visuals = first.visuals;
    const second = importProjectAsset(projectDir, visuals, { sourcePath: "imports/враг.png", targetPath: "враг.png", kind: "sprite" });
    visuals = second.visuals;

    expect(first.asset.id).not.toBe(second.asset.id); // distinct ids, no clobber
    expect(Object.keys(visuals.sprites)).toHaveLength(2);
    // Both source files preserved as separate registry entries.
    const srcs = Object.values(visuals.sprites).map((s) => s.src).sort();
    expect(srcs).toEqual(["assets/враг.png", "assets/герой.png"].sort());
  });

  it("re-importing the same file updates in place instead of creating a duplicate id", () => {
    let visuals = { assetsRoot: "assets", atlases: {}, sprites: {}, bindings: {} };
    const a = importProjectAsset(projectDir, visuals, { sourcePath: "imports/tower.png", targetPath: "tower.png", kind: "sprite" });
    visuals = a.visuals;
    const b = importProjectAsset(projectDir, visuals, { sourcePath: "imports/tower.png", targetPath: "tower.png", kind: "sprite" });
    expect(b.asset.id).toBe(a.asset.id); // same src -> same id, no "tower-2"
    expect(Object.keys(b.visuals.sprites)).toHaveLength(1);
  });

  it("copies referenced visual assets into build output and reports missing assets", () => {
    const outDir = path.join(projectDir, "dist");
    const result = copyVisualAssets(projectDir, outDir, {
      atlases: {
        present: { src: "imports/tower.png" },
        missing: { src: "assets/missing.png" }
      },
      sprites: {}
    });

    expect(result.copied).toHaveLength(1);
    expect(result.missing).toHaveLength(1);
    expect(fs.existsSync(path.join(outDir, "imports", "tower.png"))).toBe(true);
  });
});
