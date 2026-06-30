import { compileMapSources } from "./map-compiler.mjs";

export const PROJECT_SCHEMA_VERSION = 1;

export function defaultVisuals() {
  return {
    schemaVersion: 1,
    assetsRoot: "assets",
    atlases: {},
    sprites: {},
    bindings: {
      towers: {},
      enemies: {},
      tiles: {},
      ui: {}
    }
  };
}

export function normalizeManifest(input) {
  const manifest = clone(input);
  manifest.schemaVersion ??= PROJECT_SCHEMA_VERSION;
  manifest.name ??= "Untitled Tower Defense";
  manifest.description ??= "";
  manifest.engineVersion ??= "0.1.0";
  return manifest;
}

export function normalizeVisuals(input) {
  const visuals = { ...defaultVisuals(), ...clone(input) };
  visuals.schemaVersion ??= 1;
  visuals.assetsRoot = normalizeRelativeAssetPath(visuals.assetsRoot || "assets", "assets");
  visuals.atlases ??= {};
  visuals.sprites ??= {};
  visuals.bindings = {
    towers: {},
    enemies: {},
    tiles: {},
    ui: {},
    ...(visuals.bindings ?? {})
  };
  visuals.bindings.towers ??= {};
  visuals.bindings.enemies ??= {};
  visuals.bindings.tiles ??= {};
  visuals.bindings.ui ??= {};

  for (const atlas of Object.values(visuals.atlases)) {
    if (atlas && typeof atlas === "object" && typeof atlas.src === "string") {
      atlas.src = normalizeRelativeAssetPath(atlas.src, visuals.assetsRoot);
    }
  }
  for (const sprite of Object.values(visuals.sprites)) {
    if (sprite && typeof sprite === "object" && typeof sprite.src === "string") {
      sprite.src = normalizeRelativeAssetPath(sprite.src, visuals.assetsRoot);
    }
  }
  return visuals;
}

export function validateProjectSchemas(files) {
  const issues = [];
  const issue = (severity, entityKind, entityId, fieldPath, message) => {
    issues.push({ severity, entityKind, entityId, fieldPath, message });
  };
  const err = (...args) => issue("error", ...args);
  const warn = (...args) => issue("warning", ...args);

  if (!Number.isInteger(files.manifest?.schemaVersion)) {
    err("project", "project.json", "schemaVersion", "project.json must define an integer schemaVersion.");
  } else if (files.manifest.schemaVersion > PROJECT_SCHEMA_VERSION) {
    err(
      "project",
      "project.json",
      "schemaVersion",
      `Project schemaVersion ${files.manifest.schemaVersion} is newer than this CLI supports (${PROJECT_SCHEMA_VERSION}).`
    );
  }

  validateMaps(files.maps, err, warn);
  validateMapSources(files.mapSources ?? {}, err, warn);
  issues.push(...compileMapSources(files.mapSources ?? {}).issues);
  validateVisuals(files.visuals, err, warn);
  validateBuildTargets(files.buildTargets, err);

  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    issues
  };
}

export function validateSafeAssetPath(assetPath, fieldPath = "asset") {
  if (typeof assetPath !== "string" || assetPath.trim() === "") {
    return `${fieldPath} must be a non-empty project-relative path.`;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(assetPath)) {
    return `${fieldPath} must not be an external URL.`;
  }
  if (assetPath.startsWith("/") || assetPath.startsWith("\\")) {
    return `${fieldPath} must not be an absolute path.`;
  }
  const parts = assetPath.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) {
    return `${fieldPath} must not contain '..'.`;
  }
  return null;
}

