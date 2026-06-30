import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readMapSources } from "./map-compiler.mjs";
import { migrateProjectFiles } from "./project-migrations.mjs";
import { defaultVisuals, normalizeManifest, normalizeVisuals, validateProjectSchemas } from "./project-schema.mjs";
import { mergeValidationResults } from "./trace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "../../..");

export function resolveProjectDir(explicitDir, args = process.argv.slice(2)) {
  if (explicitDir) return path.resolve(explicitDir);
  const pFlag = args.indexOf("--project");
  if (pFlag !== -1 && args[pFlag + 1]) return path.resolve(args[pFlag + 1]);
  for (const arg of args) {
    if (!arg.startsWith("--")) return path.resolve(arg);
  }
  if (process.env["PROJECT_DIR"]) return path.resolve(process.env["PROJECT_DIR"]);
  return path.join(repoRoot, "examples", "starter.tdproj");
}

export function readJsonOr(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadProjectFiles(projectDir) {
  const projectFile = path.join(projectDir, "project.json");
  if (!fs.existsSync(projectFile)) {
    throw new Error(`No project.json found at: ${projectDir}`);
  }

  const contentDir = path.join(projectDir, "content");
  const mapsDir = path.join(projectDir, "maps", "compiled");
  const rawFiles = {
    projectDir,
    manifest: readJsonOr(projectFile, {}),
    balance: readJsonOr(path.join(contentDir, "balance.json"), {}),
    worldMap: readJsonOr(path.join(contentDir, "world-map.json"), {
      width: 800,
      height: 600,
      regions: [],
      missionNodes: []
    }),
    maps: readJsonOr(path.join(mapsDir, "maps.json"), {}),
    mapSources: readMapSources(projectDir),
    visuals: readJsonOr(path.join(contentDir, "visuals.json"), defaultVisuals()),
    storyComics: readJsonOr(path.join(contentDir, "story-comics.json"), { seenStoragePrefix: "story_seen_", comics: {} }),
    battleBackgrounds: readJsonOr(path.join(contentDir, "battle-backgrounds.json"), {
      fallbackMissionId: "",
      placeholderMissionIds: [],
      definitions: {}
    }),
    buildTargets: readJsonOr(path.join(projectDir, "build-targets.json"), {
      schemaVersion: 1,
      defaults: { web: "web-pwa" },
      targets: {}
    })
  };
  const migrated = migrateProjectFiles(rawFiles);

  return {
    projectDir,
    manifest: normalizeManifest(migrated.files.manifest),
    balance: normalizeBalance(migrated.files.balance),
    worldMap: normalizeWorldMap(migrated.files.worldMap),
    maps: normalizeMaps(migrated.files.maps),
    mapSources: migrated.files.mapSources ?? {},
    visuals: normalizeVisuals(migrated.files.visuals),
    storyComics: normalizeStoryComics(migrated.files.storyComics),
    battleBackgrounds: normalizeBattleBackgrounds(migrated.files.battleBackgrounds),
    buildTargets: normalizeBuildTargets(migrated.files.buildTargets),
    appliedMigrations: migrated.migrations
  };
}

export function projectSummary(files) {
  return {
    manifest: files.manifest,
    constants: files.balance.constants,
    defaultMissionId: files.balance.defaultMissionId,
    abilities: files.balance.abilities,
    enemies: files.balance.enemies,
    towers: files.balance.towers,
    waveSets: files.balance.waveSets,
    missions: files.balance.missions,
    worldMap: files.worldMap,
    visuals: files.visuals,
    storyComics: files.storyComics,
    battleBackgrounds: files.battleBackgrounds,
    buildTargets: files.buildTargets,
    maps: files.maps,
    mapSources: files.mapSources,
    schemaVersions: {
      project: files.manifest.schemaVersion ?? 1,
      buildTargets: files.buildTargets.schemaVersion ?? 1,
      visuals: files.visuals.schemaVersion ?? 1
    },
    appliedMigrations: files.appliedMigrations ?? [],
    mapRoutes: Object.fromEntries(
      Object.entries(files.maps).map(([mapId, map]) => [
        mapId,
        (map.pathRoutes ?? []).map((route) => route.id)
      ])
    ),
    availableMaps: Object.keys(files.maps)
  };
}

export async function loadEngine() {
  const engineIndex = ensureEngineBuilt();
  return import(pathToFileURL(engineIndex).href);
}

export async function loadContentRegistry(projectDir) {
  const files = loadProjectFiles(projectDir);
  const engine = await loadEngine();
  const content = engine.createGameContentRegistry({
    balance: files.balance,
    maps: files.maps,
    worldMap: files.worldMap,
    visuals: files.visuals,
    storyComics: files.storyComics,
    battleBackgrounds: files.battleBackgrounds
  });
  return { files, engine, content };
}

export async function validateProjectDir(projectDir) {
  const { files, engine, content } = await loadContentRegistry(projectDir);
  const result = mergeValidationResults(validateProjectSchemas(files), engine.validateGameContentRegistry(content));
  return { files, result };
}

export async function runMissionSmoke(projectDir, missionId, duration = 180) {
  const { files, engine, content } = await loadContentRegistry(projectDir);
  const resolvedMissionId = missionId || content.defaultMissionId;
  if (!resolvedMissionId) {
    throw new Error("No mission ID provided and no defaultMissionId in balance.json.");
  }
  if (!content.missions[resolvedMissionId]) {
    const available = Object.keys(content.missions);
    throw new Error(`Mission "${resolvedMissionId}" not found.${available.length ? ` Available missions: ${available.join(", ")}` : ""}`);
  }

  const game = new engine.MushroomDefenseGame({ missionId: resolvedMissionId, content });
  const placements = autoPlaceInitialTowers(game, content.missions[resolvedMissionId].buildTowerIds ?? []);
  const startResult = game.startNextWave();

  const tickStep = 0.1;
  let elapsed = 0;
  while (elapsed < duration && game.getSnapshot().outcome === "playing") {
    game.tick(Math.min(tickStep, duration - elapsed));
    elapsed += tickStep;
  }

  const snapshot = game.getSnapshot();
  const mission = content.missions[resolvedMissionId];
  const map = files.maps[mission.mapId];

  return {
    ok: true,
    missionId: resolvedMissionId,
    label: mission.label,
    mapId: mission.mapId,
    waveSetId: mission.waveSetId,
    mapSize: map ? `${map.width}x${map.height}` : "unknown",
    pathLength: map?.pathCenterline?.length ?? 0,
    duration,
    elapsed: Math.round(elapsed * 10) / 10,
    startResult,
    outcome: snapshot.outcome,
    coreHp: snapshot.coreHp,
    maxCoreHp: snapshot.maxCoreHp,
    coins: snapshot.coins,
    resources: snapshot.resources,
    totalWaves: snapshot.totalWaves,
    startedWaveCount: snapshot.startedWaveCount,
    waveState: snapshot.waveState,
    activeEnemies: snapshot.enemies.length,
    towersBuilt: snapshot.towers.length,
    placements,
    availableTowers: mission.buildTowerIds ?? [],
    startingResources: mission.startingResources,
    eventCounts: countEvents(snapshot.lastEvents),
    waveStats: summarizeWaves(mission.waves, content.enemies)
  };
}

export async function runBalanceSweepForProject(projectDir, options = {}) {
  const { engine, content } = await loadContentRegistry(projectDir);
  if (typeof engine.runBalanceSweep !== "function") {
    throw new Error("Engine build is out of date — run `npm run build:engine`.");
  }
  return engine.runBalanceSweep(content, options);
}

export function selectBuildTarget(buildTargets, explicitTargetId) {
  const targets = buildTargets.targets ?? {};
  if (explicitTargetId) {
    const target = targets[explicitTargetId];
    if (!target) throw new Error(`Build target "${explicitTargetId}" not found.`);
    return [explicitTargetId, target];
  }
  const defaultId = buildTargets.defaults?.web;
  if (defaultId && targets[defaultId]) return [defaultId, targets[defaultId]];
  const firstWeb = Object.entries(targets).find(([, target]) => target.platform === "web");
  if (firstWeb) return firstWeb;
  const first = Object.entries(targets)[0];
  if (first) return first;
  throw new Error("No build targets configured.");
}

function ensureEngineBuilt() {
  const srcDir = path.join(repoRoot, "packages", "engine", "src");
  const distIndex = path.join(repoRoot, "packages", "engine", "dist", "index.js");
  const tsconfig = path.join(repoRoot, "packages", "engine", "tsconfig.build.json");
  const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(tsc)) {
    throw new Error("TypeScript compiler is missing. Run `npm install` before using CLI, Studio, or build commands.");
  }
  if (fs.existsSync(distIndex) && newestMtime(srcDir) <= fs.statSync(distIndex).mtimeMs && fs.statSync(tsconfig).mtimeMs <= fs.statSync(distIndex).mtimeMs) {
    return distIndex;
  }
  const result = spawnSync(process.execPath, [tsc, "-p", tsconfig], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Failed to build @mycelium/engine.\n${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
  }
  return distIndex;
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

function normalizeBalance(input) {
  const balance = structuredCloneCompat(input);
  balance.constants ??= {};
  balance.constants.startingResources ??= { coins: balance.constants.startingCoins ?? 0, oakRoots: 0 };
  balance.constants.moveTowerCost ??= { coins: 0, oakRoots: 0 };
  balance.abilities ??= {};
  balance.enemies ??= {};
  balance.towers ??= {};
  balance.waveSets ??= {};
  balance.missions ??= {};
  balance.defaultMissionId ??= Object.keys(balance.missions)[0] ?? "";

  for (const [enemyId, enemy] of Object.entries(balance.enemies)) {
    enemy.id ??= enemyId;
    enemy.label ??= enemyId;
    enemy.reward ??= {};
    enemy.coinReward ??= enemy.reward.coins ?? 0;
    enemy.coreDamage ??= 1;
    enemy.color = normalizeColor(enemy.color);
  }

  for (const [towerId, tower] of Object.entries(balance.towers)) {
    tower.id ??= towerId;
    tower.label ??= towerId;
    tower.cost ??= { coins: 0, oakRoots: 0 };
    tower.footprintRadius ??= 1;
    tower.range ??= 1;
    normalizeAttack(tower.attack);
  }

  for (const [waveSetId, waves] of Object.entries(balance.waveSets)) {
    if (!Array.isArray(waves)) {
      balance.waveSets[waveSetId] = [];
      continue;
    }
    waves.forEach((wave, index) => {
      wave.id ??= `${waveSetId}_${index + 1}`;
      wave.label ??= wave.id;
      wave.groups ??= [];
      for (const group of wave.groups) {
        group.count ??= 1;
        group.spawnInterval ??= 1;
        group.startDelay ??= 0;
      }
    });
  }

  for (const [missionId, mission] of Object.entries(balance.missions)) {
    mission.id ??= missionId;
    mission.label ??= missionId;
    mission.description ??= "";
    if (mission.availability === "available") mission.availability = "playable";
    mission.availability ??= "playable";
    mission.buildTowerIds ??= [];
    mission.abilityIds ??= [];
    mission.startingCoreHp ??= balance.constants.startingCoreHp ?? 1;
    mission.startingResources ??= balance.constants.startingResources ?? { coins: balance.constants.startingCoins ?? 0, oakRoots: 0 };
    mission.prepTimeUnits ??= balance.constants.prepTimeUnits ?? 0;
    if (mission.sunlightModifier && !mission.sunlight) {
      mission.sunlight = mission.sunlightModifier;
    }
    delete mission.sunlightModifier;
  }

  return balance;
}

function normalizeAttack(attack) {
  if (!attack) return;
  if (attack.kind === "chanterelle") {
    attack.maxTargetsByLevel ??= [1, 2, 3, 4];
    attack.upgradeCosts ??= [];
  }
  if (attack.kind === "support") {
    attack.unlocksTowerIds ??= [];
    attack.upgradeCosts ??= [];
  }
  if (attack.kind === "support_buff") {
    attack.fireRateMultiplierByLevel ??= [1.25, 1.35, 1.45];
    attack.affectsTowerIds ??= [];
    attack.upgradeCosts ??= [];
  }
}

function normalizeColor(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return Number.parseInt(value.slice(1), 16);
  }
  return 0x888888;
}

function normalizeMaps(input) {
  const maps = structuredCloneCompat(input);
  for (const [mapId, map] of Object.entries(maps)) {
    map.id ??= mapId;
    map.label ??= mapId;
    map.defaultTerrain ??= "buildable";
    map.pathRoutes ??= [];
    map.terrainOverrides ??= [];
  }
  return maps;
}

function normalizeWorldMap(input) {
  const worldMap = structuredCloneCompat(input);
  worldMap.width ??= 800;
  worldMap.height ??= 600;
  worldMap.regions ??= [];
  worldMap.missionNodes ??= [];
  for (const region of worldMap.regions) {
    region.description ??= "";
    region.bounds ??= { x: 0, y: 0, width: worldMap.width, height: worldMap.height };
    region.accent ??= "#4a7c4a";
    region.biome ??= "";
    region.connections ??= [];
  }
  for (const node of worldMap.missionNodes) {
    node.difficulty ??= 1;
    node.unlockRequiresMissionIds ??= [];
  }
  return worldMap;
}

function normalizeStoryComics(input) {
  const story = structuredCloneCompat(input);
  story.seenStoragePrefix ??= "story_seen_";
  story.comics ??= {};
  return story;
}

function normalizeBattleBackgrounds(input) {
  const backgrounds = structuredCloneCompat(input);
  backgrounds.fallbackMissionId ??= "";
  backgrounds.placeholderMissionIds ??= [];
  backgrounds.definitions ??= {};
  if (!Array.isArray(backgrounds.placeholderMissionIds)) backgrounds.placeholderMissionIds = [];
  return backgrounds;
}

function normalizeBuildTargets(input) {
  const buildTargets = structuredCloneCompat(input);
  buildTargets.schemaVersion ??= 1;
  buildTargets.defaults ??= {};
  buildTargets.targets ??= {};
  for (const [targetId, target] of Object.entries(buildTargets.targets)) {
    target.id ??= targetId;
    target.platform ??= target.type ?? "web";
    target.renderer = target.renderer === "phaser" ? "phaser" : "canvas";
    target.webDir ??= target.outputDir ?? "dist";
    target.market ??= target.platform === "web" ? "pwa" : "";
    target.storeChannel ??= target.market;
    target.appName ??= target.label ?? targetId;
    if (target.title && !target.appTitle) target.appTitle = target.title;
    target.backgroundColor ??= "#111111";
    target.appVersion ??= "0.1.0";
  }
  if (!buildTargets.defaults.web) {
    const firstWeb = Object.entries(buildTargets.targets).find(([, target]) => target.platform === "web");
    if (firstWeb) buildTargets.defaults.web = firstWeb[0];
  }
  return buildTargets;
}

function autoPlaceInitialTowers(game, towerIds) {
  const placements = [];
  let keepPlacing = true;
  let guard = 0;
  while (keepPlacing && guard < 40) {
    guard += 1;
    keepPlacing = false;
    for (const towerId of towerIds) {
      const snapshot = game.getSnapshot();
      const candidates = snapshot.tiles
        .filter((tile) => tile.terrain === "buildable" && !tile.occupiedBy)
        .sort((a, b) => distanceToPath(a, snapshot.pathCenterline) - distanceToPath(b, snapshot.pathCenterline));
      for (const tile of candidates) {
        const result = game.placeTower(towerId, { q: tile.q, r: tile.r });
        if (result.ok) {
          placements.push({ towerTypeId: towerId, coord: { q: tile.q, r: tile.r } });
          keepPlacing = true;
          break;
        }
      }
    }
  }
  return placements;
}

function distanceToPath(tile, pathCenterline) {
  return Math.min(...pathCenterline.map((coord) => Math.abs(coord.q - tile.q) + Math.abs(coord.r - tile.r)));
}

function summarizeWaves(waves, enemies) {
  return waves.map((wave) => {
    let count = 0;
    let totalHp = 0;
    let totalThreat = 0;
    const enemyCounts = {};
    for (const group of wave.groups ?? []) {
      count += group.count;
      enemyCounts[group.enemyId] = (enemyCounts[group.enemyId] ?? 0) + group.count;
      const enemy = enemies[group.enemyId];
      totalHp += group.count * (enemy?.maxHp ?? 0);
      totalThreat += group.count * (enemy?.coreDamage ?? 1);
    }
    return { id: wave.id, label: wave.label, count, totalHp, totalThreat, enemyCounts };
  });
}

function countEvents(events) {
  const counts = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

function structuredCloneCompat(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}
