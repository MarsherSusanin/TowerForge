// create.mjs — Scaffold a new .tdproj project from a genre template.
// Usage: node create.mjs <name> [--dir <path>] [--template classic|maze|idle|roguelike]
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getTemplate, TEMPLATE_NAMES } from "./lib/templates.mjs";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const raw = process.argv.slice(2);
  const result = { name: null, dir: null, template: "classic" };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "--dir" && raw[i + 1]) {
      result.dir = path.resolve(raw[i + 1]);
      i += 2;
    } else if (raw[i] === "--template" && raw[i + 1]) {
      result.template = raw[i + 1];
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
  console.error("Usage: node create.mjs <name> [--dir <path>] [--template <name>]");
  console.error("  name        Project name (will create <name>.tdproj directory)");
  console.error("  --dir       Parent directory for the project (default: current directory)");
  console.error(`  --template  Starter game: ${TEMPLATE_NAMES.join(" | ")} (default: classic)`);
  process.exit(1);
}

// Sanitize name: only word chars, hyphens, underscores
if (!/^[\w_-]+$/.test(args.name)) {
  console.error(`Invalid project name "${args.name}". Use only letters, digits, hyphens, and underscores.`);
  process.exit(1);
}

if (!TEMPLATE_NAMES.includes(args.template)) {
  console.error(`Unknown template "${args.template}". Choose one of: ${TEMPLATE_NAMES.join(", ")}.`);
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

// ── Content ─────────────────────────────────────────────────────────────────
// Genre-specific content (balance, maps, world map) comes from the template; the rest of the
// scaffolding (manifest, visuals, build target) is shared.

const template = getTemplate(args.template);
const balanceJson = template.balance;
const worldMapJson = template.worldMap;
const mapsJson = template.maps;          // { [mapId]: compiledMap }
const mapSourcesJson = template.mapSources; // { [mapId]: tmjSource }

const projectJson = {
  schemaVersion: 1,
  name: args.name,
  description: `A ${args.template} tower-defense game built with TowerForge.`,
  author: "",
};

const visualsJson = {
  schemaVersion: 1,
  assetsRoot: "assets",
  atlases: {},
  sprites: {},
  bindings: { towers: {}, enemies: {}, tiles: {}, ui: {} }
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

const gitignoreContent = `.towerforge/
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
for (const [mapId, source] of Object.entries(mapSourcesJson)) {
  writeJson(path.join(projectDir, "maps", "src", `${mapId}.tmj`), source);
}
writeJson(path.join(projectDir, "maps", "compiled", "maps.json"), mapsJson);
fs.writeFileSync(path.join(projectDir, ".gitignore"), gitignoreContent, "utf8");

// ── Summary ───────────────────────────────────────────────────────────────────

const missionIds = Object.keys(balanceJson.missions ?? {});
const counts = {
  missions: missionIds.length,
  enemies: Object.keys(balanceJson.enemies ?? {}).length,
  towers: Object.keys(balanceJson.towers ?? {}).length,
  maps: Object.keys(mapsJson).length,
  currencies: (balanceJson.currencies ?? []).length
};

console.log(`Created ${projectName}/  (template: ${args.template})`);
console.log(`  content/balance.json       — ${counts.missions} mission(s), ${counts.enemies} enemies, ${counts.towers} towers, ${counts.currencies} currenc(ies)`);
console.log(`  content/world-map.json     — ${(worldMapJson.missionNodes ?? []).length} mission node(s)`);
console.log(`  maps/compiled/maps.json    — ${counts.maps} map(s)`);
console.log(`  build-targets.json         — web-pwa target`);
console.log();
console.log(`Next steps:`);
console.log(`  node packages/cli/bin/towerforge.mjs validate --project ${projectName}`);
console.log(`  node packages/cli/bin/towerforge.mjs balance  --project ${projectName}`);
console.log(`  node packages/cli/bin/towerforge.mjs studio   --project ${projectName}`);
