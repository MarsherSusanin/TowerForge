import { describe, expect, it } from "vitest";
import { normalizeVisuals, validateProjectSchemas, validateSafeAssetPath } from "./project-schema.mjs";

describe("project schema", () => {
  it("normalizes legacy visuals into catalog v1", () => {
    const visuals = normalizeVisuals({ atlases: { creatures: { src: "/assets/generated/sprite-atlas.png" } } });

    expect(visuals.schemaVersion).toBe(1);
    expect(visuals.assetsRoot).toBe("assets");
    expect(visuals.atlases.creatures.src).toBe("assets/generated/sprite-atlas.png");
    expect(visuals.bindings.towers).toEqual({});
  });

  it("rejects unsafe asset paths", () => {
    expect(validateSafeAssetPath("assets/sprite.png")).toBe(null);
    expect(validateSafeAssetPath("../secrets.txt")).toContain("..");
    expect(validateSafeAssetPath("https://example.com/a.png")).toContain("external URL");
    expect(validateSafeAssetPath("/tmp/a.png")).toContain("absolute path");
  });

  it("validates .tdproj schema-level files alongside engine checks", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 999 },
      maps: {},
      mapSources: { "map.tmj": { orientation: "orthogonal", width: 2, height: 2 } },
      visuals: { assetsRoot: "assets", atlases: { bad: { src: "../bad.png" } }, sprites: {}, bindings: {} },
      buildTargets: { targets: { web: { platform: "web", webDir: "../dist" } } }
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.fieldPath === "schemaVersion")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "atlases.bad.src")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "targets.web.webDir")).toBe(true);
  });
});
