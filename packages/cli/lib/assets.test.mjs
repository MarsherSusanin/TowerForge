import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyVisualAssets, importProjectAsset } from "./assets.mjs";

let projectDir;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "mycelium-assets-"));
  fs.mkdirSync(path.join(projectDir, "imports"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "imports", "spore.png"), "png", "utf8");
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("asset catalog helpers", () => {
  it("imports project-relative assets into assetsRoot and updates visuals", () => {
    const result = importProjectAsset(projectDir, { assetsRoot: "assets", atlases: {}, sprites: {}, bindings: {} }, {
      sourcePath: "imports/spore.png",
      targetPath: "sprites/spore.png",
      id: "spore",
      kind: "sprite"
    });

    expect(result.asset).toEqual({ id: "spore", kind: "sprite", path: "assets/sprites/spore.png" });
    expect(result.visuals.sprites.spore.src).toBe("assets/sprites/spore.png");
    expect(fs.existsSync(path.join(projectDir, "assets", "sprites", "spore.png"))).toBe(true);
  });

  it("copies referenced visual assets into build output and reports missing assets", () => {
    const outDir = path.join(projectDir, "dist");
    const result = copyVisualAssets(projectDir, outDir, {
      atlases: {
        present: { src: "imports/spore.png" },
        missing: { src: "assets/missing.png" }
      },
      sprites: {}
    });

    expect(result.copied).toHaveLength(1);
    expect(result.missing).toHaveLength(1);
    expect(fs.existsSync(path.join(outDir, "imports", "spore.png"))).toBe(true);
  });
});
