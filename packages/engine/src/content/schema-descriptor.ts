import { TOWER_TARGET_MODES, type TowerAttackKind } from "../simulation/types.js";

/**
 * A machine-readable description of the content schema's closed sets and per-shape field
 * constraints — the single source of truth for what `validateGameContentRegistry` (validate.ts)
 * actually enforces. Consumed by:
 *   - validate.ts, for the two closed-set enumerations (attack kinds, ability ids) instead of a
 *     second hardcoded copy of the same facts.
 *   - the MCP `describe_schema` tool (packages/mcp/tools.mjs), so an AI agent can learn the exact
 *     shape of a tower/ability BEFORE authoring one, instead of guessing and iterating against
 *     validate_project errors.
 *
 * Kept honest by schema-descriptor.test.ts, which builds a minimal-valid fixture per attack kind
 * and ability from exactly these `requiredFields` and asserts it passes validateGameContentRegistry
 * with zero errors — and that omitting any one required field produces one. If validate.ts's
 * per-kind checks ever drift from this file, that test fails.
 *
 * Scope: this file documents the RUNTIME-ENFORCED contract (what validate.ts actually checks),
 * not the full TypeScript field shape — non-enforced-but-typed fields (e.g. pulse's `dotDuration`,
 * sniper's `rangeByLevel`) are listed under `otherFields` for documentation only.
 */

export type FieldConstraint =
  | { name: string; kind: "number"; positive?: boolean; lessThanOne?: boolean }
  | { name: string; kind: "numberArray"; exactLength?: number }
  | { name: string; kind: "towerIdRefArray" }
  | { name: string; kind: "resourceBagArray" }
  | { name: string; kind: "pipelineDelivery" }
  | { name: string; kind: "towerEffectArray" }
  | { name: string; kind: "string" };

export interface AttackKindDescriptor {
  kind: TowerAttackKind;
  /** Fields validateGameContentRegistry actively enforces for this kind. */
  requiredFields: FieldConstraint[];
  /** Fields the TS shape carries that are NOT independently validated (documentation only). */
  otherFields: string[];
}

export const TARGET_MODE_SCHEMA = Object.freeze({
  selectable: TOWER_TARGET_MODES.filter((mode) => mode !== "fastest_ahead" && mode !== "largest_hp"),
  legacyAliases: { fastest_ahead: "first (armored first)", largest_hp: "strongest" },
  supportedAttackKinds: ["single", "sniper", "antiair", "splash", "pipeline"] as const,
  tieBreak: "enemy id ascending"
});

// Every damaging kind may additionally carry `damageType?: string` and `statusOnHit?: {...}`;
// every kind may carry `upgradeCosts?: ResourceCost[]` — all validated generically, not per-kind,
// so they are not repeated in each entry's requiredFields below.
export const ATTACK_KIND_SCHEMA: Record<TowerAttackKind, AttackKindDescriptor> = {
  single: {
    kind: "single",
    requiredFields: [
      { name: "fireRate", kind: "number", positive: true },
      { name: "damagePerStack", kind: "number", positive: true },
      { name: "maxStacks", kind: "number", positive: true }
    ],
    // `chain` is the first composable delivery modifier: optional { maxJumps, jumpRadius,
    // damageFalloff } (all positive numbers) — the shot jumps hop-by-hop to nearby ground
    // enemies, reusing the same resistance/armor/statusOnHit resolution as the primary hit.
    otherFields: ["startingStacks", "upgradeCost", "chain"]
  },
  pulse: {
    kind: "pulse",
    requiredFields: [
      { name: "pulseRate", kind: "number", positive: true },
      { name: "pulseDamage", kind: "number" },
      { name: "dotDamagePerUnit", kind: "number" }
    ],
    otherFields: ["dotDuration", "pulseRateByLevel"]
  },
  sniper: {
    kind: "sniper",
    requiredFields: [
      { name: "interval", kind: "number", positive: true },
      { name: "damage", kind: "number", positive: true }
    ],
    otherFields: ["targetPriority", "rangeByLevel"]
  },
  antiair: {
    kind: "antiair",
    requiredFields: [
      { name: "fireRate", kind: "number", positive: true },
      { name: "damage", kind: "number", positive: true },
      { name: "maxTargetsByLevel", kind: "numberArray" },
      { name: "upgradeCosts", kind: "resourceBagArray" }
    ],
    otherFields: []
  },
  splash: {
    kind: "splash",
    requiredFields: [
      { name: "interval", kind: "number", positive: true },
      { name: "damage", kind: "number", positive: true },
      { name: "splashDamage", kind: "number" },
      { name: "armoredChipDamage", kind: "number" },
      { name: "splashRadius", kind: "number" },
      { name: "slowFactor", kind: "number", positive: true, lessThanOne: true },
      { name: "slowDuration", kind: "number", positive: true }
    ],
    otherFields: ["intervalByLevel", "affectsClasses"]
  },
  support: {
    kind: "support",
    requiredFields: [
      { name: "auraRadius", kind: "number", positive: true },
      { name: "unlocksTowerIds", kind: "towerIdRefArray" }
    ],
    otherFields: ["auraRadiusByLevel"]
  },
  support_buff: {
    kind: "support_buff",
    requiredFields: [
      { name: "auraRadius", kind: "number", positive: true },
      { name: "fireRateMultiplierByLevel", kind: "numberArray", exactLength: 3 },
      { name: "affectsTowerIds", kind: "towerIdRefArray" }
    ],
    otherFields: []
  },
  pipeline: {
    kind: "pipeline",
    requiredFields: [
      { name: "interval", kind: "number", positive: true },
      { name: "delivery", kind: "pipelineDelivery" },
      { name: "effects", kind: "towerEffectArray" }
    ],
    otherFields: ["intervalByLevel", "rangeByLevel", "targeting", "upgradeCosts"]
  }
};

