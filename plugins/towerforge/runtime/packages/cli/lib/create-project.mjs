import fs from "node:fs";
import path from "node:path";
import { agentProjectGuide } from "./agent-connect.mjs";
import { getTemplate, TEMPLATE_NAMES } from "./templates.mjs";

export { TEMPLATE_NAMES };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function validateProjectName(name) {
  if (typeof name !== "string" || !/^[\w_-]+$/.test(name)) {
    throw new Error(`Invalid project name "${name ?? ""}". Use only letters, digits, hyphens, and underscores.`);
  }
  return name;
}

export function createProject({ name, parentDir = process.cwd(), templateName = "classic", gridKind = "hex" }) {
  validateProjectName(name);
  if (!TEMPLATE_NAMES.includes(templateName)) {
    throw new Error(`Unknown template "${templateName}". Choose one of: ${TEMPLATE_NAMES.join(", ")}.`);
  }
  if (gridKind !== "hex" && gridKind !== "square") throw new Error('gridKind must be "hex" or "square".');

  const resolvedParent = path.resolve(parentDir);
  const projectName = `${name}.tdproj`;
  const projectDir = path.join(resolvedParent, projectName);
  if (fs.existsSync(projectDir)) {
    throw new Error(`Directory already exists: ${projectDir}`);
  }

  const template = getTemplate(templateName, { gridKind });
  const balanceJson = template.balance;
  const worldMapJson = template.worldMap;
  const mapsJson = template.maps;
  const mapSourcesJson = template.mapSources;
  const projectJson = {
    schemaVersion: 2,
    name,
    description: `A ${templateName} tower-defense game built with TowerForge.`,
    author: "",
  };
  const visualsJson = {
    schemaVersion: 2,
    assetsRoot: "assets",
    atlases: {},
    sprites: {},
    tileSets: {},
    bindings: { towers: {}, enemies: {}, tiles: {}, tileSets: { grids: {}, maps: {} }, ui: {} }
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
        appId: `local.${name}`,
        appName: name,
        webDir: "dist",
        backgroundColor: "#111111",
        appVersion: "0.1.0"
      }
    }
  };
  const starterScript = {
    schemaVersion: 2,
    id: "starter_gameplay",
    label: "Starter gameplay hooks",
    description: "A safe TowerScript example. Extend handlers or add more files under scripts/.",
    enabled: true,
    bindings: [{ scope: "global" }],
    initialState: { wavesStarted: 0 },
    handlers: {
      waveStarted: [{
        id: "count_waves",
        actions: [{ action: "incrementState", key: "wavesStarted", amount: 1 }]
      }]
    }
  };

  ensureDir(path.join(projectDir, "content"));
  ensureDir(path.join(projectDir, "maps", "compiled"));
  ensureDir(path.join(projectDir, "maps", "src"));
  ensureDir(path.join(projectDir, "assets"));
  ensureDir(path.join(projectDir, "scripts", "gameplay"));
  writeJson(path.join(projectDir, "project.json"), projectJson);
  writeJson(path.join(projectDir, "content", "balance.json"), balanceJson);
  writeJson(path.join(projectDir, "content", "world-map.json"), worldMapJson);
  writeJson(path.join(projectDir, "content", "visuals.json"), visualsJson);
  writeJson(path.join(projectDir, "build-targets.json"), buildTargetsJson);
  for (const [mapId, source] of Object.entries(mapSourcesJson)) {
    writeJson(path.join(projectDir, "maps", "src", `${mapId}.tmj`), source);
  }
  writeJson(path.join(projectDir, "maps", "compiled", "maps.json"), mapsJson);
  writeJson(path.join(projectDir, "scripts", "gameplay", "starter-gameplay.tower.json"), starterScript);
  fs.writeFileSync(path.join(projectDir, ".gitignore"), ".towerforge/\n*.bak\n", "utf8");
  fs.writeFileSync(path.join(projectDir, "AGENTS.md"), agentProjectGuide(projectName), "utf8");

  return {
    projectDir,
    projectName,
    templateName,
    gridKind,
    counts: {
      missions: Object.keys(balanceJson.missions ?? {}).length,
      enemies: Object.keys(balanceJson.enemies ?? {}).length,
      towers: Object.keys(balanceJson.towers ?? {}).length,
      maps: Object.keys(mapsJson).length,
      currencies: (balanceJson.currencies ?? []).length,
      missionNodes: (worldMapJson.missionNodes ?? []).length
    }
  };
}
