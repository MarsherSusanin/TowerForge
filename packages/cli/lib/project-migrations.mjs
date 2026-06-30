import fs from "node:fs";
import path from "node:path";
import { PROJECT_SCHEMA_VERSION, normalizeManifest, normalizeVisuals } from "./project-schema.mjs";

export function migrateProjectFiles(rawFiles) {
  const files = clone(rawFiles);
  const migrations = [];

  const fromVersion = Number.isInteger(files.manifest?.schemaVersion) ? files.manifest.schemaVersion : 0;
  const visualsNeedsV1 = !Number.isInteger(files.visuals?.schemaVersion) || files.visuals?.assetsRoot === undefined;
  files.manifest = normalizeManifest(files.manifest);
  files.visuals = normalizeVisuals(files.visuals);

  if (fromVersion === 0) {
    migrations.push({
      id: "project-schema-v1",
      description: "Add project.json schemaVersion and normalize local-first visual catalog defaults."
    });
  }
  if (visualsNeedsV1) {
    pushUnique(migrations, "visual-catalog-v1", "Add visuals schemaVersion, assetsRoot, sprites, and bindings defaults.");
  }

  for (const mission of Object.values(files.balance?.missions ?? {})) {
    if (mission.availability === "available") {
      mission.availability = "playable";
      pushUnique(migrations, "mission-availability-playable", "Rename legacy mission availability \"available\" to \"playable\".");
    }
    if (mission.sunlightModifier && !mission.sunlight) {
      mission.sunlight = mission.sunlightModifier;
      delete mission.sunlightModifier;
      pushUnique(migrations, "mission-sunlight", "Rename legacy mission sunlightModifier to sunlight.");
    }
  }

  // The engine no longer hardcodes oak_stump/oak_stump_boss as path blockers; carry the
  // legacy behavior forward by tagging those enemies with the explicit isPathBlocker flag.
  for (const [enemyId, enemy] of Object.entries(files.balance?.enemies ?? {})) {
    if ((enemyId === "oak_stump" || enemyId === "oak_stump_boss") && enemy.isPathBlocker === undefined) {
      enemy.isPathBlocker = true;
      pushUnique(migrations, "enemy-path-blocker", "Tag legacy oak_stump/oak_stump_boss enemies with isPathBlocker.");
    }
  }

  for (const target of Object.values(files.buildTargets?.targets ?? {})) {
    if (target.outputDir && !target.webDir) {
      target.webDir = target.outputDir;
      pushUnique(migrations, "build-target-web-dir", "Rename legacy build target outputDir to webDir.");
    }
  }

  files.manifest.schemaVersion = PROJECT_SCHEMA_VERSION;
  return { files, migrations };
}

export function writeMigratedProjectFiles(projectDir, files) {
  const writes = [
    ["project.json", files.manifest],
    ["content/visuals.json", files.visuals],
    ["content/balance.json", files.balance],
    ["build-targets.json", files.buildTargets]
  ];
  for (const [relPath, data] of writes) {
    const filePath = path.join(projectDir, relPath);
    backupFile(projectDir, filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
}

function pushUnique(migrations, id, description) {
  if (!migrations.some((migration) => migration.id === id)) {
    migrations.push({ id, description });
  }
}

function backupFile(projectDir, filePath) {
  if (!fs.existsSync(filePath)) return;
  const backupDir = path.join(projectDir, ".mycelium", "migration-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `${path.basename(filePath)}.${stamp}.bak`);
  fs.copyFileSync(filePath, dest);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}