export const TOWER_PIPELINE_SCHEMA = Object.freeze({
  semantics: "targeting selects primary enemies; delivery expands them; effects run in declaration order",
  deliveryKinds: ["single", "multi", "area", "chain", "aura"] as const,
  targeting: { classes: ["ground", "flying"], mode: TOWER_TARGET_MODES, maxTargets: ">0 integer" },
  delivery: {
    single: {},
    multi: {},
    area: { radius: ">0", secondaryMultiplier: ">=0 optional" },
    chain: { maxJumps: ">0 integer", jumpRadius: ">0", damageFalloff: ">0 optional" },
    aura: {}
  },
  effects: {
    damage: { amount: ">=0", amountByLevel: "number[] optional", damageType: "string optional", armorPiercing: "boolean optional" },
    status: { status: "StatusEffectSpec" },
    resource: { resources: "ResourceBag" }
  }
});

export const ATTACK_KIND_IDS = Object.keys(ATTACK_KIND_SCHEMA) as TowerAttackKind[];

/**
 * The three engine-implemented ability presets — a closed union distinct from the now-open
 * `MissionAbilityId` (any string, so an author can declare a custom ability via `effects`; see
 * types.ts). Indexing ABILITY_SCHEMA/PRESET_ABILITY_IDS is exhaustively safe against this type.
 */
export type PresetAbilityId = "path_water" | "strike" | "freeze";

export interface AbilityDescriptor {
  id: PresetAbilityId;
  requiredFields: FieldConstraint[];
  otherFields: string[];
}

// Every ability additionally carries `cooldown` (validated non-negative) and `radius` (validated
// positive), common to all ids, so they are not repeated below. A custom (non-preset) ability
// instead declares `effects: AbilityEffect[]` — see ABILITY_EFFECT_SCHEMA below.
export const ABILITY_SCHEMA: Record<PresetAbilityId, AbilityDescriptor> = {
  path_water: {
    id: "path_water",
    requiredFields: [{ name: "duration", kind: "number", positive: true }],
    otherFields: []
  },
  strike: {
    id: "strike",
    requiredFields: [{ name: "damage", kind: "number", positive: true }],
    otherFields: []
  },
  freeze: {
    id: "freeze",
    requiredFields: [{ name: "duration", kind: "number", positive: true }],
    otherFields: ["stunDuration"]
  }
};

export const ABILITY_IDS = Object.keys(ABILITY_SCHEMA) as PresetAbilityId[];

/**
 * The effect vocabulary any ability (preset or custom) can compose via `effects: AbilityEffect[]`.
 * A custom ability declares one or more of these — no engine code needed. `status` reuses the
 * exact same StatusEffectSpec a tower's `attack.statusOnHit` carries (stun/slow/poison).
 */
export const ABILITY_EFFECT_SCHEMA = {
  damage: { requiredFields: [{ name: "amount", kind: "number", positive: true } satisfies FieldConstraint] },
  status: {
    note: "status: { stun?: number; slow?: { factor: number (<1); duration: number }; poison?: { dps: number; duration: number }; slowAffectsClasses?: ('ground'|'flying')[] } — slow defaults to ground; stun/poison retain all-class behavior."
  }
};

/** The rule enforced for every currency-typed resource bag (tower cost, enemy reward, etc.). */
export const CURRENCY_RULES = {
  idPattern: "^[A-Za-z0-9_]+$",
  primaryRequired: "coins" as const,
  note: "Any number of author-defined currencies beyond the required primary \"coins\"."
};

