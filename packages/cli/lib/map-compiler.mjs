import fs from "node:fs";
import path from "node:path";

// Tiled tile GID ↔ terrain mapping. Authoring tools (Tiled or the Studio map editor) paint a
// "terrain" tilelayer whose GIDs translate to engine terrain kinds.
export const TERRAIN_BY_GID = { 1: "buildable", 2: "path", 3: "blocked", 4: "water", 5: "spawn", 6: "core" };
export const GID_BY_TERRAIN = { buildable: 1, path: 2, blocked: 3, water: 4, spawn: 5, core: 6 };

export function readMapSources(projectDir) {
  const srcDir = path.join(projectDir, "maps", "src");
  if (!fs.existsSync(srcDir)) return {};
  const sources = {};
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tmj")) continue;
    const filePath = path.join(srcDir, entry.name);
    sources[entry.name] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return sources;
}

export function compileMapSources(mapSources) {
  const maps = {};
  const issues = [];
  for (const [sourceName, source] of Object.entries(mapSources)) {
    try {
      const map = compileMapSource(source, sourceName);
      maps[map.id] = map;
    } catch (error) {
      issues.push({
        severity: "error",
        entityKind: "mapSource",
        entityId: sourceName,
        fieldPath: "root",
        message: error.message
      });
    }
  }
  return {
    ok: issues.filter((issue) => issue.severity === "error").length === 0,
    maps,
    issues
  };
}

export function compileMapSource(source, sourceName = "map.tmj") {
  if (!source || typeof source !== "object") {
    throw new Error(`Map source "${sourceName}" must be an object.`);
  }
  const properties = propertiesToObject(source.properties);
  const id = String(properties.id ?? source.id ?? path.basename(sourceName, ".tmj"));
  const width = requirePositiveInteger(source.width, `${sourceName}.width`);
  const height = requirePositiveInteger(source.height, `${sourceName}.height`);
  const defaultTerrain = String(properties.defaultTerrain ?? source.defaultTerrain ?? "buildable");
  const spawnCoord = parseCoord(properties.spawnCoord ?? source.spawnCoord, `${sourceName}.spawnCoord`);
  const coreCoord = parseCoord(properties.coreCoord ?? source.coreCoord, `${sourceName}.coreCoord`);
  const pathCenterline = parseCoordArray(properties.pathCenterline ?? source.pathCenterline, `${sourceName}.pathCenterline`);
  const layerOverrides = readTerrainLayer(source, defaultTerrain, width, height);
  const explicitOverrides = normalizeTerrainOverrides(source.terrainOverrides ?? parseJson(properties.terrainOverrides, []), `${sourceName}.terrainOverrides`);
  const terrainOverrides = mergeTerrainOverrides(layerOverrides, explicitOverrides);
  const pathRoutes = normalizeRoutes(source.pathRoutes ?? parseJson(properties.pathRoutes, []), pathCenterline, `${sourceName}.pathRoutes`);

  return {
    id,
    width,
    height,
    defaultTerrain,
    spawnCoord,
    coreCoord,
    pathCenterline,
    pathRoutes,
    terrainOverrides
  };
}

export function writeCompiledMaps(projectDir, maps) {
  const compiledDir = path.join(projectDir, "maps", "compiled");
  fs.mkdirSync(compiledDir, { recursive: true });
  const filePath = path.join(compiledDir, "maps.json");
  fs.writeFileSync(filePath, JSON.stringify(maps, null, 2) + "\n", "utf8");
  return filePath;
}

export function writeMapSource(projectDir, sourceName, source) {
  if (!/^[a-zA-Z0-9_.-]+\.tmj$/.test(sourceName)) {
    throw new Error(`Unsafe map source name "${sourceName}".`);
  }
  const srcDir = path.join(projectDir, "maps", "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const filePath = path.join(srcDir, sourceName);
  fs.writeFileSync(filePath, JSON.stringify(source, null, 2) + "\n", "utf8");
  return filePath;
}

function propertiesToObject(properties) {
  const result = {};
  if (!Array.isArray(properties)) return result;
  for (const prop of properties) {
    if (!prop || typeof prop.name !== "string") continue;
    result[prop.name] = prop.value;
  }
  return result;
}

function requirePositiveInteger(value, fieldPath) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldPath} must be a positive integer.`);
  }
  return value;
}

function parseCoord(value, fieldPath) {
  const coord = parseJson(value, value);
  if (!coord || !Number.isFinite(coord.q) || !Number.isFinite(coord.r)) {
    throw new Error(`${fieldPath} must be a coord with finite q/r.`);
  }
  return { q: coord.q, r: coord.r };
}

function parseCoordArray(value, fieldPath) {
  const coords = parseJson(value, value);
  if (!Array.isArray(coords) || coords.length < 2) {
    throw new Error(`${fieldPath} must contain at least two coords.`);
  }
  return coords.map((coord, index) => parseCoord(coord, `${fieldPath}.${index}`));
}

/** Read the "terrain" tilelayer (or the first tilelayer) into sparse {q,r,terrain} overrides, skipping default-terrain tiles. */
function readTerrainLayer(source, defaultTerrain, width, height) {
  const layers = Array.isArray(source.layers) ? source.layers : [];
  const layer = layers.find((l) => l && l.type === "tilelayer" && l.name === "terrain")
    ?? layers.find((l) => l && l.type === "tilelayer");
  if (!layer || !Array.isArray(layer.data)) return [];
  const w = Number.isInteger(layer.width) && layer.width > 0 ? layer.width : width;
  const overrides = [];
  for (let i = 0; i < layer.data.length; i += 1) {
    const terrain = TERRAIN_BY_GID[layer.data[i]];
    if (!terrain || terrain === defaultTerrain) continue;
    const q = i % w;
    const r = Math.floor(i / w);
    if (q < width && r < height) overrides.push({ q, r, terrain });
  }
  return overrides;
}

/** Merge tile-layer overrides with explicit terrainOverrides; explicit entries win per coord. */
function mergeTerrainOverrides(layerOverrides, explicitOverrides) {
  const byKey = new Map();
  for (const o of layerOverrides) byKey.set(`${o.q},${o.r}`, o);
  for (const o of explicitOverrides) byKey.set(`${o.q},${o.r}`, o);
  return [...byKey.values()];
}

function normalizeTerrainOverrides(value, fieldPath) {
  const overrides = parseJson(value, value);
  if (!Array.isArray(overrides)) return [];
  return overrides.map((override, index) => {
    const coord = parseCoord(override, `${fieldPath}.${index}`);
    return { ...coord, terrain: String(override.terrain ?? "buildable") };
  });
}

function normalizeRoutes(value, pathCenterline, fieldPath) {
  const routes = parseJson(value, value);
  if (!Array.isArray(routes) || routes.length === 0) {
    return [{ id: "main", pathCenterline: [...pathCenterline] }];
  }
  return routes.map((route, index) => {
    if (!route || typeof route !== "object") {
      throw new Error(`${fieldPath}.${index} must be an object.`);
    }
    return {
      id: String(route.id ?? `route_${index + 1}`),
      pathCenterline: parseCoordArray(route.pathCenterline, `${fieldPath}.${index}.pathCenterline`)
    };
  });
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
