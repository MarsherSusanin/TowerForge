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
    },
    audio: {
      sounds: {},
      events: {},
      musicTracks: {},
      musicByMission: {}
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
  visuals.audio = visuals.audio && typeof visuals.audio === "object" ? visuals.audio : {};
  visuals.audio.sounds ??= {};
  visuals.audio.events ??= {};
  visuals.audio.musicTracks ??= {};
  visuals.audio.musicByMission ??= {};
  for (const sound of Object.values(visuals.audio.sounds)) {
    if (sound && typeof sound === "object" && typeof sound.src === "string") {
      sound.src = normalizeRelativeAssetPath(sound.src, visuals.assetsRoot);
    }
  }
  for (const track of Object.values(visuals.audio.musicTracks)) {
    if (track && typeof track === "object" && typeof track.src === "string") {
      track.src = normalizeRelativeAssetPath(track.src, visuals.assetsRoot);
    }
  }
  return visuals;
}

/** Mirrors the engine's deriveValidationCode (packages/engine/src/content/validate.ts) so issues
 *  merged from both sources carry a consistent, stable machine-branchable code. */
function deriveValidationCode(entityKind, fieldPath) {
  return `${entityKind}_${fieldPath}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function validateProjectSchemas(files) {
  const issues = [];
  const issue = (severity, entityKind, entityId, fieldPath, message, extra = {}) => {
    issues.push({ severity, entityKind, entityId, fieldPath, message, code: extra.code ?? deriveValidationCode(entityKind, fieldPath), hint: extra.hint, expected: extra.expected, got: extra.got });
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
  for (const issue of files.scriptIssues ?? []) {
    err("scriptFile", issue.path ?? "scripts", "source", issue.message ?? "Invalid TowerScript file.");
  }
  validateMapSources(files.mapSources ?? {}, err, warn);
  issues.push(...compileMapSources(files.mapSources ?? {}).issues);
  validateVisuals(files.visuals, err, warn, files.balance);
  validateNarrative(files, err, warn);
  validateBuildTargets(files.buildTargets, err);

  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    issues
  };
}

function validateNarrative(files, err, warn) {
  const story = files.storyComics;
  if (story === undefined) {
    // Backward-compatible partial schema callers and legacy projects get the loader defaults.
  } else if (!story || typeof story !== "object" || Array.isArray(story)) {
    err("story", "content/story-comics.json", "root", "story-comics.json must be an object.");
  } else {
    if (typeof story.seenStoragePrefix !== "string" || story.seenStoragePrefix.trim() === "") {
      err("story", "content/story-comics.json", "seenStoragePrefix", "seenStoragePrefix must be a non-empty string.");
    }
    if (!story.comics || typeof story.comics !== "object" || Array.isArray(story.comics)) {
      err("story", "content/story-comics.json", "comics", "comics must be an object keyed by comic ID.");
    } else {
      for (const [comicId, comic] of Object.entries(story.comics)) {
        const base = `comics.${comicId}`;
        if (!comic || typeof comic !== "object" || Array.isArray(comic)) {
          err("story", comicId, base, `Comic "${comicId}" must be an object.`);
          continue;
        }
        if (typeof comic.missionId !== "string" || !files.balance?.missions?.[comic.missionId]) {
          err("story", comicId, `${base}.missionId`, `Comic "${comicId}" must reference an existing mission.`);
        }
        if (comic.trigger !== undefined && !["beforeMission", "afterVictory"].includes(comic.trigger)) {
          err("story", comicId, `${base}.trigger`, "trigger must be beforeMission or afterVictory.");
        }
        if (comic.replay !== undefined && !["once", "always"].includes(comic.replay)) {
          err("story", comicId, `${base}.replay`, "replay must be once or always.");
        }
        if (!Array.isArray(comic.panels) || comic.panels.length === 0) {
          err("story", comicId, `${base}.panels`, `Comic "${comicId}" must contain at least one panel.`);
          continue;
        }
        comic.panels.forEach((panel, index) => {
          const panelPath = `${base}.panels.${index}`;
          if (!panel || typeof panel !== "object" || Array.isArray(panel)) {
            err("story", comicId, panelPath, "Story panel must be an object.");
            return;
          }
          if (typeof panel.text !== "string" || panel.text.trim() === "") {
            err("story", comicId, `${panelPath}.text`, "Story panel text must be a non-empty string.");
          }
          if (panel.spriteId !== undefined && !files.visuals?.sprites?.[panel.spriteId]) {
            err("story", comicId, `${panelPath}.spriteId`, `Story panel references unknown sprite "${panel.spriteId}".`);
          }
        });
      }
    }
  }

  const backgrounds = files.battleBackgrounds;
  if (backgrounds === undefined) return;
  if (!backgrounds || typeof backgrounds !== "object" || Array.isArray(backgrounds)) {
    err("battleBackground", "content/battle-backgrounds.json", "root", "battle-backgrounds.json must be an object.");
    return;
  }
  if (!backgrounds.definitions || typeof backgrounds.definitions !== "object" || Array.isArray(backgrounds.definitions)) {
    err("battleBackground", "content/battle-backgrounds.json", "definitions", "definitions must be an object keyed by mission ID.");
    return;
  }
  if (backgrounds.fallbackMissionId && !backgrounds.definitions[backgrounds.fallbackMissionId]) {
    warn("battleBackground", "content/battle-backgrounds.json", "fallbackMissionId", "fallbackMissionId has no matching background definition.");
  }
  if (!Array.isArray(backgrounds.placeholderMissionIds)) {
    err("battleBackground", "content/battle-backgrounds.json", "placeholderMissionIds", "placeholderMissionIds must be an array.");
  } else {
    for (const missionId of backgrounds.placeholderMissionIds) {
      if (!files.balance?.missions?.[missionId]) warn("battleBackground", missionId, "placeholderMissionIds", `Placeholder references unknown mission "${missionId}".`);
    }
  }
  for (const [definitionId, definition] of Object.entries(backgrounds.definitions)) {
    const base = `definitions.${definitionId}`;
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      err("battleBackground", definitionId, base, `Background "${definitionId}" must be an object.`);
      continue;
    }
    const missionId = definition.missionId ?? definitionId;
    if (!files.balance?.missions?.[missionId]) {
      err("battleBackground", definitionId, `${base}.missionId`, `Background "${definitionId}" must reference an existing mission.`);
    }
    if (definition.color !== undefined && !/^#[0-9a-f]{6}$/i.test(definition.color)) {
      err("battleBackground", definitionId, `${base}.color`, "color must use six-digit hex notation, for example #101410.");
    }
    if (definition.opacity !== undefined && (!Number.isFinite(definition.opacity) || definition.opacity < 0 || definition.opacity > 1)) {
      err("battleBackground", definitionId, `${base}.opacity`, "opacity must be a number from 0 to 1.");
    }
    if (definition.spriteId !== undefined && !files.visuals?.sprites?.[definition.spriteId]) {
      err("battleBackground", definitionId, `${base}.spriteId`, `Background references unknown sprite "${definition.spriteId}".`);
    }
  }
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
  for (const [soundId, sound] of Object.entries(visuals?.audio?.sounds ?? {})) {
    if (typeof sound?.src === "string") add({ kind: "sound", id: soundId, path: sound.src });
  }
  for (const [trackId, track] of Object.entries(visuals?.audio?.musicTracks ?? {})) {
    if (typeof track?.src === "string") add({ kind: "music", id: trackId, path: track.src });
  }
  return paths;
}

function validateVisuals(visuals, err, warn, balance) {
  if (!visuals || typeof visuals !== "object") {
    err("visuals", "content/visuals.json", "root", "visuals.json must be an object.");
    return;
  }
  const assetsRootIssue = validateSafeAssetPath(visuals.assetsRoot ?? "assets", "assetsRoot");
  if (assetsRootIssue) err("visuals", "content/visuals.json", "assetsRoot", assetsRootIssue);

  if (visuals.theme !== undefined) {
    if (!visuals.theme || typeof visuals.theme !== "object" || Array.isArray(visuals.theme)) {
      err("visuals", "content/visuals.json", "theme", "theme must be an object.");
    } else {
      for (const groupName of ["ui", "renderer"]) {
        const group = visuals.theme[groupName];
        if (!group || typeof group !== "object" || Array.isArray(group)) {
          err("visuals", "content/visuals.json", `theme.${groupName}`, `theme.${groupName} must be a color palette object.`);
          continue;
        }
        for (const [key, color] of Object.entries(group)) {
          if (!/^[a-z][a-z0-9-]*$/i.test(key) || !/^#[0-9a-f]{6}$/i.test(color)) {
            err("visuals", "content/visuals.json", `theme.${groupName}.${key}`, `Theme color "${key}" must use a safe CSS variable name and six-digit hex value.`);
          }
        }
      }
    }
  }

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
    const hasFrameShape = sprite.atlas !== undefined || sprite.frame !== undefined;
    // The renderer prefers the atlas/frame branch when it is present, so a sprite that sets BOTH
    // src and atlas/frame is ambiguous — validate the frame regardless of src and reject the mix.
    if (sprite.src !== undefined && hasFrameShape) {
      err("visuals", spriteId, `sprites.${spriteId}`, `Sprite "${spriteId}" must not set both "src" and "atlas"/"frame" — use a standalone image or an atlas frame, not both.`);
    }
    if (sprite.src !== undefined) {
      const safeIssue = validateSafeAssetPath(sprite.src, `sprites.${spriteId}.src`);
      if (safeIssue) err("visuals", spriteId, `sprites.${spriteId}.src`, safeIssue);
    }
    if (hasFrameShape) {
      // Atlas-frame sprite: a sub-rectangle of an existing atlas image.
      if (typeof sprite.atlas !== "string" || !(visuals.atlases && visuals.atlases[sprite.atlas])) {
        err("visuals", spriteId, `sprites.${spriteId}.atlas`, `Sprite "${spriteId}" references unknown atlas "${sprite.atlas}".`);
      }
      const frame = sprite.frame;
      if (!frame || typeof frame !== "object") {
        err("visuals", spriteId, `sprites.${spriteId}.frame`, `Sprite "${spriteId}" atlas frame must be an object { x, y, w, h }.`);
      } else {
        for (const key of ["x", "y"]) {
          if (!Number.isFinite(frame[key]) || frame[key] < 0) err("visuals", spriteId, `sprites.${spriteId}.frame.${key}`, `Sprite "${spriteId}" frame.${key} must be a number >= 0.`);
        }
        for (const key of ["w", "h"]) {
          if (!Number.isFinite(frame[key]) || frame[key] <= 0) err("visuals", spriteId, `sprites.${spriteId}.frame.${key}`, `Sprite "${spriteId}" frame.${key} must be a number > 0.`);
        }
      }
    } else if (sprite.src === undefined) {
      warn("visuals", spriteId, `sprites.${spriteId}`, `Sprite "${spriteId}" has no image src or atlas frame yet.`);
    }
  }

  const sounds = visuals.audio?.sounds ?? {};
  for (const [soundId, sound] of Object.entries(sounds)) {
    if (!sound || typeof sound !== "object") {
      err("visuals", soundId, `audio.sounds.${soundId}`, `Sound "${soundId}" must be an object.`);
      continue;
    }
    if (sound.src !== undefined) {
      const safeIssue = validateSafeAssetPath(sound.src, `audio.sounds.${soundId}.src`);
      if (safeIssue) err("visuals", soundId, `audio.sounds.${soundId}.src`, safeIssue);
    }
  }
  for (const [event, soundId] of Object.entries(visuals.audio?.events ?? {})) {
    if (soundId && !sounds[soundId]) {
      warn("visuals", event, `audio.events.${event}`, `Action "${event}" is bound to unknown sound "${soundId}".`);
    }
  }
  const tracks = visuals.audio?.musicTracks ?? {};
  for (const [trackId, track] of Object.entries(tracks)) {
    if (!track || typeof track !== "object") {
      err("visuals", trackId, `audio.musicTracks.${trackId}`, `Music track "${trackId}" must be an object.`);
      continue;
    }
    if (track.src !== undefined) {
      const safeIssue = validateSafeAssetPath(track.src, `audio.musicTracks.${trackId}.src`);
      if (safeIssue) err("visuals", trackId, `audio.musicTracks.${trackId}.src`, safeIssue);
    }
    if (track.volume !== undefined && (!Number.isFinite(track.volume) || track.volume < 0 || track.volume > 1)) {
      err("visuals", trackId, `audio.musicTracks.${trackId}.volume`, `Music track volume must be between 0 and 1.`);
    }
  }
  const musicByMission = visuals.audio?.musicByMission ?? {};
  if (!musicByMission || typeof musicByMission !== "object" || Array.isArray(musicByMission)) {
    err("visuals", "content/visuals.json", "audio.musicByMission", "audio.musicByMission must be an object keyed by mission id.");
  } else for (const [missionId, trackId] of Object.entries(musicByMission)) {
    if (trackId && !tracks[trackId]) warn("visuals", missionId, `audio.musicByMission.${missionId}`, `Mission "${missionId}" is bound to unknown music track "${trackId}".`);
    if (trackId && balance?.missions && !balance.missions[missionId]) warn("visuals", missionId, `audio.musicByMission.${missionId}`, `Music is bound to unknown mission "${missionId}".`);
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