export const DIFFICULTY_SCHEMA = Object.freeze({
  semantics: "A selected difficulty modifies launch-time inputs; missions are not cloned and the engine owns no persistence.",
  requiredFields: ["id", "label"],
  multiplierFields: {
    enemyHpMultiplier: ">0 optional",
    enemySpeedMultiplier: ">0 optional",
    enemyRewardMultiplier: "finite optional",
    coreDamageMultiplier: "finite optional",
    startingResourceMultiplier: ">0 optional",
    coreHpMultiplier: ">0 optional"
  },
  defaultRule: "defaultDifficultyId must reference one difficulties[] entry",
  example: {
    defaultDifficultyId: "normal",
    difficulties: [
      { id: "normal", label: "Normal" },
      { id: "veteran", label: "Veteran", enemyHpMultiplier: 1.25, enemySpeedMultiplier: 1.1, startingResourceMultiplier: 0.85 }
    ]
  }
});

export const META_PROGRESSION_SCHEMA = Object.freeze({
  semantics: "The engine consumes selected upgrade levels; generated players own the versioned local profile and rewards.",
  rootFields: {
    currencies: "MetaCurrencyDefinition[]",
    upgrades: "Record<upgradeId, MetaUpgradeDefinition>",
    rewardsByMission: "Record<missionId, MissionMetaRewardDefinition>"
  },
  currency: { requiredFields: ["id", "label"], idPattern: "^[A-Za-z0-9_]+$", optionalFields: ["color"] },
  upgrade: {
    requiredFields: ["id", "label", "maxLevel", "costs", "effects"],
    rules: ["record key equals id", "maxLevel is a positive integer", "costs has exactly maxLevel entries", "effects is non-empty"]
  },
  effects: {
    towerDamage: { multiplierPerLevel: "finite" },
    towerFireRate: { multiplierPerLevel: "finite" },
    startingResource: { resourceId: "runtime currency id", amountPerLevel: "finite" },
    coreHp: { amountPerLevel: "finite" }
  },
  missionRewards: {
    firstClear: "meta currency bag optional",
    repeatClear: "meta currency bag optional",
    perStar: "meta currency bag optional"
  },
  example: {
    currencies: [{ id: "forge_shards", label: "Forge Shards" }],
    upgrades: {
      reinforced_core: {
        id: "reinforced_core",
        label: "Reinforced Core",
        maxLevel: 2,
        costs: [{ forge_shards: 1 }, { forge_shards: 3 }],
        effects: [{ kind: "coreHp", amountPerLevel: 2 }]
      }
    },
    rewardsByMission: { tutorial_01: { firstClear: { forge_shards: 2 }, perStar: { forge_shards: 1 } } }
  }
});

/** Mission-local economy fields shared by validation, Studio authoring, and agent schema discovery. */
export const MISSION_ECONOMY_SCHEMA = {
  perWaveStart: { kind: "resourceBag", note: "Granted whenever a wave starts." },
  perWaveClear: { kind: "resourceBag", note: "Granted once for each cleared wave." },
  passivePerTimeUnit: { kind: "resourceBag", note: "Continuous income after the first wave starts." },
  interestRate: { kind: "number", minimum: 0, note: "Fraction of current resources granted on wave clear." },
  interestCap: { kind: "resourceBag", note: "Optional per-currency cap on one interest grant." },
  earlyStartBonusPerUnit: { kind: "resourceBag", note: "Multiplied by skipped prep time when starting early." },
  sellRefundRatio: { kind: "number", minimum: 0, maximum: 1, default: 0.7, note: "Refund of placement + upgrade investment." }
} as const;

export const MISSION_OBJECTIVES_SCHEMA = {
  semantics: "All victory objectives must complete. Any failure condition ends the mission. Core depletion always loses. Missing/empty victory defaults to clearWaves.",
  victory: {
    clearWaves: { fields: ["id", "label?"] },
    surviveSeconds: { fields: ["id", "label?", "seconds>0"] },
    killCount: { fields: ["id", "label?", "count>0", "enemyTypeId?"] },
    accumulateResource: { fields: ["id", "label?", "resourceId", "amount>0"] }
  },
  failure: {
    maxLeaks: { fields: ["id", "label?", "maxLeaks>=0"] },
    timeLimit: { fields: ["id", "label?", "seconds>0"] }
  },
  stars: {
    coreHpAtLeast: { fields: ["id", "label", "amount>=0"] },
    maxLeaks: { fields: ["id", "label", "maxLeaks>=0"] },
    timeAtMost: { fields: ["id", "label", "seconds>0"] },
    resourceAtLeast: { fields: ["id", "label", "resourceId", "amount>0"] }
  }
} as const;
