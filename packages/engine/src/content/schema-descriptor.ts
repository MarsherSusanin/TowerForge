import type { TowerAttackKind } from "../simulation/types.js";

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
  | { name: string; kind: "string" };

export interface AttackKindDescriptor {
  kind: TowerAttackKind;
  /** Fields validateGameContentRegistry actively enforces for this kind. */
  requiredFields: FieldConstraint[];
  /** Fields the TS shape carries that are NOT independently validated (documentation only). */
  otherFields: string[];
}

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
    otherFields: ["intervalByLevel"]
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
  }
};

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
    note: "status: { stun?: number; slow?: { factor: number (<1); duration: number }; poison?: { dps: number; duration: number } } — at least one of stun/slow/poison."
  }
};

/** The rule enforced for every currency-typed resource bag (tower cost, enemy reward, etc.). */
export const CURRENCY_RULES = {
  idPattern: "^[A-Za-z0-9_]+$",
  primaryRequired: "coins" as const,
  note: "Any number of author-defined currencies beyond the required primary \"coins\"."
};
