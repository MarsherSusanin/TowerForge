import { inspectTileSetCoverage, resolveTileSetBinding } from "../../renderer/src/autotile.mjs";

export function projectTileCoverage(files) {
  const maps = [];
  for (const map of Object.values(files.maps ?? {})) {
    const tileSetId = resolveTileSetBinding(files.visuals, map);
    if (!tileSetId) continue; // legacy color/sprite binding remains production-compatible
    const model = mapRenderModel(map);
    maps.push({ mapId: map.id, ...inspectTileSetCoverage({ map: model, visuals: files.visuals }) });
  }
  return {
    ok: maps.every((entry) => entry.ok),
    maps,
    missingCount: maps.reduce((sum, entry) => sum + entry.missing.length, 0)
  };
}

export function mapRenderModel(map) {
  const overrides = new Map((map.terrainOverrides ?? []).map((entry) => [`${entry.q},${entry.r}`, entry.terrain]));
  const tiles = [];
  for (let r = 0; r < map.height; r += 1) {
    for (let q = 0; q < map.width; q += 1) {
      let terrain = overrides.get(`${q},${r}`) ?? map.defaultTerrain;
      if (map.spawnCoord?.q === q && map.spawnCoord?.r === r) terrain = "spawn";
      if (map.coreCoord?.q === q && map.coreCoord?.r === r) terrain = "core";
      tiles.push({ q, r, terrain });
    }
  }
  return { ...map, grid: map.grid ?? { kind: "hex", layout: "odd-r" }, tiles };
}
