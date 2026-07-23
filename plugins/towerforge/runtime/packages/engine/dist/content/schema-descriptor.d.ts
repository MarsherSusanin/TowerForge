import { type TowerAttackKind } from "../simulation/types.js";
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
export type FieldConstraint = {
    name: string;
    kind: "number";
    positive?: boolean;
    lessThanOne?: boolean;
} | {
    name: string;
    kind: "numberArray";
    exactLength?: number;
} | {
    name: string;
    kind: "towerIdRefArray";
} | {
    name: string;
    kind: "resourceBagArray";
} | {
    name: string;
    kind: "pipelineDelivery";
} | {
    name: string;
    kind: "towerEffectArray";
} | {
    name: string;
    kind: "string";
};
export interface AttackKindDescriptor {
    kind: TowerAttackKind;
    /** Fields validateGameContentRegistry actively enforces for this kind. */
    requiredFields: FieldConstraint[];
    /** Fields the TS shape carries that are NOT independently validated (documentation only). */
    otherFields: string[];
}
export declare const TARGET_MODE_SCHEMA: Readonly<{
    selectable: ("first" | "last" | "closest" | "furthest" | "strongest" | "weakest")[];
    legacyAliases: {
        fastest_ahead: string;
        largest_hp: string;
    };
    supportedAttackKinds: readonly ["single", "sniper", "antiair", "splash", "pipeline"];
    tieBreak: "enemy id ascending";
}>;
export declare const ATTACK_KIND_SCHEMA: Record<TowerAttackKind, AttackKindDescriptor>;
export declare const TOWER_PIPELINE_SCHEMA: Readonly<{
    semantics: "targeting selects primary enemies; delivery expands them; effects run in declaration order";
    deliveryKinds: readonly ["single", "multi", "area", "chain", "aura"];
    targeting: {
        classes: string[];
        mode: readonly ["first", "last", "closest", "furthest", "strongest", "weakest", "fastest_ahead", "largest_hp"];
        maxTargets: string;
    };
    delivery: {
        single: {};
        multi: {};
        area: {
            radius: string;
            secondaryMultiplier: string;
        };
        chain: {
            maxJumps: string;
            jumpRadius: string;
            damageFalloff: string;
        };
        aura: {};
    };
    effects: {
        damage: {
            amount: string;
            amountByLevel: string;
            damageType: string;
            armorPiercing: string;
        };
        status: {
            status: string;
        };
        resource: {
            resources: string;
        };
    };
}>;
export declare const ATTACK_KIND_IDS: TowerAttackKind[];
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
export declare const ABILITY_SCHEMA: Record<PresetAbilityId, AbilityDescriptor>;
export declare const ABILITY_IDS: PresetAbilityId[];
/**
 * The effect vocabulary any ability (preset or custom) can compose via `effects: AbilityEffect[]`.
 * A custom ability declares one or more of these — no engine code needed. `status` reuses the
 * exact same StatusEffectSpec a tower's `attack.statusOnHit` carries (stun/slow/poison).
 */
