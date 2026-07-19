import { describe, expect, it } from "vitest";
import { compileMapSource, compileMapSources } from "./map-compiler.mjs";

describe("map compiler", () => {
  it("compiles Tiled-style map properties into runtime map shape", () => {
    const map = compileMapSource({
      id: "source_map",
      orientation: "hexagonal",
      width: 4,
      height: 5,
      properties: [
        { name: "id", value: "runtime_map" },
        { name: "defaultTerrain", value: "buildable" },
        { name: "spawnCoord", value: JSON.stringify({ q: 1, r: 0 }) },
        { name: "coreCoord", value: JSON.stringify({ q: 1, r: 4 }) },
        { name: "pathCenterline", value: JSON.stringify([{ q: 1, r: 0 }, { q: 1, r: 4 }]) }
      ],
      terrainOverrides: [{ q: 1, r: 0, terrain: "spawn" }]
    }, "runtime_map.tmj");

    expect(map.id).toBe("runtime_map");
    expect(map.pathRoutes).toEqual([{ id: "main", pathCenterline: [{ q: 1, r: 0 }, { q: 1, r: 4 }] }]);
    expect(map.terrainOverrides[0]).toEqual({ q: 1, r: 0, terrain: "spawn" });
  });

  it("reads terrain from a Tiled tile layer and merges explicit overrides on top", () => {
    const map = compileMapSource({
      id: "layered",
      width: 3,
      height: 2,
      properties: [
        { name: "defaultTerrain", value: "buildable" },
        { name: "spawnCoord", value: JSON.stringify({ q: 0, r: 0 }) },
        { name: "coreCoord", value: JSON.stringify({ q: 2, r: 1 }) },
        { name: "pathCenterline", value: JSON.stringify([{ q: 0, r: 0 }, { q: 2, r: 1 }]) }
      ],
      layers: [
        { name: "terrain", type: "tilelayer", width: 3, height: 2, data: [1, 2, 1, 4, 1, 1] }
      ],
      // explicit override wins over the layer at (1,0): path -> blocked
      terrainOverrides: [{ q: 1, r: 0, terrain: "blocked" }]
    }, "layered.tmj");

    const byKey = Object.fromEntries(map.terrainOverrides.map((o) => [`${o.q},${o.r}`, o.terrain]));
    expect(byKey["1,0"]).toBe("blocked"); // explicit override wins over layer's "path"
    expect(byKey["0,1"]).toBe("water");   // gid 4 from the tile layer
    expect(byKey["0,0"]).toBeUndefined(); // gid 1 == defaultTerrain, skipped
  });

  it("strips Tiled flip/rotate flag bits before the terrain lookup (flipped path stays path)", () => {
    const H = 0x80000000; // horizontal-flip flag
    const D = 0x20000000; // anti-diagonal flag
    const map = compileMapSource({
      id: "flipped",
      width: 3,
      height: 2,
      properties: [
        { name: "defaultTerrain", value: "buildable" },
        { name: "spawnCoord", value: JSON.stringify({ q: 0, r: 0 }) },
        { name: "coreCoord", value: JSON.stringify({ q: 2, r: 1 }) },
        { name: "pathCenterline", value: JSON.stringify([{ q: 0, r: 0 }, { q: 2, r: 1 }]) }
      ],
      // (1,0) is a horizontally-flipped "path" (2); (0,1) is a flip+rotated "water" (4).
      layers: [
        { name: "terrain", type: "tilelayer", width: 3, height: 2, data: [1, (2 | H) >>> 0, 1, (4 | H | D) >>> 0, 1, 1] }
      ]
    }, "flipped.tmj");

    const byKey = Object.fromEntries(map.terrainOverrides.map((o) => [`${o.q},${o.r}`, o.terrain]));
    expect(byKey["1,0"]).toBe("path");  // NOT silently dropped to buildable
    expect(byKey["0,1"]).toBe("water");
  });

  it("honors a tileset firstgid != 1 when decoding terrain GIDs", () => {
    const map = compileMapSource({
      id: "offset",
      width: 2,
      height: 1,
      tilesets: [{ firstgid: 101, name: "terrain" }],
      properties: [
        { name: "defaultTerrain", value: "buildable" },
        { name: "spawnCoord", value: JSON.stringify({ q: 0, r: 0 }) },
        { name: "coreCoord", value: JSON.stringify({ q: 1, r: 0 }) },
        { name: "pathCenterline", value: JSON.stringify([{ q: 0, r: 0 }, { q: 1, r: 0 }]) }
      ],
      // firstgid 101 => local id 1 = buildable (skipped), 102 => local id 2 = path.
      layers: [{ name: "terrain", type: "tilelayer", width: 2, height: 1, data: [101, 102] }]
    }, "offset.tmj");

    const byKey = Object.fromEntries(map.terrainOverrides.map((o) => [`${o.q},${o.r}`, o.terrain]));
    expect(byKey["1,0"]).toBe("path");
    expect(byKey["0,0"]).toBeUndefined(); // buildable == default, skipped
  });

  it("returns structured compile issues for malformed sources", () => {
    const result = compileMapSources({ "bad.tmj": { width: 0, height: 5 } });

    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ entityKind: "mapSource", entityId: "bad.tmj" });
  });
});
