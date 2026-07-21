import fs from "node:fs";
import path from "node:path";
import { PROJECT_SCHEMA_VERSION, normalizeManifest, normalizeVisuals } from "./project-schema.mjs";

// Legacy mushroom-themed mechanic identifiers → generic, reskinnable names.
const ATTACK_KIND_RENAMES = {
  honey: "single",
  chaga: "pulse",
  oak_bolete: "sniper",
  chanterelle: "antiair",
  slippery_jack: "splash"
};
const ATTACK_FIELD_RENAMES = {
  damagePerMushroom: "damagePerStack",
  startingMushrooms: "startingStacks",
  maxMushrooms: "maxStacks",
  sporeDamagePerUnit: "dotDamagePerUnit",
  sporeDuration: "dotDuration"
};

// ── Migration registry ──────────────────────────────────────────────────────
// An ordered list of named, independently-reviewable content fixups, each a pure
// `apply(files): boolean` that mutates in place and reports whether it changed anything.
//
// `from`/`to` describe the schema range a step introduced. Older v1 cleanup steps still use
// content probes because some schemaVersion:1 projects predate those fixups. The v1 -> v2 step
// introduces per-map grids, typed terrain, and the visual tileset catalog. Every apply function
// remains idempotent so partially-authored or hand-edited projects can be normalized safely.
const MIGRATIONS = [
  {
    id: "mission-availability-playable",
    from: 0,
    to: 1,
    description: 'Rename legacy mission availability "available" to "playable".',
    apply(files) {
      let changed = false;
      for (const mission of Object.values(files.balance?.missions ?? {})) {
        if (mission.availability === "available") {
          mission.availability = "playable";
          changed = true;
        }
      }
      return changed;
    }
  },
  {
    id: "mission-sunlight",
    from: 0,
    to: 1,
    description: "Rename legacy mission sunlightModifier to sunlight.",
    apply(files) {
      let changed = false;
      for (const mission of Object.values(files.balance?.missions ?? {})) {
        if (mission.sunlightModifier && !mission.sunlight) {
          mission.sunlight = mission.sunlightModifier;
          delete mission.sunlightModifier;
          changed = true;
        }
      }
      return changed;
    }
  },
  {
    id: "enemy-path-blocker",
    from: 0,
    to: 1,
    description: "Tag legacy oak_stump/oak_stump_boss enemies with isPathBlocker.",
    // The engine no longer hardcodes oak_stump/oak_stump_boss as path blockers; carry the
    // legacy behavior forward by tagging those enemies with the explicit isPathBlocker flag.
    apply(files) {
      let changed = false;
      for (const [enemyId, enemy] of Object.entries(files.balance?.enemies ?? {})) {
        if ((enemyId === "oak_stump" || enemyId === "oak_stump_boss") && enemy.isPathBlocker === undefined) {
          enemy.isPathBlocker = true;
          changed = true;
        }
      }
      return changed;
    }
  },
  {
    id: "attack-kind-taxonomy",
    from: 0,
    to: 1,
    description: "Rename mushroom-themed attack kinds (honey/chaga/oak_bolete/chanterelle/slippery_jack) to generic kinds (single/pulse/sniper/antiair/splash).",
    // De-theming: the mushroom-themed mechanic vocabulary became generic so any project can
    // reskin towers.
    apply(files) {
      let changed = false;
      for (const tower of Object.values(files.balance?.towers ?? {})) {
        const attack = tower?.attack;
        if (attack && typeof attack === "object" && Object.prototype.hasOwnProperty.call(ATTACK_KIND_RENAMES, attack.kind)) {
          attack.kind = ATTACK_KIND_RENAMES[attack.kind];
          changed = true;
        }
      }
      return changed;
    }
  },
  {
    id: "attack-field-taxonomy",
    from: 0,
    to: 1,
    description: "Rename mushroom-themed attack fields (*Mushroom*/spore*) to generic stack/dot fields.",
    apply(files) {
      let changed = false;
      for (const tower of Object.values(files.balance?.towers ?? {})) {
        const attack = tower?.attack;
        if (!attack || typeof attack !== "object") continue;
        for (const [oldField, newField] of Object.entries(ATTACK_FIELD_RENAMES)) {
          if (attack[oldField] !== undefined) {
            // Prefer an already-present new value; always drop the legacy key so no stale field lingers.
            if (attack[newField] === undefined) attack[newField] = attack[oldField];
            delete attack[oldField];
            changed = true;
          }
        }
      }
      return changed;
    }
  },
  {
    id: "armor-kind-taxonomy",
    from: 0,
    to: 1,
    description: "Rename enemy armor kind oak_bolete_only to pierce_only.",
    apply(files) {
      let changed = false;
      for (const enemy of Object.values(files.balance?.enemies ?? {})) {
        if (enemy?.armor && enemy.armor.kind === "oak_bolete_only") {
          enemy.armor.kind = "pierce_only";
          changed = true;
        }
      }
      return changed;
    }
  },
  {
    id: "audio-event-area-pulse",
    from: 0,
    to: 1,
    description: "Rename custom-sound binding for the chagaPulse event to areaPulse.",
    // The chaga pulse event was renamed to areaPulse; carry any custom sound binding forward.
    apply(files) {
      const audioEvents = files.visuals?.audio?.events;
      if (audioEvents && typeof audioEvents === "object" && audioEvents.chagaPulse !== undefined) {
        audioEvents.areaPulse ??= audioEvents.chagaPulse;
        delete audioEvents.chagaPulse;
        return true;
      }
      return false;
    }
  },
  {
    id: "build-target-web-dir",
    from: 0,
    to: 1,
    description: "Rename legacy build target outputDir to webDir.",
    apply(files) {
      let changed = false;
      for (const target of Object.values(files.buildTargets?.targets ?? {})) {
        if (target.outputDir && !target.webDir) {
          target.webDir = target.outputDir;
          changed = true;
        }
      }
      return changed;
    }
  },
  {
    id: "currency-registry",
    from: 0,
    to: 1,
    description: 'Declare balance.currencies for every referenced currency (coins primary; legacy oakRoots labeled "Oak Roots").',
    // Currency registry: legacy projects implied currencies only through resource-bag keys
    // (coins + the old oakRoots). Declare balance.currencies so every referenced currency is a
    // first-class, editable entry (coins is always the primary). Also auto-declares any currency
    // a bag references but the registry forgot.
    apply(files) {
      if (!files.balance) return false;
      const b = files.balance;
      const existing = Array.isArray(b.currencies) ? b.currencies : null;
      const referenced = new Set(["coins"]);
      const scanBag = (bag) => {
        if (bag && typeof bag === "object") for (const key of Object.keys(bag)) referenced.add(key);
      };
      scanBag(b.constants?.startingResources);
      scanBag(b.constants?.moveTowerCost);
      for (const tower of Object.values(b.towers ?? {})) {
        scanBag(tower?.cost);
        for (const uc of tower?.attack?.upgradeCosts ?? []) scanBag(uc);
      }
      for (const enemy of Object.values(b.enemies ?? {})) scanBag(enemy?.reward);
      for (const mission of Object.values(b.missions ?? {})) scanBag(mission?.startingResources);

      const list = existing ? existing.filter((c) => c && typeof c.id === "string" && c.id) : [];
      const have = new Set(list.map((c) => c.id));
      const labels = { coins: "Coins", oakRoots: "Oak Roots" };
      let changed = existing === null;
      if (!have.has("coins")) {
        list.unshift({ id: "coins", label: "Coins" });
        have.add("coins");
        changed = true;
      }
      for (const id of referenced) {
        if (!have.has(id)) {
          list.push({ id, label: labels[id] ?? id });
          have.add(id);
          changed = true;
        }
      }
      if (changed) b.currencies = list;
      return changed;
    }
  },
  {
    id: "grid-terrain-visual-schema-v2",
    from: 1,
    to: 2,
    description: "Add per-map grid topology, typed terrain defaults, and the v2 tileset catalog.",
    apply(files) {
      let changed = false;
      for (const map of Object.values(files.maps ?? {})) {
        if (!map.grid) {
          map.grid = { kind: "hex", layout: "odd-r" };
          changed = true;
        }
      }
      if (!files.balance.terrainTypes) {
        const waterSpeed = Number.isFinite(files.balance?.constants?.waterGroundSpeedFactor)
          ? files.balance.constants.waterGroundSpeedFactor
          : 0.6;
        files.balance.terrainTypes = defaultTerrainTypes(waterSpeed);
        changed = true;
      }
      if (files.visuals.schemaVersion !== 2) {
        files.visuals.schemaVersion = 2;
        changed = true;
      }
      files.visuals.tileSets ??= {};
      files.visuals.bindings ??= {};
      if (!files.visuals.bindings.tileSets) {
        files.visuals.bindings.tileSets = { grids: {}, maps: {} };
        changed = true;
      }
      return changed;
    }
  }
];

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
    migrations.push({ id: "visual-catalog-v1", description: "Add visuals schemaVersion, assetsRoot, sprites, and bindings defaults." });
  }

  for (const step of MIGRATIONS) {
    // Content probes intentionally still run at the target version to repair older partially
    // normalized projects; a strictly newer schema skips steps it has superseded.
    if (fromVersion > step.to) continue;
    if (step.apply(files)) {
      migrations.push({ id: step.id, description: step.description });
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
    ["maps/compiled/maps.json", files.maps],
    ["build-targets.json", files.buildTargets]
  ];
  for (const [relPath, data] of writes) {
    const filePath = path.join(projectDir, relPath);
    backupFile(projectDir, filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }
}

function backupFile(projectDir, filePath) {
  if (!fs.existsSync(filePath)) return;
  const backupDir = path.join(projectDir, ".towerforge", "migration-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupDir, `${path.basename(filePath)}.${stamp}.bak`);
  fs.copyFileSync(filePath, dest);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function defaultTerrainTypes(waterSpeed = 0.6) {
  return {
    buildable: { id: "buildable", label: "Buildable", buildable: true, walkable: true, groundSpeedMultiplier: 1, tags: ["ground"] },
    path: { id: "path", label: "Path", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["path"] },
    blocked: { id: "blocked", label: "Blocked", buildable: false, walkable: false, groundSpeedMultiplier: 1, tags: ["blocked"] },
    core: { id: "core", label: "Core", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["objective"] },
    spawn: { id: "spawn", label: "Spawn", buildable: false, walkable: true, groundSpeedMultiplier: 1, tags: ["spawn"] },
    water: { id: "water", label: "Water", buildable: false, walkable: true, groundSpeedMultiplier: waterSpeed, tags: ["water"] }
  };
}
