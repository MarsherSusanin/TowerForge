import { describe, expect, it } from "vitest";
import { listVisualAssetPaths, normalizeVisuals, validateProjectSchemas, validateSafeAssetPath } from "./project-schema.mjs";

describe("project schema", () => {
  it("validates authored theme palettes before a renderer consumes them", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      balance: { missions: {} },
      maps: {}, mapSources: {},
      visuals: { ...normalizeVisuals({}), theme: { ui: { accent: "url(evil)" }, renderer: { path: "#806247" } } },
      storyComics: { seenStoragePrefix: "story_seen_", comics: {} },
      battleBackgrounds: { fallbackMissionId: "", placeholderMissionIds: [], definitions: {} },
      buildTargets: { targets: {} }
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ fieldPath: "theme.ui.accent", severity: "error" }));
  });
  it("normalizes legacy visuals into catalog v1", () => {
    const visuals = normalizeVisuals({ atlases: { creatures: { src: "/assets/generated/sprite-atlas.png" } } });

    expect(visuals.schemaVersion).toBe(1);
    expect(visuals.assetsRoot).toBe("assets");
    expect(visuals.atlases.creatures.src).toBe("assets/generated/sprite-atlas.png");
    expect(visuals.bindings.towers).toEqual({});
  });

  it("normalizes sound and music catalogs and lists their assets for the build copy", () => {
    const visuals = normalizeVisuals({ audio: {
      sounds: { shoot: { src: "/assets/sfx/shoot.wav" } },
      events: { towerFired: "shoot" },
      musicTracks: { frontier: { src: "/assets/music/frontier.ogg", volume: 0.6 } },
      musicByMission: { intro: "frontier" }
    } });
    expect(visuals.audio.sounds.shoot.src).toBe("assets/sfx/shoot.wav");
    expect(visuals.audio.events.towerFired).toBe("shoot");
    expect(visuals.audio.musicTracks.frontier.src).toBe("assets/music/frontier.ogg");
    expect(visuals.audio.musicByMission.intro).toBe("frontier");
    const paths = listVisualAssetPaths(visuals);
    expect(paths.some((p) => p.kind === "sound" && p.path === "assets/sfx/shoot.wav")).toBe(true);
    expect(paths.some((p) => p.kind === "music" && p.path === "assets/music/frontier.ogg")).toBe(true);
  });

  it("flags unsafe sound paths and bindings to unknown sounds", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      maps: {},
      mapSources: {},
      visuals: { assetsRoot: "assets", atlases: {}, sprites: {}, bindings: {}, audio: { sounds: { bad: { src: "../evil.wav" } }, events: { defeat: "ghost" } } },
      buildTargets: { targets: {} }
    });
    expect(result.issues.some((i) => i.fieldPath === "audio.sounds.bad.src")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "audio.events.defeat" && i.severity === "warning")).toBe(true);
  });

  it("validates music paths, volume, mission bindings, and track bindings", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      balance: { missions: { intro: { id: "intro" } } },
      maps: {},
      mapSources: {},
      visuals: {
        assetsRoot: "assets",
        atlases: {},
        sprites: {},
        bindings: {},
        audio: {
          sounds: {},
          events: {},
          musicTracks: { bad: { src: "../outside.ogg", volume: 2 } },
          musicByMission: { intro: "missing", removed_mission: "bad" }
        }
      },
      buildTargets: { targets: {} }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.fieldPath === "audio.musicTracks.bad.src")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "audio.musicTracks.bad.volume")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "audio.musicByMission.intro" && issue.message.includes("unknown music track"))).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "audio.musicByMission.removed_mission" && issue.message.includes("unknown mission"))).toBe(true);
  });

  it("accepts an atlas-frame sprite that references an existing atlas", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      maps: {},
      mapSources: {},
      visuals: {
        assetsRoot: "assets",
        atlases: { sheet: { src: "assets/sheet.png" } },
        sprites: { hero: { atlas: "sheet", frame: { x: 0, y: 32, w: 32, h: 32 } } },
        bindings: {}
      },
      buildTargets: { targets: {} }
    });
    expect(result.issues.some((i) => i.fieldPath.startsWith("sprites.hero"))).toBe(false);
  });

  it("flags atlas-frame sprites with an unknown atlas or a degenerate frame", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      maps: {},
      mapSources: {},
      visuals: {
        assetsRoot: "assets",
        atlases: { sheet: { src: "assets/sheet.png" } },
        sprites: {
          ghost: { atlas: "missing", frame: { x: 0, y: 0, w: 16, h: 16 } },
          bad: { atlas: "sheet", frame: { x: -1, y: 0, w: 0, h: 16 } }
        },
        bindings: {}
      },
      buildTargets: { targets: {} }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.fieldPath === "sprites.ghost.atlas")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "sprites.bad.frame.x")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "sprites.bad.frame.w")).toBe(true);
  });

  it("rejects a sprite that sets both src and atlas/frame, and still validates the frame", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      maps: {},
      mapSources: {},
      visuals: {
        assetsRoot: "assets",
        atlases: { sheet: { src: "assets/sheet.png" } },
        // The renderer prefers the atlas/frame branch, so a stale `src` alongside a bad frame must
        // not let the malformed frame slip through unvalidated.
        sprites: { mixed: { src: "assets/mixed.png", atlas: "sheet", frame: { x: -5, y: 0, w: 0, h: 8 } } },
        bindings: {}
      },
      buildTargets: { targets: {} }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.fieldPath === "sprites.mixed")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "sprites.mixed.frame.x")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "sprites.mixed.frame.w")).toBe(true);
  });

  it("rejects unsafe asset paths", () => {
    expect(validateSafeAssetPath("assets/sprite.png")).toBe(null);
    expect(validateSafeAssetPath("../secrets.txt")).toContain("..");
    expect(validateSafeAssetPath("https://example.com/a.png")).toContain("external URL");
    expect(validateSafeAssetPath("/tmp/a.png")).toContain("absolute path");
  });

  it("validates mission and sprite references in narrative content", () => {
    const result = validateProjectSchemas({
      manifest: { schemaVersion: 1 },
      balance: { missions: { intro: { id: "intro" } } },
      maps: {},
      mapSources: {},
      visuals: { assetsRoot: "assets", atlases: {}, sprites: { scene: { src: "assets/scene.png" } }, bindings: {} },
      storyComics: {
        seenStoragePrefix: "seen_",
        comics: { good: { missionId: "intro", panels: [{ text: "Ready.", spriteId: "scene" }] }, bad: { missionId: "missing", panels: [] } }
      },
      battleBackgrounds: {
        fallbackMissionId: "intro",
        placeholderMissionIds: [],
        definitions: { intro: { color: "green", spriteId: "missing" } }
      },
      buildTargets: { targets: {} }
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.fieldPath === "comics.bad.missionId")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "comics.bad.panels")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "definitions.intro.color")).toBe(true);
    expect(result.issues.some((issue) => issue.fieldPath === "definitions.intro.spriteId")).toBe(true);
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
