import type { GameContentRegistry } from "./registry.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  entityKind: string;
  entityId: string;
  fieldPath: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validateGameContentRegistry(content: GameContentRegistry): ValidationResult {
  const issues: ValidationIssue[] = [];

  const missionIds = new Set(Object.keys(content.missions));
  const mapIds = new Set(Object.keys(content.maps));
  const enemyIds = new Set(Object.keys(content.enemies));
  const towerIds = new Set(Object.keys(content.towers));
  const abilityIds = new Set(Object.keys(content.abilities));
  const waveSetIds = new Set(Object.keys(content.waveSets));
  const regionIds = new Set(content.worldMap.regions.map((r) => r.id));

  const err = (entityKind: string, entityId: string, fieldPath: string, message: string) => {
    issues.push({ severity: "error", entityKind, entityId, fieldPath, message });
  };
  const warn = (entityKind: string, entityId: string, fieldPath: string, message: string) => {
    issues.push({ severity: "warning", entityKind, entityId, fieldPath, message });
  };

  const requireFinite = (
    value: unknown,
    entityKind: string,
    entityId: string,
    fieldPath: string,
    opts: { positive?: boolean; allowNegative?: boolean } = {}
  ) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      err(entityKind, entityId, fieldPath, `${fieldPath} must be a finite number (got ${JSON.stringify(value)}).`);
      return false;
    }
    if (!opts.allowNegative && (opts.positive ? value <= 0 : value < 0)) {
      err(entityKind, entityId, fieldPath, `${fieldPath} must be ${opts.positive ? "> 0" : ">= 0"} (got ${value}).`);
      return false;
    }
    return true;
  };

  // Default mission
  if (!missionIds.has(content.defaultMissionId)) {
    err("registry", "root", "defaultMissionId", `Default mission "${content.defaultMissionId}" is not defined.`);
  }

  // Maps
  for (const [mapId, map] of Object.entries(content.maps)) {
    if (map.id !== mapId) {
      err("map", mapId, "id", `Map "${mapId}" has mismatched id "${map.id}".`);
    }
    if (map.width <= 0 || map.height <= 0) {
      err("map", mapId, "dimensions", `Map "${mapId}" has invalid dimensions ${map.width}×${map.height}.`);
    }
    if (map.pathCenterline.length < 2) {
      err("map", mapId, "pathCenterline", `Map "${mapId}" needs at least two path centerline points.`);
    }
    for (const route of map.pathRoutes ?? []) {
      if (!route.id) err("map", mapId, "pathRoutes", `Map "${mapId}" has a path route without an id.`);
      if (route.pathCenterline.length < 2) {
        err("map", mapId, `pathRoutes.${route.id}`, `Map "${mapId}" route "${route.id}" needs at least 2 centerline points.`);
      }
    }
    const allCoords = [map.spawnCoord, map.coreCoord, ...map.pathCenterline, ...(map.pathRoutes ?? []).flatMap((r) => r.pathCenterline), ...map.terrainOverrides];
    for (const coord of allCoords) {
      if (!coord || !Number.isFinite(coord.q) || !Number.isFinite(coord.r)) {
        err("map", mapId, "coords", `Map "${mapId}" has a malformed coord ${JSON.stringify(coord)}.`);
      } else if (coord.q < 0 || coord.r < 0 || coord.q >= map.width || coord.r >= map.height) {
        err("map", mapId, "coords", `Map "${mapId}" has out-of-bounds coord ${coord.q},${coord.r}.`);
      }
    }
  }

  // Wave sets
  for (const [waveSetId, waves] of Object.entries(content.waveSets)) {
    if (waves.length === 0) {
      err("waveSet", waveSetId, "waves", `Wave set "${waveSetId}" has no waves.`);
    }
    for (const wave of waves) {
      for (const group of wave.groups) {
        if (!enemyIds.has(group.enemyId)) {
          err("wave", wave.id, "groups.enemyId", `Wave "${wave.id}" references unknown enemy "${group.enemyId}".`);
        }
        requireFinite(group.count, "wave", wave.id, "groups.count", { positive: true });
        requireFinite(group.spawnInterval, "wave", wave.id, "groups.spawnInterval");
        requireFinite(group.startDelay, "wave", wave.id, "groups.startDelay");
      }
    }
  }

  // Towers
  for (const [towerId, tower] of Object.entries(content.towers)) {
    if (tower.id !== towerId) err("tower", towerId, "id", `Tower key "${towerId}" has mismatched id "${tower.id}".`);
    requireFinite(tower.footprintRadius, "tower", towerId, "footprintRadius");
    requireFinite(tower.range, "tower", towerId, "range", { positive: true });
    const attack = tower.attack;
    switch (attack.kind) {
      case "honey":
        requireFinite(attack.fireRate, "tower", towerId, "attack.fireRate", { positive: true });
        requireFinite(attack.damagePerMushroom, "tower", towerId, "attack.damagePerMushroom", { positive: true });
        requireFinite(attack.maxMushrooms, "tower", towerId, "attack.maxMushrooms", { positive: true });
        break;
      case "chaga":
        requireFinite(attack.pulseRate, "tower", towerId, "attack.pulseRate", { positive: true });
        requireFinite(attack.pulseDamage, "tower", towerId, "attack.pulseDamage");
        requireFinite(attack.sporeDamagePerUnit, "tower", towerId, "attack.sporeDamagePerUnit");
        break;
      case "oak_bolete":
        requireFinite(attack.interval, "tower", towerId, "attack.interval", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        break;
      case "chanterelle":
        requireFinite(attack.fireRate, "tower", towerId, "attack.fireRate", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        if (!Array.isArray(attack.maxTargetsByLevel)) {
          err("tower", towerId, "attack.maxTargetsByLevel", `Tower "${towerId}" chanterelle must define maxTargetsByLevel.`);
        }
        if (!Array.isArray(attack.upgradeCosts)) {
          err("tower", towerId, "attack.upgradeCosts", `Tower "${towerId}" chanterelle must define upgradeCosts.`);
        }
        break;
      case "slippery_jack":
        requireFinite(attack.interval, "tower", towerId, "attack.interval", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        requireFinite(attack.splashDamage, "tower", towerId, "attack.splashDamage");
        requireFinite(attack.armoredChipDamage, "tower", towerId, "attack.armoredChipDamage");
        requireFinite(attack.splashRadius, "tower", towerId, "attack.splashRadius");
        if (requireFinite(attack.slowFactor, "tower", towerId, "attack.slowFactor", { positive: true }) && attack.slowFactor >= 1) {
          err("tower", towerId, "attack.slowFactor", `Tower "${towerId}" slowFactor must be < 1 (got ${attack.slowFactor}).`);
        }
        requireFinite(attack.slowDuration, "tower", towerId, "attack.slowDuration", { positive: true });
        break;
      case "support":
        requireFinite(attack.auraRadius, "tower", towerId, "attack.auraRadius", { positive: true });
        for (const unlockId of attack.unlocksTowerIds) {
          if (!towerIds.has(unlockId)) err("tower", towerId, "attack.unlocksTowerIds", `Tower "${towerId}" unlocks unknown tower "${unlockId}".`);
        }
        break;
      case "support_buff":
        requireFinite(attack.auraRadius, "tower", towerId, "attack.auraRadius", { positive: true });
        if (!Array.isArray(attack.fireRateMultiplierByLevel) || attack.fireRateMultiplierByLevel.length !== 3) {
          err("tower", towerId, "attack.fireRateMultiplierByLevel", `Tower "${towerId}" support_buff must have 3 fireRateMultiplierByLevel values.`);
        }
        for (const affectedId of attack.affectsTowerIds) {
          if (!towerIds.has(affectedId)) err("tower", towerId, "attack.affectsTowerIds", `Tower "${towerId}" affects unknown tower "${affectedId}".`);
        }
        break;
    }
    if (tower.requiresAuraFrom && !towerIds.has(tower.requiresAuraFrom)) {
      err("tower", towerId, "requiresAuraFrom", `Tower "${towerId}" requires unknown aura tower "${tower.requiresAuraFrom}".`);
    }
  }

  // Enemies
  for (const [enemyId, enemy] of Object.entries(content.enemies)) {
    if (enemy.id !== enemyId) err("enemy", enemyId, "id", `Enemy key "${enemyId}" has mismatched id "${enemy.id}".`);
    requireFinite(enemy.maxHp, "enemy", enemyId, "maxHp", { positive: true });
    requireFinite(enemy.speed, "enemy", enemyId, "speed", { positive: true });
    requireFinite(enemy.coreDamage, "enemy", enemyId, "coreDamage", { positive: true });
    requireFinite(enemy.coinReward, "enemy", enemyId, "coinReward");
    if (enemy.spawnOnDeath) {
      if (!enemyIds.has(enemy.spawnOnDeath.enemyId)) {
        err("enemy", enemyId, "spawnOnDeath.enemyId", `Enemy "${enemyId}" spawnOnDeath references unknown enemy "${enemy.spawnOnDeath.enemyId}".`);
      }
      requireFinite(enemy.spawnOnDeath.count, "enemy", enemyId, "spawnOnDeath.count", { positive: true });
    }
    if (enemy.phaseSpawns) {
      for (const phase of enemy.phaseSpawns) {
        if (!enemyIds.has(phase.enemyId)) {
          err("enemy", enemyId, "phaseSpawns.enemyId", `Enemy "${enemyId}" phaseSpawn references unknown enemy "${phase.enemyId}".`);
        }
      }
    }
    if (enemy.armor && enemy.armor.kind !== "oak_bolete_only") {
      err("enemy", enemyId, "armor.kind", `Enemy "${enemyId}" armor kind "${enemy.armor.kind}" is not supported.`);
    }
  }

  // Missions
  for (const [missionId, mission] of Object.entries(content.missions)) {
    if (!mapIds.has(mission.mapId)) {
      err("mission", missionId, "mapId", `Mission "${missionId}" references unknown map "${mission.mapId}".`);
    }
    if (!waveSetIds.has(mission.waveSetId)) {
      err("mission", missionId, "waveSetId", `Mission "${missionId}" references unknown wave set "${mission.waveSetId}".`);
    }
    const missionMap = content.maps[mission.mapId];
    const missionWaveSet = content.waveSets[mission.waveSetId] ?? [];
    if (missionMap) {
      const routeIds = new Set((missionMap.pathRoutes ?? []).map((route) => route.id));
      for (const wave of missionWaveSet) {
        for (const group of wave.groups) {
          if (group.routeId && !routeIds.has(group.routeId)) {
            err(
              "wave",
              wave.id,
              "groups.routeId",
              `Wave "${wave.id}" routeId "${group.routeId}" is not present on mission "${missionId}" map "${mission.mapId}".`
            );
          }
        }
      }
    }
    for (const towerId of mission.buildTowerIds) {
      if (!towerIds.has(towerId)) {
        err("mission", missionId, "buildTowerIds", `Mission "${missionId}" lists unknown tower "${towerId}".`);
      }
    }
    for (const abilityId of mission.abilityIds) {
      if (!abilityIds.has(abilityId)) {
        err("mission", missionId, "abilityIds", `Mission "${missionId}" lists unknown ability "${abilityId}".`);
      }
    }
    requireFinite(mission.startingCoreHp, "mission", missionId, "startingCoreHp", { positive: true });
    requireFinite(mission.prepTimeUnits, "mission", missionId, "prepTimeUnits");
    if (mission.startingResources === null || typeof mission.startingResources !== "object") {
      err("mission", missionId, "startingResources", `Mission "${missionId}" startingResources must be an object.`);
    } else {
      if (mission.startingResources.coins !== undefined) {
        requireFinite(mission.startingResources.coins, "mission", missionId, "startingResources.coins");
      }
      if (mission.startingResources.oakRoots !== undefined) {
        requireFinite(mission.startingResources.oakRoots, "mission", missionId, "startingResources.oakRoots");
      }
    }
    if (mission.buildTowerIds.length === 0) {
      warn("mission", missionId, "buildTowerIds", `Mission "${missionId}" has no towers available to build.`);
    }
  }

  // World map
  for (const region of content.worldMap.regions) {
    for (const connectionId of region.connections) {
      if (!regionIds.has(connectionId)) {
        err("worldMap", region.id, "connections", `Region "${region.id}" connects to unknown region "${connectionId}".`);
      }
    }
  }
  const nodeCounts = new Map<string, number>();
  for (const node of content.worldMap.missionNodes) {
    if (!missionIds.has(node.missionId)) {
      err("worldMap", node.missionId, "missionId", `World map node references unknown mission "${node.missionId}".`);
    }
    if (!regionIds.has(node.regionId)) {
      err("worldMap", node.missionId, "regionId", `Mission node "${node.missionId}" references unknown region "${node.regionId}".`);
    }
    for (const requiredId of node.unlockRequiresMissionIds) {
      if (!missionIds.has(requiredId)) {
        err("worldMap", node.missionId, "unlockRequiresMissionIds", `Mission "${node.missionId}" requires unknown mission "${requiredId}".`);
      }
    }
    nodeCounts.set(node.missionId, (nodeCounts.get(node.missionId) ?? 0) + 1);
  }
  for (const missionId of missionIds) {
    const count = nodeCounts.get(missionId) ?? 0;
    if (count === 0) warn("worldMap", missionId, "missionNodes", `Mission "${missionId}" has no world map node.`);
    else if (count > 1) err("worldMap", missionId, "missionNodes", `Mission "${missionId}" has ${count} world map nodes (expected 1).`);
  }

  return {
    ok: issues.filter((i) => i.severity === "error").length === 0,
    issues
  };
}

/** Alias of validateGameContentRegistry — validates all cross-references and numeric guards in a content registry. */
export function validateProject(content: GameContentRegistry): ValidationResult {
  return validateGameContentRegistry(content);
}
