// create.mjs — Scaffold a new .tdproj project from a minimal template.
// Usage: node create.mjs <name> [--dir <path>]
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { name: null, dir: null };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "--dir" && raw[i + 1]) {
      result.dir = path.resolve(raw[i + 1]);
      i += 2;
    } else if (!raw[i].startsWith("--")) {
      if (!result.name) result.name = raw[i];
      i++;
    } else {
      i++;
    }
  }
  return result;
}

const args = parseArgs();

if (!args.name) {
  console.error("Usage: node create.mjs <name> [--dir <path>]");
  console.error("  name    Project name (will create <name>.tdproj directory)");
  console.error("  --dir   Parent directory for the project (default: current directory)");
  process.exit(1);
}

// Sanitize name: only word chars, hyphens, underscores
if (!/^[\w_-]+$/.test(args.name)) {
  console.error(`Invalid project name "${args.name}". Use only letters, digits, hyphens, and underscores.`);
  process.exit(1);
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const parentDir = args.dir ?? process.cwd();
const projectName = `${args.name}.tdproj`;
const projectDir = path.join(parentDir, projectName);

if (fs.existsSync(projectDir)) {
  console.error(`Directory already exists: ${projectDir}`);
  process.exit(1);
}

// ── File helpers ──────────────────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ── Template content ──────────────────────────────────────────────────────────

const projectJson = {
  schemaVersion: 1,
  name: args.name,
  description: "",
  author: "",
};

const balanceJson = {
  schemaVersion: 1,
  defaultMissionId: "starter_01",
  constants: {
    timeUnitSeconds: 0.1,
    startingCoreHp: 20,
    startingCoins: 150,
    startingResources: { coins: 150 },
    prepTimeUnits: 100,
    moveTowerCost: { coins: 25 },
    waterGroundSpeedFactor: 0.6,
    pathWaterCooldownUnits: 300,
    pathWaterDurationUnits: 100,
    pathWaterRadius: 2,
    pathWaterGroundSpeedFactor: 0.5,
  },
  abilities: {},
  enemies: {
    crawler: {
      id: "crawler",
      label: "Crawler",
      maxHp: 60,
      speed: 1.5,
      reward: { coins: 5 },
      coreDamage: 1,
      coinReward: 5,
      color: 0x8db070,
      hitRadius: 0.5,
      size: "small",
    },
  },
  towers: {
    basic: {
      id: "basic",
      label: "Basic Tower",
      footprintRadius: 0,
      range: 3,
      cost: { coins: 50 },
      attack: {
        kind: "chanterelle",
        fireRate: 1,
        damage: 20,
        maxTargetsByLevel: [1, 2, 3, 4],
        upgradeCosts: [],
      },
    },
  },
  waveSets: {
    starter_waves: [
      {
        id: "wave_1",
        groups: [
          {
            enemyId: "crawler",
            count: 5,
            spawnInterval: 10,
            startDelay: 0,
          },
        ],
      },
    ],
  },
  missions: {
    starter_01: {
      id: "starter_01",
      label: "First Steps",
      description: "Defend against the first wave of crawlers.",
      availability: "playable",
      countsTowardProgress: true,
      startingCoreHp: 20,
      startingResources: { coins: 150 },
      prepTimeUnits: 100,
      mapId: "starter_map",
      waveSetId: "starter_waves",
      buildTowerIds: ["basic"],
      abilityIds: [],
    },
  },
};

const worldMapJson = {
  width: 800,
  height: 600,
  regions: [
    {
      id: "region_forest",
      label: "Forest",
      description: "A dense woodland.",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      accent: "#4a7c59",
      biome: "forest",
      connections: [],
    },
  ],
  missionNodes: [
    {
      missionId: "starter_01",
      regionId: "region_forest",
      x: 400,
      y: 300,
      difficulty: 1,
      unlockRequiresMissionIds: [],
    },
  ],
};

// Minimal map: 8-wide, 6-tall hex grid with a straight path
const starterMap = {
  id: "starter_map",
  label: "Starter Map",
  width: 8,
  height: 6,
  spawnCoord: { q: 0, r: 2 },
  coreCoord: { q: 7, r: 2 },
  pathCenterline: [
    { q: 0, r: 2 },
    { q: 1, r: 2 },
    { q: 2, r: 2 },
    { q: 3, r: 2 },
    { q: 4, r: 2 },
    { q: 5, r: 2 },
    { q: 6, r: 2 },
    { q: 7, r: 2 },
  ],
  pathRoutes: [{ id: "main", pathCenterline: [
    { q: 0, r: 2 },
    { q: 1, r: 2 },
    { q: 2, r: 2 },
    { q: 3, r: 2 },
    { q: 4, r: 2 },
    { q: 5, r: 2 },
    { q: 6, r: 2 },
    { q: 7, r: 2 },
  ] }],
  terrainOverrides: [],
};

const mapsJson = {
  starter_map: starterMap,
};

const mapSourceJson = {
  id: "starter_map",
  type: "map",
  orientation: "hexagonal",
  width: starterMap.width,
  height: starterMap.height,
  properties: [
    { name: "id", type: "string", value: "starter_map" },
    { name: "defaultTerrain", type: "string", value: "buildable" },
    { name: "spawnCoord", type: "string", value: JSON.stringify(starterMap.spawnCoord) },
    { name: "coreCoord", type: "string", value: JSON.stringify(starterMap.coreCoord) },
    { name: "pathCenterline", type: "string", value: JSON.stringify(starterMap.pathCenterline) }
  ],
  pathRoutes: starterMap.pathRoutes,
  terrainOverrides: starterMap.terrainOverrides
};

const visualsJson = {
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

const buildTargetsJson = {
  schemaVersion: 1,
  defaults: { web: "web-pwa" },
  targets: {
    "web-pwa": {
      id: "web-pwa",
      platform: "web",
      market: "pwa",
      storeChannel: "pwa",
      appId: `local.${args.name}`,
      appName: args.name,
      webDir: "dist",
      backgroundColor: "#111111",
      appVersion: "0.1.0"
    }
  }
};

const gitignoreContent = `.mycelium/
*.bak
`;

// ── Create directory structure ────────────────────────────────────────────────

ensureDir(projectDir);
ensureDir(path.join(projectDir, "content"));
ensureDir(path.join(projectDir, "maps", "compiled"));
ensureDir(path.join(projectDir, "maps", "src"));
ensureDir(path.join(projectDir, "assets"));

writeJson(path.join(projectDir, "project.json"), projectJson);
writeJson(path.join(projectDir, "content", "balance.json"), balanceJson);
writeJson(path.join(projectDir, "content", "world-map.json"), worldMapJson);
writeJson(path.join(projectDir, "content", "visuals.json"), visualsJson);
writeJson(path.join(projectDir, "build-targets.json"), buildTargetsJson);
writeJson(path.join(projectDir, "maps", "src", "starter_map.tmj"), mapSourceJson);
writeJson(path.join(projectDir, "maps", "compiled", "maps.json"), mapsJson);
fs.writeFileSync(path.join(projectDir, ".gitignore"), gitignoreContent, "utf8");

console.log(`Created ${projectName}/`);
console.log(`  project.json`);
console.log(`  content/balance.json       — 1 mission, 1 enemy, 1 tower, 1 wave set`);
console.log(`  content/world-map.json     — 1 region, 1 mission node`);
console.log(`  content/visuals.json       — empty asset catalog`);
console.log(`  build-targets.json         — web-pwa target`);
console.log(`  maps/src/starter_map.tmj   — editable map source`);
console.log(`  maps/compiled/maps.json    — 1 map (8×6 starter_map)`);
console.log(`  assets/                    — place image assets here`);
console.log();
console.log(`Next steps:`);
console.log(`  cd ${projectName}`);
console.log(`  node ../../packages/cli/validate.mjs`);
console.log(`  node ../../packages/cli/sim.mjs starter_01`);