export declare const ABILITY_EFFECT_SCHEMA: {
    damage: {
        requiredFields: {
            name: string;
            kind: "number";
            positive: true;
        }[];
    };
    status: {
        note: string;
    };
};
/** The rule enforced for every currency-typed resource bag (tower cost, enemy reward, etc.). */
export declare const CURRENCY_RULES: {
    idPattern: string;
    primaryRequired: "coins";
    note: string;
};
export declare const DIFFICULTY_SCHEMA: Readonly<{
    semantics: "A selected difficulty modifies launch-time inputs; missions are not cloned and the engine owns no persistence.";
    requiredFields: string[];
    multiplierFields: {
        enemyHpMultiplier: string;
        enemySpeedMultiplier: string;
        enemyRewardMultiplier: string;
        coreDamageMultiplier: string;
        startingResourceMultiplier: string;
        coreHpMultiplier: string;
    };
    defaultRule: "defaultDifficultyId must reference one difficulties[] entry";
    example: {
        defaultDifficultyId: string;
        difficulties: ({
            id: string;
            label: string;
            enemyHpMultiplier?: undefined;
            enemySpeedMultiplier?: undefined;
            startingResourceMultiplier?: undefined;
        } | {
            id: string;
            label: string;
            enemyHpMultiplier: number;
            enemySpeedMultiplier: number;
            startingResourceMultiplier: number;
        })[];
    };
}>;
export declare const META_PROGRESSION_SCHEMA: Readonly<{
    semantics: "The engine consumes selected upgrade levels; generated players own the versioned local profile and rewards.";
    rootFields: {
        currencies: string;
        upgrades: string;
        rewardsByMission: string;
    };
    currency: {
        requiredFields: string[];
        idPattern: string;
        optionalFields: string[];
    };
    upgrade: {
        requiredFields: string[];
        rules: string[];
    };
    effects: {
        towerDamage: {
            multiplierPerLevel: string;
        };
        towerFireRate: {
            multiplierPerLevel: string;
        };
        startingResource: {
            resourceId: string;
            amountPerLevel: string;
        };
        coreHp: {
            amountPerLevel: string;
        };
    };
    missionRewards: {
        firstClear: string;
        repeatClear: string;
        perStar: string;
    };
    example: {
        currencies: {
            id: string;
            label: string;
        }[];
        upgrades: {
            reinforced_core: {
                id: string;
                label: string;
                maxLevel: number;
                costs: {
                    forge_shards: number;
                }[];
                effects: {
                    kind: string;
                    amountPerLevel: number;
                }[];
            };
        };
        rewardsByMission: {
            tutorial_01: {
                firstClear: {
                    forge_shards: number;
                };
                perStar: {
                    forge_shards: number;
                };
            };
        };
    };
}>;
/** Mission-local economy fields shared by validation, Studio authoring, and agent schema discovery. */
export declare const MISSION_ECONOMY_SCHEMA: {
    readonly perWaveStart: {
        readonly kind: "resourceBag";
        readonly note: "Granted whenever a wave starts.";
    };
    readonly perWaveClear: {
        readonly kind: "resourceBag";
        readonly note: "Granted once for each cleared wave.";
    };
    readonly passivePerTimeUnit: {
        readonly kind: "resourceBag";
        readonly note: "Continuous income after the first wave starts.";
    };
    readonly interestRate: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly note: "Fraction of current resources granted on wave clear.";
    };
    readonly interestCap: {
        readonly kind: "resourceBag";
        readonly note: "Optional per-currency cap on one interest grant.";
    };
    readonly earlyStartBonusPerUnit: {
        readonly kind: "resourceBag";
        readonly note: "Multiplied by skipped prep time when starting early.";
    };
    readonly sellRefundRatio: {
        readonly kind: "number";
        readonly minimum: 0;
        readonly maximum: 1;
        readonly default: 0.7;
        readonly note: "Refund of placement + upgrade investment.";
    };
};
export declare const MISSION_OBJECTIVES_SCHEMA: {
    readonly semantics: "All victory objectives must complete. Any failure condition ends the mission. Core depletion always loses. Missing/empty victory defaults to clearWaves.";
    readonly victory: {
        readonly clearWaves: {
            readonly fields: readonly ["id", "label?"];
        };
        readonly surviveSeconds: {
            readonly fields: readonly ["id", "label?", "seconds>0"];
        };
        readonly killCount: {
            readonly fields: readonly ["id", "label?", "count>0", "enemyTypeId?"];
        };
        readonly accumulateResource: {
            readonly fields: readonly ["id", "label?", "resourceId", "amount>0"];
        };
    };
    readonly failure: {
        readonly maxLeaks: {
            readonly fields: readonly ["id", "label?", "maxLeaks>=0"];
        };
        readonly timeLimit: {
            readonly fields: readonly ["id", "label?", "seconds>0"];
        };
    };
    readonly stars: {
        readonly coreHpAtLeast: {
            readonly fields: readonly ["id", "label", "amount>=0"];
        };
        readonly maxLeaks: {
            readonly fields: readonly ["id", "label", "maxLeaks>=0"];
        };
        readonly timeAtMost: {
            readonly fields: readonly ["id", "label", "seconds>0"];
        };
        readonly resourceAtLeast: {
            readonly fields: readonly ["id", "label", "resourceId", "amount>0"];
        };
    };
};
