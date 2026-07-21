import { describe, expect, it } from "vitest";
import {
  chooseWeightedVariant,
  inspectTileSetCoverage,
  resolveAutotile,
  stableHash,
  TILE_PRESETS,
  tileSignature
} from "./autotile.mjs";

function squareMap() {
  const tiles = [];
  for (let r = 0; r < 3; r += 1) for (let q = 0; q < 3; q += 1) tiles.push({ q, r, terrain: r === 1 || q === 1 && r === 0 ? "path" : "grass" });
  return {
    id: "square_map",
    grid: { kind: "square", adjacency: "cardinal" },
    tiles,
    pathRoutes: [{ id: "main", pathCenterline: [{ q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 }] }]
  };
}

describe("autotile resolver", () => {
  it("ships the canonical preset coverage", () => {
    expect(TILE_PRESETS["square-edge-16"].requiredSignatures).toHaveLength(16);
    expect(TILE_PRESETS["square-blob-47"].requiredSignatures).toHaveLength(47);
    expect(TILE_PRESETS["hex-edge-64"].requiredSignatures).toHaveLength(64);
    expect(TILE_PRESETS["square-dual-grid-4"].requiredSignatures).toHaveLength(4);
    expect(TILE_PRESETS["hex-sector-6"].requiredSignatures).toHaveLength(6);
  });

  it("derives road connections only from authored route segments", () => {
    const map = squareMap();
    const tileSet = {
      topology: "square",
      ruleKind: "edge",
      materials: { path: { connectGroup: "road", connectionSource: "pathRoutes", signatures: {} } }
    };
    expect(tileSignature({ map, coord: { q: 1, r: 1 }, terrain: "path", tileSet, material: tileSet.materials.path })).toBe("edge:10");
    // The stray path tile at (1,0) touches the road but is not an authored route segment.
    expect(tileSignature({ map, coord: { q: 1, r: 0 }, terrain: "path", tileSet, material: tileSet.materials.path })).toBe("edge:0");
  });

  it("connects area terrain by connectGroup across terrain ids", () => {
    const map = squareMap();
    map.tiles.find((tile) => tile.q === 2 && tile.r === 0).terrain = "flowers";
    map.tiles.find((tile) => tile.q === 2 && tile.r === 1).terrain = "grass";
    const tileSet = {
      topology: "square",
      ruleKind: "edge",
      materials: {
        path: { connectGroup: "road", signatures: {} },
        grass: { connectGroup: "meadow", signatures: {} },
        flowers: { connectGroup: "meadow", signatures: {} }
      }
    };
    expect(tileSignature({ map, coord: { q: 2, r: 0 }, terrain: "flowers", tileSet, material: tileSet.materials.flowers })).toBe("edge:4");
  });

  it("uses Tiled Wang order and suppresses unsupported diagonal corners for blob-47", () => {
    const map = squareMap();
    for (const tile of map.tiles) tile.terrain = "other";
    map.tiles.find((tile) => tile.q === 1 && tile.r === 1).terrain = "meadow";
    map.tiles.find((tile) => tile.q === 2 && tile.r === 0).terrain = "meadow";
    const materials = { meadow: { connectGroup: "meadow", signatures: {} }, other: { connectGroup: "other", signatures: {} } };
    expect(tileSignature({ map, coord: { q: 1, r: 1 }, terrain: "meadow", tileSet: { topology: "square", ruleKind: "mixed", materials }, material: materials.meadow })).toBe("wang:01000000");
    expect(tileSignature({ map, coord: { q: 1, r: 1 }, terrain: "meadow", tileSet: { topology: "square", ruleKind: "blob", materials }, material: materials.meadow })).toBe("wang:00000000");
    expect(TILE_PRESETS["square-blob-47"].requiredSignatures).toContain("wang:11111111");
  });

  it("selects weighted variants deterministically and reports only observed missing masks", () => {
    const map = squareMap();
    const visuals = {
      tileSets: {
        roads: {
          topology: "square",
          ruleKind: "edge",
          materials: {
            path: { connectionSource: "pathRoutes", signatures: { "edge:0": [{ spriteId: "road", weight: 1 }], "edge:2": [{ spriteId: "road", weight: 1 }], "edge:8": [{ spriteId: "road", weight: 1 }], "edge:10": [{ spriteId: "road_a", weight: 1 }, { spriteId: "road_b", weight: 3 }] } },
            grass: { signatures: { "*": [{ spriteId: "grass", weight: 1 }] } }
          }
        }
      },
      bindings: { tileSets: { maps: { square_map: "roads" }, grids: {} } }
    };
    const first = resolveAutotile({ map, visuals, coord: { q: 1, r: 1 }, terrain: "path", seed: 7 });
    const second = resolveAutotile({ map, visuals, coord: { q: 1, r: 1 }, terrain: "path", seed: 7 });
    expect(first).toEqual(second);
    expect(stableHash("same")).toBe(stableHash("same"));
    expect(chooseWeightedVariant([{ spriteId: "a", weight: 1 }], "x")).toEqual({ spriteId: "a", weight: 1 });
    expect(inspectTileSetCoverage({ map, visuals }).ok).toBe(true);
  });
});