export function listVisualAssetPaths(visuals) {
  const seen = new Set();
  const paths = [];
  const add = (entry) => {
    const dedupeKey = `${entry.kind}:${entry.id}:${entry.path}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    paths.push(entry);
  };
  for (const [atlasId, atlas] of Object.entries(visuals?.atlases ?? {})) {
    if (typeof atlas?.src === "string") add({ kind: "atlas", id: atlasId, path: atlas.src });
  }
  for (const [spriteId, sprite] of Object.entries(visuals?.sprites ?? {})) {
    if (typeof sprite?.src === "string") add({ kind: "sprite", id: spriteId, path: sprite.src });
  }
  return paths;
}

function validateVisuals(visuals, err, warn) {
  if (!visuals || typeof visuals !== "object") {
    err("visuals", "content/visuals.json", "root", "visuals.json must be an object.");
    return;
  }
  const assetsRootIssue = validateSafeAssetPath(visuals.assetsRoot ?? "assets", "assetsRoot");
  if (assetsRootIssue) err("visuals", "content/visuals.json", "assetsRoot", assetsRootIssue);

  for (const [atlasId, atlas] of Object.entries(visuals.atlases ?? {})) {
    if (!atlas || typeof atlas !== "object") {
      err("visuals", atlasId, `atlases.${atlasId}`, `Atlas "${atlasId}" must be an object.`);
      continue;
    }
    if (atlas.src !== undefined) {
      const safeIssue = validateSafeAssetPath(atlas.src, `atlases.${atlasId}.src`);
      if (safeIssue) err("visuals", atlasId, `atlases.${atlasId}.src`, safeIssue);
    } else {
      warn("visuals", atlasId, `atlases.${atlasId}.src`, `Atlas "${atlasId}" has no src yet.`);
    }
  }

  for (const [spriteId, sprite] of Object.entries(visuals.sprites ?? {})) {
    if (!sprite || typeof sprite !== "object") {
      err("visuals", spriteId, `sprites.${spriteId}`, `Sprite "${spriteId}" must be an object.`);
      continue;
    }
    if (sprite.src !== undefined) {
      const safeIssue = validateSafeAssetPath(sprite.src, `sprites.${spriteId}.src`);
      if (safeIssue) err("visuals", spriteId, `sprites.${spriteId}.src`, safeIssue);
    }
  }
}

function validateBuildTargets(buildTargets, err) {
  if (!buildTargets || typeof buildTargets !== "object") {
    err("buildTargets", "build-targets.json", "root", "build-targets.json must be an object.");
    return;
  }
  for (const [targetId, target] of Object.entries(buildTargets.targets ?? {})) {
    if (target.platform !== "web") continue;
    const dir = target.webDir ?? "dist";
    const safeIssue = validateSafeAssetPath(dir, `targets.${targetId}.webDir`);
    if (safeIssue || dir === "." || dir === "") {
      err("buildTargets", targetId, `targets.${targetId}.webDir`, safeIssue ?? "webDir must name an output directory.");
    }
  }
}

function validateMaps(maps, err) {
  if (!maps || typeof maps !== "object") {
    err("maps", "maps/compiled/maps.json", "root", "compiled maps must be an object.");
    return;
  }
  for (const [mapId, map] of Object.entries(maps)) {
    if (!map || typeof map !== "object") {
      err("map", mapId, "root", `Map "${mapId}" must be an object.`);
      continue;
    }
    if (!Number.isInteger(map.width) || map.width <= 0) err("map", mapId, "width", "Map width must be a positive integer.");
    if (!Number.isInteger(map.height) || map.height <= 0) err("map", mapId, "height", "Map height must be a positive integer.");
    if (!Array.isArray(map.pathCenterline)) err("map", mapId, "pathCenterline", "pathCenterline must be an array.");
    if (!Array.isArray(map.terrainOverrides)) err("map", mapId, "terrainOverrides", "terrainOverrides must be an array.");
  }
}

function validateMapSources(mapSources, err, warn) {
  for (const [sourceName, source] of Object.entries(mapSources)) {
    if (!source || typeof source !== "object") {
      err("mapSource", sourceName, "root", `Map source "${sourceName}" must be an object.`);
      continue;
    }
    if (source.orientation && source.orientation !== "hexagonal") {
      warn("mapSource", sourceName, "orientation", `Map source "${sourceName}" is "${source.orientation}", expected hexagonal.`);
    }
    if (!Number.isInteger(source.width) || source.width <= 0) err("mapSource", sourceName, "width", "Source width must be a positive integer.");
    if (!Number.isInteger(source.height) || source.height <= 0) err("mapSource", sourceName, "height", "Source height must be a positive integer.");
  }
}

function normalizeRelativeAssetPath(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  let normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) normalized = fallback;
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}
