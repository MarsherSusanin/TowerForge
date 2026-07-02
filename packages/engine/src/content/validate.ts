import { ABILITY_IDS, ATTACK_KIND_IDS } from "./schema-descriptor.js";
import type { GameContentRegistry } from "./registry.js";

/**
 * `code` is a STABLE, machine-branchable identifier — derived automatically from
 * `entityKind`+`fieldPath` (see `deriveValidationCode`) unless a call site overrides it, so every
 * issue gets one for free. `hint`/`expected`/`got` are populated where cheap/curated (not every
 * call site); the MCP `explain_validation` tool looks a `code` up against a small curated map and
 * falls back to the issue's own `message` when no curated hint exists yet.
 *
 * CAVEAT: `code` is a COARSE grouping key, not a guaranteed-unique one. It upper-cases the whole
 * derivation input, so two field paths that differ only by case in an author-defined id segment
 * (e.g. a currency cost bag for currencies "gem_shards" vs "GEM_SHARDS") derive the SAME code. A
 * caller that needs to distinguish two issues precisely should key on `fieldPath` (which embeds
 * the literal id and is always distinct), not `code` alone.
 */
export interface ValidationIssue {
  severity: "error" | "warning";
  entityKind: string;
  entityId: string;
  fieldPath: string;
  message: string;
  code: string;
  hint?: string;
  expected?: string;
  got?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Derives a stable code like "TOWER_ATTACK_SLOWFACTOR" from entityKind + fieldPath. See the
 *  ValidationIssue.code caveat above — this is a coarse key, not a unique one. */
export function deriveValidationCode(entityKind: string, fieldPath: string): string {
  return `${entityKind}_${fieldPath}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface IssueExtra {
  code?: string;
  hint?: string;
  expected?: string;
  got?: string;
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

  const err = (entityKind: string, entityId: string, fieldPath: string, message: string, extra: IssueExtra = {}) => {
    issues.push({ severity: "error", entityKind, entityId, fieldPath, message, code: extra.code ?? deriveValidationCode(entityKind, fieldPath), hint: extra.hint, expected: extra.expected, got: extra.got });
  };
  const warn = (entityKind: string, entityId: string, fieldPath: string, message: string, extra: IssueExtra = {}) => {
    issues.push({ severity: "warning", entityKind, entityId, fieldPath, message, code: extra.code ?? deriveValidationCode(entityKind, fieldPath), hint: extra.hint, expected: extra.expected, got: extra.got });
  };

  const requireFinite = (
    value: unknown,
    entityKind: string,
    entityId: string,
    fieldPath: string,
    opts: { positive?: boolean; allowNegative?: boolean } = {}
  ) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      err(entityKind, entityId, fieldPath, `${fieldPath} must be a finite number (got ${JSON.stringify(value)}).`, {
        expected: "finite number",
        got: JSON.stringify(value)
      });
      return false;
    }
    if (!opts.allowNegative && (opts.positive ? value <= 0 : value < 0)) {
      const expected = opts.positive ? "> 0" : ">= 0";
      err(entityKind, entityId, fieldPath, `${fieldPath} must be ${expected} (got ${value}).`, { expected, got: String(value) });
      return false;
    }
    return true;
  };

  // Currencies — the declared spendable set; "coins" is required as the primary currency.
  const currencyIds = new Set<string>();
  for (const currency of content.currencies ?? []) {
    if (!currency || typeof currency.id !== "string" || currency.id.length === 0) {
      err("currency", "?", "id", `A currency is missing a valid id.`);
      continue;
    }
    if (currencyIds.has(currency.id)) {
      err("currency", currency.id, "id", `Duplicate currency id "${currency.id}".`);
    }
    if (!/^[A-Za-z0-9_]+$/.test(currency.id)) {
      err("currency", currency.id, "id", `Currency id "${currency.id}" must be alphanumeric/underscore.`);
    }
    currencyIds.add(currency.id);
    if (typeof currency.label !== "string" || currency.label.length === 0) {
      err("currency", currency.id, "label", `Currency "${currency.id}" needs a non-empty label.`);
    }
  }
  if (!currencyIds.has("coins")) {
    err("currency", "coins", "id", `A "coins" currency is required as the primary currency.`);
    currencyIds.add("coins");
  }

  /** Validate a resource bag: every key must be a declared currency, every amount a finite number >= 0. */
  const validateBag = (
    bag: unknown,
    entityKind: string,
    entityId: string,
    fieldPath: string
  ) => {
    if (bag === undefined || bag === null) return;
    if (typeof bag !== "object") {
      err(entityKind, entityId, fieldPath, `${fieldPath} must be an object.`);
      return;
    }
    for (const [id, amount] of Object.entries(bag as Record<string, unknown>)) {
      if (!currencyIds.has(id)) {
        err(entityKind, entityId, `${fieldPath}.${id}`, `Unknown currency "${id}" — declare it in balance.currencies.`);
      }
      requireFinite(amount, entityKind, entityId, `${fieldPath}.${id}`);
    }
  };

  // Constants resource bags
  validateBag(content.constants?.startingResources, "registry", "constants", "startingResources");
  validateBag(content.constants?.moveTowerCost, "registry", "constants", "moveTowerCost");

  // Default mission
  if (!missionIds.has(content.defaultMissionId)) {
    err("registry", "root", "defaultMissionId", `Default mission "${content.defaultMissionId}" is not defined.`);
  }

  /** Shared by a tower's attack.statusOnHit and an ability's {kind:"status"} effect — one status vocabulary, one validator. */
  const validateStatusEffectSpec = (
    spec: { stun?: unknown; slow?: { factor?: unknown; duration?: unknown }; poison?: { dps?: unknown; duration?: unknown } },
    entityKind: string,
    entityId: string,
    fieldPath: string
  ) => {
    if (spec.stun !== undefined) requireFinite(spec.stun, entityKind, entityId, `${fieldPath}.stun`, { positive: true });
    if (spec.slow) {
      if (requireFinite(spec.slow.factor, entityKind, entityId, `${fieldPath}.slow.factor`, { positive: true }) && (spec.slow.factor as number) >= 1) {
        err(entityKind, entityId, `${fieldPath}.slow.factor`, `${fieldPath}.slow.factor must be < 1.`, {
          expected: "0 < factor < 1",
          got: String(spec.slow.factor),
          hint: "slow.factor multiplies speed (0.5 = half speed) — it must be strictly less than 1, or the enemy wouldn't actually slow down."
        });
      }
      requireFinite(spec.slow.duration, entityKind, entityId, `${fieldPath}.slow.duration`, { positive: true });
    }
    if (spec.poison) {
      requireFinite(spec.poison.dps, entityKind, entityId, `${fieldPath}.poison.dps`, { positive: true });
      requireFinite(spec.poison.duration, entityKind, entityId, `${fieldPath}.poison.duration`, { positive: true });
    }
  };

  // Abilities — `path_water`/`strike`/`freeze` are engine-implemented presets (schema-descriptor.ts
  // is the single source of truth for their required fields); any OTHER id is a custom,
  // author-defined ability and must declare `effects` (a composition of the same damage/status
  // primitives a tower attack can carry). An id may also be one of the three presets AND declare
  // `effects` — that explicit composition then overrides the built-in behavior.
  const PRESET_ABILITY_IDS = new Set<string>(ABILITY_IDS);
  for (const [abilityId, ability] of Object.entries(content.abilities)) {
    if (!ability) continue;
    const isPreset = PRESET_ABILITY_IDS.has(abilityId);
    const hasEffects = Array.isArray(ability.effects) && ability.effects.length > 0;
    if (!isPreset && !hasEffects) {
      err(
        "ability",
        abilityId,
        "id",
        `Unknown ability "${abilityId}" — declare "effects" for a custom ability, or use a preset id (${ABILITY_IDS.join(", ")}).`,
        {
          expected: `a preset id (${ABILITY_IDS.join(", ")}) or an "effects" array`,
          got: abilityId,
          hint: 'Any ability id is valid once it declares effects: [{kind:"damage", amount} | {kind:"status", status:{stun|slow|poison}}] — call describe_schema for the exact shape.'
        }
      );
      continue;
    }
    requireFinite(ability.cooldown, "ability", abilityId, "cooldown");
    requireFinite(ability.radius, "ability", abilityId, "radius", { positive: true });
    if (hasEffects) {
      ability.effects!.forEach((effect, i) => {
        if (!effect || typeof effect !== "object") {
          err("ability", abilityId, `effects[${i}]`, `${abilityId} effects[${i}] must be an object.`);
          return;
        }
        if (effect.kind === "damage") {
          requireFinite(effect.amount, "ability", abilityId, `effects[${i}].amount`, { positive: true });
        } else if (effect.kind === "status") {
          validateStatusEffectSpec(effect.status ?? {}, "ability", abilityId, `effects[${i}].status`);
        } else {
          err("ability", abilityId, `effects[${i}].kind`, `${abilityId} effects[${i}].kind must be "damage" or "status".`);
        }
      });
    } else {
      // No explicit effects: falls back to the built-in preset, which needs its own legacy fields.
      if (abilityId === "path_water" || abilityId === "freeze") {
        requireFinite(ability.duration, "ability", abilityId, "duration", { positive: true });
      }
      if (abilityId === "strike") {
        requireFinite(ability.damage, "ability", abilityId, "damage", { positive: true });
      }
      if (abilityId === "freeze" && ability.stunDuration !== undefined) {
        requireFinite(ability.stunDuration, "ability", abilityId, "stunDuration", { positive: true });
      }
    }
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
  const knownAttackKinds = new Set<string>(ATTACK_KIND_IDS);
  for (const [towerId, tower] of Object.entries(content.towers)) {
    if (tower.id !== towerId) err("tower", towerId, "id", `Tower key "${towerId}" has mismatched id "${tower.id}".`);
    requireFinite(tower.footprintRadius, "tower", towerId, "footprintRadius");
    requireFinite(tower.range, "tower", towerId, "range", { positive: true });
    if (tower.maxHp !== undefined) requireFinite(tower.maxHp, "tower", towerId, "maxHp", { positive: true });
    validateBag(tower.cost, "tower", towerId, "cost");
    if (tower.requiresAuraFrom && !towerIds.has(tower.requiresAuraFrom)) {
      err("tower", towerId, "requiresAuraFrom", `Tower "${towerId}" requires unknown aura tower "${tower.requiresAuraFrom}".`);
    }

    // Guard against untyped/agent-authored JSON that omits "attack" entirely (TowerType's TS
    // shape declares it required, but a validator's whole job is checking data that may not match
    // that contract) — report ONE clear issue and move on, rather than letting every attack-shaped
    // access below (upgradeCosts, the kind switch, damageType, statusOnHit) throw on undefined.
    const rawAttack: unknown = tower.attack;
    if (!rawAttack || typeof rawAttack !== "object" || Array.isArray(rawAttack)) {
      err("tower", towerId, "attack", `Tower "${towerId}" is missing an "attack" object.`, {
        expected: "an attack object with a kind",
        got: JSON.stringify(rawAttack),
        hint: 'Every tower needs attack: { kind, ... }. Call describe_schema for the exact required fields per kind.'
      });
      continue;
    }
    if (!knownAttackKinds.has((tower.attack as { kind?: string }).kind ?? "")) {
      err("tower", towerId, "attack.kind", `Tower "${towerId}" has unknown attack.kind "${(tower.attack as { kind?: string }).kind}".`, {
        expected: [...knownAttackKinds].join("|"),
        got: String((tower.attack as { kind?: string }).kind),
        hint: `attack.kind must be one of the engine-implemented kinds: ${[...knownAttackKinds].join(", ")}. Call describe_schema to see each kind's required fields.`
      });
    }
    const attack = tower.attack;
    if (Array.isArray((attack as { upgradeCosts?: unknown[] }).upgradeCosts)) {
      (attack as { upgradeCosts: unknown[] }).upgradeCosts.forEach((uc, i) =>
        validateBag(uc, "tower", towerId, `attack.upgradeCosts[${i}]`)
      );
    }
    switch (attack.kind) {
      case "single":
        requireFinite(attack.fireRate, "tower", towerId, "attack.fireRate", { positive: true });
        requireFinite(attack.damagePerStack, "tower", towerId, "attack.damagePerStack", { positive: true });
        requireFinite(attack.maxStacks, "tower", towerId, "attack.maxStacks", { positive: true });
        if (attack.chain) {
          requireFinite(attack.chain.maxJumps, "tower", towerId, "attack.chain.maxJumps", { positive: true });
          requireFinite(attack.chain.jumpRadius, "tower", towerId, "attack.chain.jumpRadius", { positive: true });
          requireFinite(attack.chain.damageFalloff, "tower", towerId, "attack.chain.damageFalloff", { positive: true });
        }
        break;
      case "pulse":
        requireFinite(attack.pulseRate, "tower", towerId, "attack.pulseRate", { positive: true });
        requireFinite(attack.pulseDamage, "tower", towerId, "attack.pulseDamage");
        requireFinite(attack.dotDamagePerUnit, "tower", towerId, "attack.dotDamagePerUnit");
        break;
      case "sniper":
        requireFinite(attack.interval, "tower", towerId, "attack.interval", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        break;
      case "antiair":
        requireFinite(attack.fireRate, "tower", towerId, "attack.fireRate", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        if (!Array.isArray(attack.maxTargetsByLevel)) {
          err("tower", towerId, "attack.maxTargetsByLevel", `Tower "${towerId}" antiair must define maxTargetsByLevel.`);
        }
        if (!Array.isArray(attack.upgradeCosts)) {
          err("tower", towerId, "attack.upgradeCosts", `Tower "${towerId}" antiair must define upgradeCosts.`);
        }
        break;
      case "splash":
        requireFinite(attack.interval, "tower", towerId, "attack.interval", { positive: true });
        requireFinite(attack.damage, "tower", towerId, "attack.damage", { positive: true });
        requireFinite(attack.splashDamage, "tower", towerId, "attack.splashDamage");
        requireFinite(attack.armoredChipDamage, "tower", towerId, "attack.armoredChipDamage");
        requireFinite(attack.splashRadius, "tower", towerId, "attack.splashRadius");
        if (requireFinite(attack.slowFactor, "tower", towerId, "attack.slowFactor", { positive: true }) && attack.slowFactor >= 1) {
          err("tower", towerId, "attack.slowFactor", `Tower "${towerId}" slowFactor must be < 1 (got ${attack.slowFactor}).`, {
            expected: "0 < slowFactor < 1",
            got: String(attack.slowFactor),
            hint: "slowFactor multiplies speed (0.5 = half speed) — it must be strictly less than 1, or the enemy wouldn't actually slow down."
          });
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
    const damageType = (attack as { damageType?: unknown }).damageType;
    if (damageType !== undefined && (typeof damageType !== "string" || damageType.length === 0)) {
      err("tower", towerId, "attack.damageType", `Tower "${towerId}" damageType must be a non-empty string.`);
    }
    const onHit = (attack as { statusOnHit?: { stun?: unknown; slow?: { factor?: unknown; duration?: unknown }; poison?: { dps?: unknown; duration?: unknown } } }).statusOnHit;
    if (onHit) {
      validateStatusEffectSpec(onHit, "tower", towerId, "attack.statusOnHit");
    }
  }

  // Enemies
  for (const [enemyId, enemy] of Object.entries(content.enemies)) {
    if (enemy.id !== enemyId) err("enemy", enemyId, "id", `Enemy key "${enemyId}" has mismatched id "${enemy.id}".`);
    requireFinite(enemy.maxHp, "enemy", enemyId, "maxHp", { positive: true });
    requireFinite(enemy.speed, "enemy", enemyId, "speed", { positive: true });
    requireFinite(enemy.coreDamage, "enemy", enemyId, "coreDamage", { positive: true });
    requireFinite(enemy.coinReward, "enemy", enemyId, "coinReward");
    if (enemy.resistances !== undefined) {
      if (typeof enemy.resistances !== "object" || enemy.resistances === null) {
        err("enemy", enemyId, "resistances", `Enemy "${enemyId}" resistances must be an object.`);
      } else {
        for (const [type, mult] of Object.entries(enemy.resistances)) {
          requireFinite(mult, "enemy", enemyId, `resistances.${type}`);
        }
      }
    }
    if (enemy.towerDisrupt) {
      requireFinite(enemy.towerDisrupt.interval, "enemy", enemyId, "towerDisrupt.interval", { positive: true });
      requireFinite(enemy.towerDisrupt.radius, "enemy", enemyId, "towerDisrupt.radius", { positive: true });
      requireFinite(enemy.towerDisrupt.duration, "enemy", enemyId, "towerDisrupt.duration", { positive: true });
    }
    if (enemy.towerAttack) {
      requireFinite(enemy.towerAttack.interval, "enemy", enemyId, "towerAttack.interval", { positive: true });
      requireFinite(enemy.towerAttack.damage, "enemy", enemyId, "towerAttack.damage", { positive: true });
      requireFinite(enemy.towerAttack.range, "enemy", enemyId, "towerAttack.range", { positive: true });
    }
    validateBag(enemy.reward, "enemy", enemyId, "reward");
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
    if (enemy.armor && enemy.armor.kind !== "pierce_only") {
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
    validateBag(mission.startingResources, "mission", missionId, "startingResources");
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
    if (node.unlockRequiresMissionIds.includes(node.missionId)) {
      err("worldMap", node.missionId, "unlockRequiresMissionIds", `Mission "${node.missionId}" cannot require itself.`);
    }
    nodeCounts.set(node.missionId, (nodeCounts.get(node.missionId) ?? 0) + 1);
  }
  for (const missionId of missionIds) {
    const count = nodeCounts.get(missionId) ?? 0;
    if (count === 0) warn("worldMap", missionId, "missionNodes", `Mission "${missionId}" has no world map node.`);
    else if (count > 1) err("worldMap", missionId, "missionNodes", `Mission "${missionId}" has ${count} world map nodes (expected 1).`);
  }

  // Campaign reachability: with fresh progress a mission unlocks only when all its requirements are
  // (transitively) clearable. Flag any gated mission that can never be reached (a cycle, or a campaign
  // with no starting mission) — otherwise the player would be stuck on a permanently-locked default.
  const reqByMission = new Map<string, string[]>();
  for (const node of content.worldMap.missionNodes) {
    if (missionIds.has(node.missionId)) {
      reqByMission.set(node.missionId, node.unlockRequiresMissionIds.filter((r) => missionIds.has(r)));
    }
  }
  const reachable = new Set<string>();
  for (const missionId of missionIds) {
    if (!reqByMission.has(missionId)) reachable.add(missionId); // no node → always unlocked
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [missionId, reqs] of reqByMission) {
      if (!reachable.has(missionId) && reqs.every((r) => reachable.has(r))) {
        reachable.add(missionId);
        grew = true;
      }
    }
  }
  for (const missionId of reqByMission.keys()) {
    if (!reachable.has(missionId)) {
      err("worldMap", missionId, "unlockRequiresMissionIds", `Mission "${missionId}" can never be unlocked (an unlock requirement is itself locked — check for a cycle or a missing starting mission).`);
    }
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
