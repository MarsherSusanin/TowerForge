import { ABILITY_IDS, ATTACK_KIND_IDS } from "./schema-descriptor.js";
import { TOWER_TARGET_MODES } from "../simulation/types.js";
import { coordKey } from "../simulation/hex.js";
import { createGridTopology, normalizeGridDefinition } from "../simulation/topology.js";
import { validateTowerScriptDefinitions } from "../scripting/validate.js";
/** Derives a stable code like "TOWER_ATTACK_SLOWFACTOR" from entityKind + fieldPath. See the
 *  ValidationIssue.code caveat above — this is a coarse key, not a unique one. */
export function deriveValidationCode(entityKind, fieldPath) {
    return `${entityKind}_${fieldPath}`
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
export function validateGameContentRegistry(content) {
    const issues = [];
    const missionIds = new Set(Object.keys(content.missions));
    const mapIds = new Set(Object.keys(content.maps));
    const enemyIds = new Set(Object.keys(content.enemies));
    const towerIds = new Set(Object.keys(content.towers));
    const abilityIds = new Set(Object.keys(content.abilities));
    const waveSetIds = new Set(Object.keys(content.waveSets));
    const regionIds = new Set(content.worldMap.regions.map((r) => r.id));
    const err = (entityKind, entityId, fieldPath, message, extra = {}) => {
        issues.push({ severity: "error", entityKind, entityId, fieldPath, message, code: extra.code ?? deriveValidationCode(entityKind, fieldPath), hint: extra.hint, expected: extra.expected, got: extra.got });
    };
    const warn = (entityKind, entityId, fieldPath, message, extra = {}) => {
        issues.push({ severity: "warning", entityKind, entityId, fieldPath, message, code: extra.code ?? deriveValidationCode(entityKind, fieldPath), hint: extra.hint, expected: extra.expected, got: extra.got });
    };
    const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);
    const requireFinite = (value, entityKind, entityId, fieldPath, opts = {}) => {
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
    const currencyIds = new Set();
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
    for (const issue of validateTowerScriptDefinitions(content.scripts, { missionIds, mapIds, waveSetIds, towerIds, enemyIds, abilityIds, currencyIds, terrainIds: new Set(Object.keys(content.terrainTypes)) })) {
        err("script", issue.scriptId, issue.fieldPath, issue.message);
    }
    /** Validate a resource bag: every key must be a declared currency, every amount a finite number >= 0. */
    const validateBag = (bag, entityKind, entityId, fieldPath) => {
        if (bag === undefined || bag === null)
            return;
        if (typeof bag !== "object") {
            err(entityKind, entityId, fieldPath, `${fieldPath} must be an object.`);
            return;
        }
        for (const [id, amount] of Object.entries(bag)) {
            if (!currencyIds.has(id)) {
                err(entityKind, entityId, `${fieldPath}.${id}`, `Unknown currency "${id}" — declare it in balance.currencies.`);
            }
            requireFinite(amount, entityKind, entityId, `${fieldPath}.${id}`);
        }
    };
    // Difficulty and persistent progression are launch-time/player-profile data. They are validated
    // here because they share the canonical balance contract, but the simulation never owns storage.
    const difficultyIds = new Set();
    const rawDifficulties = content.difficulties;
    const difficulties = Array.isArray(rawDifficulties) ? rawDifficulties : [];
    if (!Array.isArray(rawDifficulties)) {
        err("difficulty", "?", "difficulties", "difficulties must be an array.");
    }
    for (const difficulty of difficulties) {
        if (!difficulty?.id || typeof difficulty.id !== "string") {
            err("difficulty", "?", "id", "Difficulty needs a non-empty id.");
            continue;
        }
        if (difficultyIds.has(difficulty.id))
            err("difficulty", difficulty.id, "id", `Duplicate difficulty id "${difficulty.id}".`);
        difficultyIds.add(difficulty.id);
        if (typeof difficulty.label !== "string" || !difficulty.label.trim())
            err("difficulty", difficulty.id, "label", `Difficulty "${difficulty.id}" needs a label.`);
        for (const field of ["enemyHpMultiplier", "enemySpeedMultiplier", "startingResourceMultiplier", "coreHpMultiplier"]) {
            if (difficulty[field] !== undefined)
                requireFinite(difficulty[field], "difficulty", difficulty.id, field, { positive: true });
        }
        for (const field of ["enemyRewardMultiplier", "coreDamageMultiplier"]) {
            if (difficulty[field] !== undefined)
                requireFinite(difficulty[field], "difficulty", difficulty.id, field);
        }
    }
    if (!difficultyIds.has(content.defaultDifficultyId)) {
        err("difficulty", content.defaultDifficultyId, "defaultDifficultyId", `Default difficulty "${content.defaultDifficultyId}" is not defined.`);
    }
    const rawMetaProgression = content.metaProgression;
    const metaProgression = isRecord(rawMetaProgression) ? rawMetaProgression : undefined;
    if (!metaProgression) {
        err("metaProgression", "?", "root", "metaProgression must be an object.");
    }
    const rawMetaCurrencies = metaProgression?.currencies;
    const metaCurrencies = Array.isArray(rawMetaCurrencies) ? rawMetaCurrencies : [];
    if (rawMetaCurrencies !== undefined && !Array.isArray(rawMetaCurrencies)) {
        err("metaProgression", "?", "currencies", "metaProgression.currencies must be an array.");
    }
    const metaCurrencyIds = new Set();
    for (const currency of metaCurrencies) {
        if (!currency?.id || typeof currency.id !== "string" || !/^[A-Za-z0-9_]+$/.test(currency.id)) {
            err("metaCurrency", currency?.id ?? "?", "id", "Meta currency id must be alphanumeric/underscore.");
            continue;
        }
        if (metaCurrencyIds.has(currency.id))
            err("metaCurrency", currency.id, "id", `Duplicate meta currency id "${currency.id}".`);
        metaCurrencyIds.add(currency.id);
        if (typeof currency.label !== "string" || !currency.label.trim())
            err("metaCurrency", currency.id, "label", `Meta currency "${currency.id}" needs a label.`);
    }
    const validateMetaBag = (bag, entityKind, entityId, fieldPath) => {
        if (bag === undefined)
            return;
        if (!bag || typeof bag !== "object" || Array.isArray(bag)) {
            err(entityKind, entityId, fieldPath, `${fieldPath} must be an object.`);
            return;
        }
        for (const [currencyId, amount] of Object.entries(bag)) {
            if (!metaCurrencyIds.has(currencyId))
                err(entityKind, entityId, `${fieldPath}.${currencyId}`, `Unknown meta currency "${currencyId}".`);
            requireFinite(amount, entityKind, entityId, `${fieldPath}.${currencyId}`);
        }
    };
    const rawMetaUpgrades = metaProgression?.upgrades;
    const metaUpgrades = isRecord(rawMetaUpgrades) ? rawMetaUpgrades : {};
    if (rawMetaUpgrades !== undefined && !isRecord(rawMetaUpgrades)) {
        err("metaProgression", "?", "upgrades", "metaProgression.upgrades must be an object keyed by upgrade ID.");
    }
    for (const [upgradeId, upgrade] of Object.entries(metaUpgrades)) {
        if (!isRecord(upgrade)) {
            err("metaUpgrade", upgradeId, "root", `Meta upgrade "${upgradeId}" must be an object.`);
            continue;
        }
        if (upgrade.id !== upgradeId)
            err("metaUpgrade", upgradeId, "id", `Meta upgrade key "${upgradeId}" has mismatched id "${upgrade.id}".`);
        if (typeof upgrade.label !== "string" || !upgrade.label.trim())
            err("metaUpgrade", upgradeId, "label", `Meta upgrade "${upgradeId}" needs a label.`);
        const maxLevel = upgrade.maxLevel;
        if (typeof maxLevel !== "number" || !Number.isInteger(maxLevel) || maxLevel <= 0)
            err("metaUpgrade", upgradeId, "maxLevel", "maxLevel must be a positive integer.");
        if (!Array.isArray(upgrade.costs) || upgrade.costs.length !== maxLevel) {
            err("metaUpgrade", upgradeId, "costs", `Meta upgrade "${upgradeId}" must define one cost per level.`);
        }
        else
            upgrade.costs.forEach((cost, index) => validateMetaBag(cost, "metaUpgrade", upgradeId, `costs[${index}]`));
        if (!Array.isArray(upgrade.effects) || upgrade.effects.length === 0) {
            err("metaUpgrade", upgradeId, "effects", `Meta upgrade "${upgradeId}" needs at least one effect.`);
        }
        else
            upgrade.effects.forEach((effect, index) => {
                const base = `effects[${index}]`;
                if (!isRecord(effect)) {
                    err("metaUpgrade", upgradeId, base, `${base} must be an effect object.`);
                    return;
                }
                if (effect.kind === "towerDamage" || effect.kind === "towerFireRate") {
                    requireFinite(effect.multiplierPerLevel, "metaUpgrade", upgradeId, `${base}.multiplierPerLevel`);
                }
                else if (effect.kind === "startingResource") {
                    if (typeof effect.resourceId !== "string" || !currencyIds.has(effect.resourceId))
                        err("metaUpgrade", upgradeId, `${base}.resourceId`, `Unknown runtime currency "${String(effect.resourceId)}".`);
                    requireFinite(effect.amountPerLevel, "metaUpgrade", upgradeId, `${base}.amountPerLevel`);
                }
                else if (effect.kind === "coreHp") {
                    requireFinite(effect.amountPerLevel, "metaUpgrade", upgradeId, `${base}.amountPerLevel`);
                }
                else {
                    err("metaUpgrade", upgradeId, `${base}.kind`, `Unsupported meta upgrade effect "${String(effect.kind)}".`);
                }
            });
    }
    const rawMetaRewards = metaProgression?.rewardsByMission;
    const metaRewards = isRecord(rawMetaRewards) ? rawMetaRewards : {};
    if (rawMetaRewards !== undefined && !isRecord(rawMetaRewards)) {
        err("metaProgression", "?", "rewardsByMission", "metaProgression.rewardsByMission must be an object keyed by mission ID.");
    }
    for (const [missionId, reward] of Object.entries(metaRewards)) {
        if (!isRecord(reward)) {
            err("metaReward", missionId, "root", `Meta reward for "${missionId}" must be an object.`);
            continue;
        }
        if (!missionIds.has(missionId))
            err("metaReward", missionId, "missionId", `Meta reward references unknown mission "${missionId}".`);
        validateMetaBag(reward.firstClear, "metaReward", missionId, "firstClear");
        validateMetaBag(reward.repeatClear, "metaReward", missionId, "repeatClear");
        validateMetaBag(reward.perStar, "metaReward", missionId, "perStar");
    }
    const validateTargetClasses = (value, entityKind, entityId, fieldPath) => {
        if (value === undefined)
            return;
        if (!Array.isArray(value) || value.length === 0) {
            err(entityKind, entityId, fieldPath, `${fieldPath} must be a non-empty array containing "ground" and/or "flying".`, {
                expected: '("ground" | "flying")[]', got: JSON.stringify(value)
            });
            return;
        }
        const seen = new Set();
        for (const targetClass of value) {
            if (targetClass !== "ground" && targetClass !== "flying") {
                err(entityKind, entityId, fieldPath, `${fieldPath} contains unknown target class ${JSON.stringify(targetClass)}.`, {
                    expected: '"ground" or "flying"', got: JSON.stringify(targetClass)
                });
            }
            else if (seen.has(targetClass)) {
                err(entityKind, entityId, fieldPath, `${fieldPath} contains duplicate target class "${targetClass}".`);
            }
            seen.add(String(targetClass));
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
    const validateStatusEffectSpec = (spec, entityKind, entityId, fieldPath) => {
        validateTargetClasses(spec.slowAffectsClasses, entityKind, entityId, `${fieldPath}.slowAffectsClasses`);
        if (spec.stun !== undefined)
            requireFinite(spec.stun, entityKind, entityId, `${fieldPath}.stun`, { positive: true });
        if (spec.slow) {
            if (requireFinite(spec.slow.factor, entityKind, entityId, `${fieldPath}.slow.factor`, { positive: true }) && spec.slow.factor >= 1) {
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
    const PRESET_ABILITY_IDS = new Set(ABILITY_IDS);
    for (const [abilityId, ability] of Object.entries(content.abilities)) {
        if (!ability)
            continue;
        const isPreset = PRESET_ABILITY_IDS.has(abilityId);
        const hasEffects = Array.isArray(ability.effects) && ability.effects.length > 0;
        if (!isPreset && !hasEffects) {
            err("ability", abilityId, "id", `Unknown ability "${abilityId}" — declare "effects" for a custom ability, or use a preset id (${ABILITY_IDS.join(", ")}).`, {
                expected: `a preset id (${ABILITY_IDS.join(", ")}) or an "effects" array`,
                got: abilityId,
                hint: 'Any ability id is valid once it declares effects: [{kind:"damage", amount} | {kind:"status", status:{stun|slow|poison}}] — call describe_schema for the exact shape.'
            });
            continue;
        }
        requireFinite(ability.cooldown, "ability", abilityId, "cooldown");
        requireFinite(ability.radius, "ability", abilityId, "radius", { positive: true });
        if (hasEffects) {
            ability.effects.forEach((effect, i) => {
                if (!effect || typeof effect !== "object") {
                    err("ability", abilityId, `effects[${i}]`, `${abilityId} effects[${i}] must be an object.`);
                    return;
                }
                if (effect.kind === "damage") {
                    requireFinite(effect.amount, "ability", abilityId, `effects[${i}].amount`, { positive: true });
                }
                else if (effect.kind === "status") {
                    validateStatusEffectSpec(effect.status ?? {}, "ability", abilityId, `effects[${i}].status`);
                }
                else {
                    err("ability", abilityId, `effects[${i}].kind`, `${abilityId} effects[${i}].kind must be "damage" or "status".`);
                }
            });
        }
        else {
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
    // Terrain registry
    for (const [terrainId, terrain] of Object.entries(content.terrainTypes)) {
        if (terrain.id !== terrainId)
            err("terrain", terrainId, "id", `Terrain key "${terrainId}" has mismatched id "${terrain.id}".`);
        if (!terrain.label.trim())
            err("terrain", terrainId, "label", `Terrain "${terrainId}" needs a non-empty label.`);
        if (typeof terrain.buildable !== "boolean")
            err("terrain", terrainId, "buildable", "buildable must be boolean.");
        if (typeof terrain.walkable !== "boolean")
            err("terrain", terrainId, "walkable", "walkable must be boolean.");
        requireFinite(terrain.groundSpeedMultiplier, "terrain", terrainId, "groundSpeedMultiplier");
        if (!Array.isArray(terrain.tags) || terrain.tags.some((tag) => typeof tag !== "string")) {
            err("terrain", terrainId, "tags", "tags must be an array of strings.");
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
        const grid = normalizeGridDefinition(map.grid);
        const topology = createGridTopology(grid);
        if (map.grid && map.grid.kind === "hex" && map.grid.layout !== "odd-r") {
            err("map", mapId, "grid.layout", `Map "${mapId}" uses unsupported hex layout "${String(map.grid.layout)}".`);
        }
        if (map.grid && map.grid.kind === "square" && map.grid.adjacency !== "cardinal") {
            err("map", mapId, "grid.adjacency", `Map "${mapId}" uses unsupported square adjacency "${String(map.grid.adjacency)}".`);
        }
        const routes = map.pathRoutes?.length ? map.pathRoutes : [{ id: "main", pathCenterline: map.pathCenterline }];
        const overrideTerrain = new Map(map.terrainOverrides.map((entry) => [coordKey(entry), entry.terrain]));
        const terrainAt = (coord) => {
            if (coordKey(coord) === coordKey(map.spawnCoord))
                return content.terrainTypes.spawn;
            if (coordKey(coord) === coordKey(map.coreCoord))
                return content.terrainTypes.core;
            return content.terrainTypes[overrideTerrain.get(coordKey(coord)) ?? map.defaultTerrain];
        };
        if (!content.terrainTypes[map.defaultTerrain])
            err("map", mapId, "defaultTerrain", `Unknown terrain "${map.defaultTerrain}".`);
        for (const [index, override] of map.terrainOverrides.entries()) {
            if (!content.terrainTypes[override.terrain])
                err("map", mapId, `terrainOverrides[${index}].terrain`, `Unknown terrain "${override.terrain}".`);
        }
        for (const route of routes) {
            if (!route.id)
                err("map", mapId, "pathRoutes", `Map "${mapId}" has a path route without an id.`);
            if (route.pathCenterline.length < 2) {
                err("map", mapId, `pathRoutes.${route.id}`, `Map "${mapId}" route "${route.id}" needs at least 2 centerline points.`);
            }
            route.pathCenterline.forEach((coord, index) => {
                if (terrainAt(coord)?.walkable === false) {
                    err("map", mapId, `pathRoutes.${route.id}[${index}]`, `Route "${route.id}" crosses non-walkable terrain at ${coord.q},${coord.r}.`);
                }
                const next = route.pathCenterline[index + 1];
                if (next && !topology.directionBetween(coord, next)) {
                    err("map", mapId, `pathRoutes.${route.id}[${index + 1}]`, `Route "${route.id}" contains a non-adjacent ${grid.kind} segment ${coord.q},${coord.r} -> ${next.q},${next.r}.`);
                }
            });
        }
        const allCoords = [map.spawnCoord, map.coreCoord, ...map.pathCenterline, ...(map.pathRoutes ?? []).flatMap((r) => r.pathCenterline), ...map.terrainOverrides];
        for (const coord of allCoords) {
            if (!coord || !Number.isFinite(coord.q) || !Number.isFinite(coord.r)) {
                err("map", mapId, "coords", `Map "${mapId}" has a malformed coord ${JSON.stringify(coord)}.`);
            }
            else if (coord.q < 0 || coord.r < 0 || coord.q >= map.width || coord.r >= map.height) {
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
    const knownAttackKinds = new Set(ATTACK_KIND_IDS);
    for (const [towerId, tower] of Object.entries(content.towers)) {
        if (tower.id !== towerId)
            err("tower", towerId, "id", `Tower key "${towerId}" has mismatched id "${tower.id}".`);
        requireFinite(tower.footprintRadius, "tower", towerId, "footprintRadius");
        requireFinite(tower.range, "tower", towerId, "range", { positive: true });
        if (tower.maxHp !== undefined)
            requireFinite(tower.maxHp, "tower", towerId, "maxHp", { positive: true });
        validateBag(tower.cost, "tower", towerId, "cost");
        if (tower.requiresAuraFrom && !towerIds.has(tower.requiresAuraFrom)) {
            err("tower", towerId, "requiresAuraFrom", `Tower "${towerId}" requires unknown aura tower "${tower.requiresAuraFrom}".`);
        }
        // Guard against untyped/agent-authored JSON that omits "attack" entirely (TowerType's TS
        // shape declares it required, but a validator's whole job is checking data that may not match
        // that contract) — report ONE clear issue and move on, rather than letting every attack-shaped
        // access below (upgradeCosts, the kind switch, damageType, statusOnHit) throw on undefined.
        const rawAttack = tower.attack;
        if (!rawAttack || typeof rawAttack !== "object" || Array.isArray(rawAttack)) {
            err("tower", towerId, "attack", `Tower "${towerId}" is missing an "attack" object.`, {
                expected: "an attack object with a kind",
                got: JSON.stringify(rawAttack),
                hint: 'Every tower needs attack: { kind, ... }. Call describe_schema for the exact required fields per kind.'
            });
            continue;
        }
        if (!knownAttackKinds.has(tower.attack.kind ?? "")) {
            err("tower", towerId, "attack.kind", `Tower "${towerId}" has unknown attack.kind "${tower.attack.kind}".`, {
                expected: [...knownAttackKinds].join("|"),
                got: String(tower.attack.kind),
                hint: `attack.kind must be one of the engine-implemented kinds: ${[...knownAttackKinds].join(", ")}. Call describe_schema to see each kind's required fields.`
            });
        }
        const attack = tower.attack;
        if (Array.isArray(attack.upgradeCosts)) {
            attack.upgradeCosts.forEach((uc, i) => validateBag(uc, "tower", towerId, `attack.upgradeCosts[${i}]`));
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
                if (attack.targetPriority !== undefined && !TOWER_TARGET_MODES.includes(attack.targetPriority)) {
                    err("tower", towerId, "attack.targetPriority", `Tower "${towerId}" has unknown targetPriority "${attack.targetPriority}".`, {
                        expected: TOWER_TARGET_MODES.join("|"),
                        got: String(attack.targetPriority)
                    });
                }
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
                    if (!towerIds.has(unlockId))
                        err("tower", towerId, "attack.unlocksTowerIds", `Tower "${towerId}" unlocks unknown tower "${unlockId}".`);
                }
                break;
            case "support_buff":
                requireFinite(attack.auraRadius, "tower", towerId, "attack.auraRadius", { positive: true });
                if (!Array.isArray(attack.fireRateMultiplierByLevel) || attack.fireRateMultiplierByLevel.length !== 3) {
                    err("tower", towerId, "attack.fireRateMultiplierByLevel", `Tower "${towerId}" support_buff must have 3 fireRateMultiplierByLevel values.`);
                }
                for (const affectedId of attack.affectsTowerIds) {
                    if (!towerIds.has(affectedId))
                        err("tower", towerId, "attack.affectsTowerIds", `Tower "${towerId}" affects unknown tower "${affectedId}".`);
                }
                break;
            case "pipeline": {
                requireFinite(attack.interval, "tower", towerId, "attack.interval", { positive: true });
                if (attack.intervalByLevel !== undefined) {
                    if (!Array.isArray(attack.intervalByLevel) || attack.intervalByLevel.length === 0)
                        err("tower", towerId, "attack.intervalByLevel", "attack.intervalByLevel must be a non-empty number array.");
                    else
                        attack.intervalByLevel.forEach((value, index) => requireFinite(value, "tower", towerId, `attack.intervalByLevel[${index}]`, { positive: true }));
                }
                if (attack.rangeByLevel !== undefined) {
                    if (!Array.isArray(attack.rangeByLevel) || attack.rangeByLevel.length === 0)
                        err("tower", towerId, "attack.rangeByLevel", "attack.rangeByLevel must be a non-empty number array.");
                    else
                        attack.rangeByLevel.forEach((value, index) => requireFinite(value, "tower", towerId, `attack.rangeByLevel[${index}]`, { positive: true }));
                }
                validateTargetClasses(attack.targeting?.classes, "tower", towerId, "attack.targeting.classes");
                if (attack.targeting?.mode !== undefined && !TOWER_TARGET_MODES.includes(attack.targeting.mode)) {
                    err("tower", towerId, "attack.targeting.mode", `Unknown target mode "${attack.targeting.mode}".`);
                }
                if (attack.targeting?.maxTargets !== undefined && (!Number.isInteger(attack.targeting.maxTargets) || attack.targeting.maxTargets <= 0)) {
                    err("tower", towerId, "attack.targeting.maxTargets", "attack.targeting.maxTargets must be a positive integer.");
                }
                if (!attack.delivery || typeof attack.delivery !== "object") {
                    err("tower", towerId, "attack.delivery", "Pipeline attack needs a delivery object.");
                }
                else if (attack.delivery.kind === "area") {
                    requireFinite(attack.delivery.radius, "tower", towerId, "attack.delivery.radius", { positive: true });
                    if (attack.delivery.secondaryMultiplier !== undefined)
                        requireFinite(attack.delivery.secondaryMultiplier, "tower", towerId, "attack.delivery.secondaryMultiplier");
                }
                else if (attack.delivery.kind === "chain") {
                    if (!Number.isInteger(attack.delivery.maxJumps) || attack.delivery.maxJumps <= 0)
                        err("tower", towerId, "attack.delivery.maxJumps", "maxJumps must be a positive integer.");
                    requireFinite(attack.delivery.jumpRadius, "tower", towerId, "attack.delivery.jumpRadius", { positive: true });
                    if (attack.delivery.damageFalloff !== undefined)
                        requireFinite(attack.delivery.damageFalloff, "tower", towerId, "attack.delivery.damageFalloff", { positive: true });
                }
                else if (!["single", "multi", "aura"].includes(attack.delivery.kind)) {
                    err("tower", towerId, "attack.delivery.kind", `Unsupported pipeline delivery "${String(attack.delivery.kind)}".`);
                }
                if (!Array.isArray(attack.effects) || attack.effects.length === 0) {
                    err("tower", towerId, "attack.effects", "Pipeline attack needs at least one effect.");
                }
                else
                    attack.effects.forEach((effect, index) => {
                        const base = `attack.effects[${index}]`;
                        if (!effect || typeof effect !== "object") {
                            err("tower", towerId, base, "Each pipeline effect must be an object.");
                            return;
                        }
                        if (effect.kind === "damage") {
                            requireFinite(effect.amount, "tower", towerId, `${base}.amount`);
                            if (effect.damageType !== undefined && (!effect.damageType || typeof effect.damageType !== "string"))
                                err("tower", towerId, `${base}.damageType`, "damageType must be a non-empty string.");
                            if (effect.armorPiercing !== undefined && typeof effect.armorPiercing !== "boolean")
                                err("tower", towerId, `${base}.armorPiercing`, "armorPiercing must be a boolean.");
                            if (effect.amountByLevel !== undefined) {
                                if (!Array.isArray(effect.amountByLevel) || effect.amountByLevel.length === 0)
                                    err("tower", towerId, `${base}.amountByLevel`, "amountByLevel must be a non-empty number array.");
                                else
                                    effect.amountByLevel.forEach((value, level) => requireFinite(value, "tower", towerId, `${base}.amountByLevel[${level}]`));
                            }
                        }
                        else if (effect.kind === "status") {
                            validateStatusEffectSpec(effect.status ?? {}, "tower", towerId, `${base}.status`);
                        }
                        else if (effect.kind === "resource") {
                            validateBag(effect.resources, "tower", towerId, `${base}.resources`);
                        }
                        else {
                            err("tower", towerId, `${base}.kind`, `Unsupported tower effect "${String(effect.kind)}".`);
                        }
                    });
                break;
            }
        }
        const damageType = attack.damageType;
        if (damageType !== undefined && (typeof damageType !== "string" || damageType.length === 0)) {
            err("tower", towerId, "attack.damageType", `Tower "${towerId}" damageType must be a non-empty string.`);
        }
        const onHit = attack.statusOnHit;
        if (onHit) {
            validateStatusEffectSpec(onHit, "tower", towerId, "attack.statusOnHit");
        }
        validateTargetClasses(attack.affectsClasses, "tower", towerId, "attack.affectsClasses");
    }
    // Enemies
    for (const [enemyId, enemy] of Object.entries(content.enemies)) {
        if (enemy.id !== enemyId)
            err("enemy", enemyId, "id", `Enemy key "${enemyId}" has mismatched id "${enemy.id}".`);
        requireFinite(enemy.maxHp, "enemy", enemyId, "maxHp", { positive: true });
        requireFinite(enemy.speed, "enemy", enemyId, "speed", { positive: true });
        requireFinite(enemy.coreDamage, "enemy", enemyId, "coreDamage", { positive: true });
        requireFinite(enemy.coinReward, "enemy", enemyId, "coinReward");
        if (enemy.resistances !== undefined) {
            if (typeof enemy.resistances !== "object" || enemy.resistances === null) {
                err("enemy", enemyId, "resistances", `Enemy "${enemyId}" resistances must be an object.`);
            }
            else {
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
                        err("wave", wave.id, "groups.routeId", `Wave "${wave.id}" routeId "${group.routeId}" is not present on mission "${missionId}" map "${mission.mapId}".`);
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
        if (mission.economy) {
            validateBag(mission.economy.perWaveStart, "mission", missionId, "economy.perWaveStart");
            validateBag(mission.economy.perWaveClear, "mission", missionId, "economy.perWaveClear");
            validateBag(mission.economy.passivePerTimeUnit, "mission", missionId, "economy.passivePerTimeUnit");
            validateBag(mission.economy.interestCap, "mission", missionId, "economy.interestCap");
            validateBag(mission.economy.earlyStartBonusPerUnit, "mission", missionId, "economy.earlyStartBonusPerUnit");
            if (mission.economy.interestRate !== undefined) {
                requireFinite(mission.economy.interestRate, "mission", missionId, "economy.interestRate");
                if (mission.economy.interestRate > 1) {
                    warn("mission", missionId, "economy.interestRate", `Mission "${missionId}" grants more than 100% interest per wave.`);
                }
            }
            if (mission.economy.sellRefundRatio !== undefined) {
                const valid = requireFinite(mission.economy.sellRefundRatio, "mission", missionId, "economy.sellRefundRatio");
                if (valid && mission.economy.sellRefundRatio > 1) {
                    err("mission", missionId, "economy.sellRefundRatio", `economy.sellRefundRatio must be between 0 and 1 (got ${mission.economy.sellRefundRatio}).`, { expected: "0..1", got: String(mission.economy.sellRefundRatio) });
                }
            }
        }
        if (mission.objectives) {
            const objectiveIds = new Set();
            const registerId = (id, fieldPath) => {
                if (typeof id !== "string" || !id.trim()) {
                    err("mission", missionId, fieldPath, `${fieldPath} must be a non-empty string.`);
                    return;
                }
                if (objectiveIds.has(id))
                    err("mission", missionId, fieldPath, `Objective id "${id}" is duplicated.`);
                objectiveIds.add(id);
            };
            if (!Array.isArray(mission.objectives.victory)) {
                err("mission", missionId, "objectives.victory", "objectives.victory must be an array.");
            }
            else {
                if (mission.objectives.victory.length === 0) {
                    warn("mission", missionId, "objectives.victory", "No authored victory objectives; the runtime will default to clearWaves.");
                }
                mission.objectives.victory.forEach((objective, index) => {
                    const base = `objectives.victory[${index}]`;
                    registerId(objective?.id, `${base}.id`);
                    if (!objective || !["clearWaves", "surviveSeconds", "killCount", "accumulateResource"].includes(objective.kind)) {
                        err("mission", missionId, `${base}.kind`, `Unsupported victory objective kind "${String(objective?.kind)}".`);
                        return;
                    }
                    if (objective.kind === "surviveSeconds")
                        requireFinite(objective.seconds, "mission", missionId, `${base}.seconds`, { positive: true });
                    if (objective.kind === "killCount") {
                        requireFinite(objective.count, "mission", missionId, `${base}.count`, { positive: true });
                        if (objective.enemyTypeId && !enemyIds.has(objective.enemyTypeId))
                            err("mission", missionId, `${base}.enemyTypeId`, `Unknown enemy "${objective.enemyTypeId}".`);
                    }
                    if (objective.kind === "accumulateResource") {
                        if (!currencyIds.has(objective.resourceId))
                            err("mission", missionId, `${base}.resourceId`, `Unknown currency "${objective.resourceId}".`);
                        requireFinite(objective.amount, "mission", missionId, `${base}.amount`, { positive: true });
                    }
                });
            }
            if (mission.objectives.failure !== undefined && !Array.isArray(mission.objectives.failure)) {
                err("mission", missionId, "objectives.failure", "objectives.failure must be an array.");
            }
            else {
                (mission.objectives.failure ?? []).forEach((condition, index) => {
                    const base = `objectives.failure[${index}]`;
                    registerId(condition?.id, `${base}.id`);
                    if (!condition || !["maxLeaks", "timeLimit"].includes(condition.kind)) {
                        err("mission", missionId, `${base}.kind`, `Unsupported failure condition kind "${String(condition?.kind)}".`);
                        return;
                    }
                    if (condition.kind === "maxLeaks")
                        requireFinite(condition.maxLeaks, "mission", missionId, `${base}.maxLeaks`);
                    if (condition.kind === "timeLimit")
                        requireFinite(condition.seconds, "mission", missionId, `${base}.seconds`, { positive: true });
                });
            }
            if (mission.objectives.stars !== undefined && !Array.isArray(mission.objectives.stars)) {
                err("mission", missionId, "objectives.stars", "objectives.stars must be an array.");
            }
            else {
                (mission.objectives.stars ?? []).forEach((star, index) => {
                    const base = `objectives.stars[${index}]`;
                    registerId(star?.id, `${base}.id`);
                    if (!star || !["coreHpAtLeast", "maxLeaks", "timeAtMost", "resourceAtLeast"].includes(star.kind)) {
                        err("mission", missionId, `${base}.kind`, `Unsupported star condition kind "${String(star?.kind)}".`);
                        return;
                    }
                    if (typeof star.label !== "string" || !star.label.trim())
                        err("mission", missionId, `${base}.label`, "Star label must be non-empty.");
                    if (star.kind === "coreHpAtLeast")
                        requireFinite(star.amount, "mission", missionId, `${base}.amount`);
                    if (star.kind === "maxLeaks")
                        requireFinite(star.maxLeaks, "mission", missionId, `${base}.maxLeaks`);
                    if (star.kind === "timeAtMost")
                        requireFinite(star.seconds, "mission", missionId, `${base}.seconds`, { positive: true });
                    if (star.kind === "resourceAtLeast") {
                        if (!currencyIds.has(star.resourceId))
                            err("mission", missionId, `${base}.resourceId`, `Unknown currency "${star.resourceId}".`);
                        requireFinite(star.amount, "mission", missionId, `${base}.amount`, { positive: true });
                    }
                });
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
    const nodeCounts = new Map();
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
        if (count === 0)
            warn("worldMap", missionId, "missionNodes", `Mission "${missionId}" has no world map node.`);
        else if (count > 1)
            err("worldMap", missionId, "missionNodes", `Mission "${missionId}" has ${count} world map nodes (expected 1).`);
    }
    // Campaign reachability: with fresh progress a mission unlocks only when all its requirements are
    // (transitively) clearable. Flag any gated mission that can never be reached (a cycle, or a campaign
    // with no starting mission) — otherwise the player would be stuck on a permanently-locked default.
    const reqByMission = new Map();
    for (const node of content.worldMap.missionNodes) {
        if (missionIds.has(node.missionId)) {
            reqByMission.set(node.missionId, node.unlockRequiresMissionIds.filter((r) => missionIds.has(r)));
        }
    }
    const reachable = new Set();
    for (const missionId of missionIds) {
        if (!reqByMission.has(missionId))
            reachable.add(missionId); // no node → always unlocked
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
export function validateProject(content) {
    return validateGameContentRegistry(content);
}
