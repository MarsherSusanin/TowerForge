/** Terrain ids are project-authored; the built-in ids remain available as defaults. */
export type Terrain = string;
export type TerrainId = Terrain;
export type Outcome = "playing" | "victory" | "defeat";
export type WaveState = "ready" | "spawning" | "between" | "complete";
export type TowerAttackKind = "single" | "pulse" | "sniper" | "antiair" | "splash" | "support" | "support_buff" | "pipeline";
export type ResourceId = "coins" | (string & {});
export type EnemyMovementKind = "path" | "direct_flying";
export type EnemyTargetClass = "ground" | "flying";
export declare const TOWER_TARGET_MODES: readonly ["first", "last", "closest", "furthest", "strongest", "weakest", "fastest_ahead", "largest_hp"];
export type TowerTargetMode = (typeof TOWER_TARGET_MODES)[number];
/**
 * Author-defined (open, like `ResourceId`). Three ids are engine-implemented presets that need
 * no `effects` declaration: `path_water` (a bespoke path-tile terrain effect, routed to its own
 * handler), `strike` (a `damage` effect preset), and `freeze` (a `status: {stun}` effect preset).
 * Any other id must declare `MissionAbilityDefinition.effects` — see `AbilityEffect`.
 */
export type MissionAbilityId = string;
export type ResourceBag = Record<string, number>;
export type ResourceCost = Record<string, number>;
/** A spendable currency. `coins` is the required primary; any number of others may be added. */
export interface CurrencyDefinition {
    id: string;
    label: string;
    color?: number;
}
export interface GridCoord {
    q: number;
    r: number;
}
export type GridDefinition = {
    kind: "hex";
    layout: "odd-r";
} | {
    kind: "square";
    adjacency: "cardinal";
};
export interface TerrainTypeDefinition {
    id: TerrainId;
    label: string;
    buildable: boolean;
    walkable: boolean;
    groundSpeedMultiplier: number;
    tags: string[];
}
export interface GridTile extends GridCoord {
    terrain: Terrain;
    occupiedBy?: string;
}
export interface GridPathRoute {
    id: string;
    pathCenterline: GridCoord[];
}
/** @deprecated Use GridCoord. Coordinates stay `{q,r}` for project compatibility. */
export type HexCoord = GridCoord;
/** @deprecated Use GridTile. */
export type HexTile = GridTile;
/** @deprecated Use GridPathRoute. */
export type HexPathRoute = GridPathRoute;
export interface EnemyDeathSpawnDefinition {
    enemyId: string;
    count: number;
    forwardPathSteps: number;
    pathOffsets?: number[];
}
export interface EnemyPhaseSpawnDefinition {
    hpRatio: number;
    enemyId: string;
    count: number;
    routeIds?: string[];
    progressOffset?: number;
    pathOffsets?: number[];
}
export interface EnemyArmorDefinition {
    kind: "pierce_only";
    chipDamageByTowerId?: Record<string, number>;
}
export interface EnemyHealAuraDefinition {
    radius: number;
    healPerUnit: number;
    includeSelf?: boolean;
    stacks?: boolean;
}
export interface EnemyType {
    id: string;
    label: string;
    maxHp: number;
    speed: number;
    reward: ResourceCost;
    coinReward: number;
    coreDamage: number;
    color: number;
    movementKind?: EnemyMovementKind;
    targetClass?: EnemyTargetClass;
    ignoresWaterSlow?: boolean;
    /**
     * When true, this enemy acts as a path obstacle other ground enemies steer around.
     * Replaces the legacy hardcoded `oak_stump` / `oak_stump_boss` ids so any project
     * can designate its own blocker enemies.
     */
    isPathBlocker?: boolean;
    hitRadius?: number;
    pathCollisionRadius?: number;
    spawnOnDeath?: EnemyDeathSpawnDefinition;
    phaseSpawns?: EnemyPhaseSpawnDefinition[];
    armor?: EnemyArmorDefinition;
    healAura?: EnemyHealAuraDefinition;
    /**
     * Per-damage-type multipliers applied to incoming tower damage (e.g. `{ fire: 0.5, ice: 2 }` =
     * takes half fire, double ice). Author-defined type ids; any type not listed defaults to 1.
     */
    resistances?: Record<string, number>;
    /**
     * Boss pattern: every `interval` time-units, temporarily disables (silences) towers within
     * `radius` hexes for `duration` time-units — they cannot fire while disabled.
     */
    towerDisrupt?: EnemyTowerDisruptDefinition;
    /**
     * Boss pattern: every `interval` time-units, deals `damage` to the nearest tower within `range`
     * hexes — a tower with `maxHp` is destroyed when its hp reaches 0 (freeing its tile).
     */
    towerAttack?: EnemyTowerAttackDefinition;
}
export interface EnemyTowerAttackDefinition {
    interval: number;
    damage: number;
    range: number;
}
export interface EnemyTowerDisruptDefinition {
    interval: number;
    radius: number;
    duration: number;
}
/**
 * Composable delivery modifier: after a landed hit, the shot jumps hop-by-hop to the nearest
 * not-yet-hit ground enemy within `jumpRadius` of the last-hit enemy, up to `maxJumps` extra
 * hits, each hop's damage multiplied by `damageFalloff^hop`. Reuses the same damage-resolution
 * pipeline as the primary hit (resistances/armor/statusOnHit all ride along automatically).
 * The first genuinely composable tower capability — additive; a `single` tower with no `chain`
 * behaves exactly as before.
 */
export interface ChainDeliverySpec {
    maxJumps: number;
    jumpRadius: number;
    damageFalloff: number;
}
export interface SingleAttackModel {
    kind: "single";
    damageType?: string;
    fireRate: number;
    damagePerStack: number;
    startingStacks: number;
    maxStacks: number;
    upgradeCost: number;
    statusOnHit?: StatusEffectSpec;
    chain?: ChainDeliverySpec;
}
export interface PulseAttackModel {
    kind: "pulse";
    damageType?: string;
    pulseRate: number;
    pulseRateByLevel?: [number, number, number];
    pulseDamage: number;
    dotDamagePerUnit: number;
    dotDuration: number;
    upgradeCosts?: ResourceCost[];
    statusOnHit?: StatusEffectSpec;
}
export interface SniperAttackModel {
    kind: "sniper";
    damageType?: string;
    interval: number;
    damage: number;
    targetPriority: TowerTargetMode;
    rangeByLevel?: [number, number, number];
    upgradeCosts?: ResourceCost[];
    statusOnHit?: StatusEffectSpec;
}
export interface AntiAirAttackModel {
    kind: "antiair";
    damageType?: string;
    fireRate: number;
    damage: number;
    maxTargetsByLevel: [number, number, number, number];
    upgradeCosts: ResourceCost[];
    statusOnHit?: StatusEffectSpec;
}
export interface SplashAttackModel {
    kind: "splash";
    damageType?: string;
    interval: number;
    damage: number;
    splashDamage: number;
    armoredChipDamage: number;
    splashRadius: number;
    slowFactor: number;
    slowDuration: number;
    /** Classes affected by splash damage and its built-in slow. Defaults to ground only. */
    affectsClasses?: EnemyTargetClass[];
    intervalByLevel?: [number, number, number];
    upgradeCosts?: ResourceCost[];
    statusOnHit?: StatusEffectSpec;
}
export interface SupportAttackModel {
    kind: "support";
    auraRadius: number;
    auraRadiusByLevel?: [number, number, number];
    upgradeCosts?: ResourceCost[];
    unlocksTowerIds: string[];
}
export interface SupportBuffAttackModel {
    kind: "support_buff";
    auraRadius: number;
    fireRateMultiplierByLevel: [number, number, number];
    upgradeCosts?: ResourceCost[];
    affectsTowerIds: string[];
}
export interface TowerPipelineTargetingSpec {
    /** Enemy classes eligible for selection. Defaults to ground. */
    classes?: EnemyTargetClass[];
    /** Default priority for newly placed towers. Players may override it at runtime. */
    mode?: TowerTargetMode;
    /** Primary targets selected per activation. Defaults to one. */
    maxTargets?: number;
}
export type TowerPipelineDeliverySpec = {
    kind: "single";
} | {
    kind: "multi";
} | {
    kind: "area";
    radius: number;
    secondaryMultiplier?: number;
} | {
    kind: "chain";
    maxJumps: number;
    jumpRadius: number;
    damageFalloff?: number;
} | {
    kind: "aura";
};
export type TowerEffectSpec = {
    kind: "damage";
    amount: number;
    amountByLevel?: number[];
    damageType?: string;
    armorPiercing?: boolean;
} | {
    kind: "status";
    status: StatusEffectSpec;
} | {
    kind: "resource";
    resources: ResourceBag;
};
/**
 * Declarative tower execution model. Targeting chooses primary enemies, delivery expands that set,
 * and effects are applied in order to every delivered target. This is the preferred authoring
 * surface for new towers; legacy attack kinds remain supported for existing projects.
 */
export interface EffectPipelineAttackModel {
    kind: "pipeline";
    interval: number;
    intervalByLevel?: number[];
    rangeByLevel?: number[];
    targeting?: TowerPipelineTargetingSpec;
    delivery: TowerPipelineDeliverySpec;
    effects: TowerEffectSpec[];
    upgradeCosts?: ResourceCost[];
}
export interface TowerType {
    id: string;
    label: string;
    cost: ResourceCost;
    footprintRadius: number;
    range: number;
    /** If set, the tower has this much health and can be destroyed by enemy `towerAttack`. Omit = indestructible. */
    maxHp?: number;
    requiresAuraFrom?: string;
    attack: SingleAttackModel | PulseAttackModel | SniperAttackModel | AntiAirAttackModel | SplashAttackModel | SupportAttackModel | SupportBuffAttackModel | EffectPipelineAttackModel;
}
export interface DifficultyDefinition {
    id: string;
    label: string;
    description?: string;
    enemyHpMultiplier?: number;
    enemySpeedMultiplier?: number;
    enemyRewardMultiplier?: number;
    coreDamageMultiplier?: number;
    startingResourceMultiplier?: number;
    coreHpMultiplier?: number;
}
export interface MetaCurrencyDefinition {
    id: string;
    label: string;
    color?: number;
}
export type MetaUpgradeEffect = {
    kind: "towerDamage";
    multiplierPerLevel: number;
} | {
    kind: "towerFireRate";
    multiplierPerLevel: number;
} | {
    kind: "startingResource";
    resourceId: string;
    amountPerLevel: number;
} | {
    kind: "coreHp";
    amountPerLevel: number;
};
export interface MetaUpgradeDefinition {
    id: string;
    label: string;
    description?: string;
    maxLevel: number;
    costs: ResourceBag[];
    effects: MetaUpgradeEffect[];
}
export interface MissionMetaRewardDefinition {
    firstClear?: ResourceBag;
    repeatClear?: ResourceBag;
    perStar?: ResourceBag;
}
export interface MetaProgressionDefinition {
    currencies: MetaCurrencyDefinition[];
    upgrades: Record<string, MetaUpgradeDefinition>;
    rewardsByMission: Record<string, MissionMetaRewardDefinition>;
}
export interface WaveGroup {
    enemyId: string;
    count: number;
    spawnInterval: number;
    startDelay: number;
    routeId?: string;
}
export interface WaveDefinition {
    id: string;
    label: string;
    groups: WaveGroup[];
}
export interface MissionDefinition {
    id: string;
    label: string;
    description: string;
    availability?: "playable" | "comingSoon";
    mapId?: string;
    waveSetId?: string;
    buildTowerIds?: string[];
    abilityIds?: MissionAbilityId[];
    economy?: MissionEconomyDefinition;
    objectives?: MissionObjectivesDefinition;
    startingCoreHp: number;
    startingResources: ResourceBag;
    prepTimeUnits: number;
    waves: WaveDefinition[];
    countsTowardProgress?: boolean;
    abilities?: MissionAbilityDefinition[];
    sunlight?: MissionSunlightDefinition;
}
/** Optional mission-local economy rules. Omitted fields preserve the original reward-on-kill economy. */
export interface MissionEconomyDefinition {
    /** Resources granted when a wave starts, including manually started waves. */
    perWaveStart?: ResourceBag;
    /** Resources granted once each started wave has no queued or living enemies left. */
    perWaveClear?: ResourceBag;
    /** Continuous income while the mission clock is running. Values may be fractional. */
    passivePerTimeUnit?: ResourceBag;
    /** Fraction of current resources granted as interest on each wave clear. */
    interestRate?: number;
    /** Optional per-currency cap for one wave's interest grant. */
    interestCap?: ResourceBag;
    /** Resource amount per skipped prep-time unit when the player starts the next wave early. */
    earlyStartBonusPerUnit?: ResourceBag;
    /** Fraction of placement + upgrade spend refunded on sell. Defaults to 0.7. */
    sellRefundRatio?: number;
}
export type MissionVictoryObjective = {
    id: string;
    label?: string;
    kind: "clearWaves";
} | {
    id: string;
    label?: string;
    kind: "surviveSeconds";
    seconds: number;
} | {
    id: string;
    label?: string;
    kind: "killCount";
    count: number;
    enemyTypeId?: string;
} | {
    id: string;
    label?: string;
    kind: "accumulateResource";
    resourceId: string;
    amount: number;
};
export type MissionFailureObjective = {
    id: string;
    label?: string;
    kind: "maxLeaks";
    maxLeaks: number;
} | {
    id: string;
    label?: string;
    kind: "timeLimit";
    seconds: number;
};
export type MissionStarCondition = {
    id: string;
    label: string;
    kind: "coreHpAtLeast";
    amount: number;
} | {
    id: string;
    label: string;
    kind: "maxLeaks";
    maxLeaks: number;
} | {
    id: string;
    label: string;
    kind: "timeAtMost";
    seconds: number;
} | {
    id: string;
    label: string;
    kind: "resourceAtLeast";
    resourceId: string;
    amount: number;
};
/** All victory objectives must complete; any failure condition ends the mission. Core depletion always loses. */
export interface MissionObjectivesDefinition {
    victory: MissionVictoryObjective[];
    failure?: MissionFailureObjective[];
    stars?: MissionStarCondition[];
}
/**
 * A composable primitive an ability applies to each enemy within its radius. The same shape
 * `applyStatusEffect` already resolves for a tower's `attack.statusOnHit` — abilities and tower
 * attacks share one status-effect vocabulary. A custom (non-preset) ability author-declares
 * `MissionAbilityDefinition.effects` from these; no engine code is needed for a new ability that
 * only needs damage and/or status effects.
 */
export type AbilityEffect = {
    kind: "damage";
    amount: number;
} | {
    kind: "status";
    status: StatusEffectSpec;
};
export interface MissionAbilityDefinition {
    id: MissionAbilityId;
    label: string;
    cooldown: number;
    duration: number;
    radius: number;
    /** `strike` preset only: instant damage dealt to each enemy in radius (falls back for `effects`-less "strike"). */
    damage?: number;
    /** `freeze` preset only: seconds each enemy in radius is stunned (falls back to `duration`; used when `effects` is absent). */
    stunDuration?: number;
    /**
     * A custom ability's effect composition, applied to every enemy within `radius` of the target
     * coord. When present, this takes precedence over the `path_water`/`strike`/`freeze` presets —
     * an author MAY override a preset id's behavior by declaring `effects` explicitly.
     */
    effects?: AbilityEffect[];
}
export interface MissionSunlightDefinition {
    pathOrders?: number[];
    pathTiles?: MissionSunlightPathTile[];
    regenPerUnit: number;
    aoeDamageMultiplier: number;
}
export interface MissionSunlightPathTile {
    routeId: string;
    pathOrder: number;
}
export interface EnemyState {
    id: string;
    typeId: string;
    hp: number;
    maxHp: number;
    pathProgress: number;
    dotRemaining: number;
    /** Damage-per-time-unit of the dots currently on this enemy (set by the pulse tower that applied them). */
    dotDamagePerUnit?: number;
    /** Tower type id that applied the active dots, used for armor resolution of lingering dot damage. */
    dotSourceTowerTypeId?: string;
    pathOffset: number;
    routeId?: string;
    phaseSpawnsTriggered?: string[];
    statuses?: {
        slow?: {
            factor: number;
            remaining: number;
        };
        stun?: {
            remaining: number;
        };
        poison?: {
            dps: number;
            remaining: number;
        };
    };
    /** Time until this enemy's next tower-disrupt pulse (lazily initialized from towerDisrupt.interval). */
    disruptCooldown?: number;
    /** Time until this enemy's next tower-attack strike (lazily initialized from towerAttack.interval). */
    towerAttackCooldown?: number;
}
/** Data-driven status effects a damaging attack can apply on hit (content-agnostic, composable). */
export interface StatusEffectSpec {
    /** Seconds the enemy is frozen in place (movement halts). */
    stun?: number;
    /** Multiplicative slow: speed × factor (0–1) for `duration` seconds. Ground enemies only. */
    slow?: {
        factor: number;
        duration: number;
    };
    /** Damage-over-time: `dps` damage per time-unit for `duration` seconds. */
    poison?: {
        dps: number;
        duration: number;
    };
    /** Classes affected by `slow`. Defaults to ground only; stun/poison keep their legacy all-class behavior. */
    slowAffectsClasses?: EnemyTargetClass[];
}
export interface TowerState {
    id: string;
    typeId: string;
    coord: HexCoord;
    footprint: HexCoord[];
    level: number;
    targetMode?: TowerTargetMode;
    stacks: number;
    cooldown: number;
    /** Placement and upgrade costs accumulated for deterministic sell refunds. */
    investedResources: ResourceBag;
    /** Remaining time this tower is disabled (silenced) by an enemy tower-disrupt pulse; 0 = active. */
    disabledFor?: number;
    /** Current health if the tower type has `maxHp`; when it reaches 0 the tower is destroyed. */
    hp?: number;
}
export type GameEvent = {
    type: "towerPlaced";
    towerId: string;
    towerTypeId: string;
    coord: GridCoord;
    terrain: Terrain;
    terrainMetadata: TerrainTypeDefinition;
} | {
    type: "towerSold";
    towerId: string;
    towerTypeId: string;
    refund: ResourceBag;
} | {
    type: "towerMoved";
    towerId: string;
    from: HexCoord;
    to: HexCoord;
    cost: ResourceBag;
} | {
    type: "towerUpgraded";
    towerId: string;
    level: number;
    stacks: number;
} | {
    type: "towerDisrupted";
    enemyId: string;
    enemyTypeId: string;
    towerIds: string[];
    duration: number;
} | {
    type: "towerAttacked";
    enemyId: string;
    enemyTypeId: string;
    towerId: string;
    damage: number;
} | {
    type: "towerDestroyed";
    towerId: string;
    towerTypeId: string;
    enemyId: string;
} | {
    type: "towerTargetModeChanged";
    towerId: string;
    mode: TowerTargetMode;
} | {
    type: "enemyKilled";
    enemyId: string;
    enemyTypeId: string;
    coins: number;
    resources: ResourceBag;
} | {
    type: "enemySpawnedOnDeath";
    parentEnemyId: string;
    parentEnemyTypeId: string;
    enemyTypeId: string;
    enemyIds: string[];
} | {
    type: "enemyLeaked";
    enemyId: string;
    enemyTypeId: string;
    damage: number;
} | {
    type: "waveStarted";
    waveIndex: number;
} | {
    type: "waveCleared";
    waveIndex: number;
    income: ResourceBag;
    interest: ResourceBag;
} | {
    type: "resourcesGranted";
    source: "waveStart" | "earlyStart";
    waveIndex: number;
    resources: ResourceBag;
} | {
    type: "objectiveCompleted";
    objectiveId: string;
    kind: MissionVictoryObjective["kind"];
} | {
    type: "objectiveFailed";
    objectiveId: string;
    kind: MissionFailureObjective["kind"];
} | {
    type: "starEarned";
    starId: string;
} | {
    type: "towerFired";
    towerId: string;
    enemyId: string;
    damage: number;
} | {
    type: "enemyHit";
    towerId: string;
    enemyId: string;
    enemyTypeId: string;
    damage: number;
} | {
    type: "enemyArmorBlocked";
    towerId: string;
    enemyId: string;
    enemyTypeId: string;
    rawDamage: number;
} | {
    type: "enemyHealed";
    healerEnemyId: string;
    targetEnemyId: string;
    targetEnemyTypeId: string;
    amount: number;
} | {
    type: "enemyPhaseSpawned";
    parentEnemyId: string;
    parentEnemyTypeId: string;
    enemyTypeId: string;
    enemyIds: string[];
    hpRatio: number;
} | {
    type: "areaPulse";
    towerId: string;
    enemyIds: string[];
} | {
    type: "towerResourcesGranted";
    towerId: string;
    enemyId: string;
    resources: ResourceBag;
} | {
    type: "waterAbilityUsed";
    abilityId: MissionAbilityId;
    center: HexCoord;
    coords: HexCoord[];
    duration: number;
} | {
    type: "abilityUsed";
    abilityId: MissionAbilityId;
    center: HexCoord;
    enemyIds: string[];
    effects: AbilityEffect[];
} | {
    type: "enemyEnteredTile";
    enemyId: string;
    enemyTypeId: string;
    coord: GridCoord;
    terrain: Terrain;
    terrainMetadata: TerrainTypeDefinition;
    routeId?: string;
    pathOrder: number;
} | {
    type: "terrainChanged";
    coord: GridCoord;
    fromTerrain: Terrain;
    toTerrain: Terrain;
    terrainMetadata: TerrainTypeDefinition;
    source: "script" | "ability" | "restore";
} | {
    type: "scriptSignal";
    scriptId: string;
    signal: string;
    payload: import("../scripting/types.js").TowerScriptJson;
} | {
    type: "scriptDiagnostic";
    diagnostic: import("../scripting/types.js").TowerScriptDiagnostic;
} | {
    type: "victory";
} | {
    type: "defeat";
};
export interface AbilitySnapshot {
    id: MissionAbilityId;
    label: string;
    cooldown: number;
    cooldownRemaining: number;
    duration: number;
    radius: number;
    ready: boolean;
}
export interface TemporaryWaterTile extends HexCoord {
    expiresIn: number;
}
export interface RuntimeTerrainOverride extends GridCoord {
    terrain: Terrain;
    expiresIn?: number;
    source: "script" | "ability";
}
export interface SunlightTile extends HexCoord {
    pathOrder: number;
    routeId?: string;
}
export interface GameSnapshot {
    mapId: string;
    grid: GridDefinition;
    missionId: string;
    missionLabel: string;
    difficultyId: string;
    difficultyLabel: string;
    coreHp: number;
    maxCoreHp: number;
    coins: number;
    resources: ResourceBag;
    waveIndex: number;
    totalWaves: number;
    startedWaveCount: number;
    clearedWaveCount: number;
    killCount: number;
    leakCount: number;
    killCountByEnemyType: Record<string, number>;
    objectiveProgress: MissionObjectiveProgress[];
    stars: MissionStarSnapshot[];
    missionElapsed: number;
    waveState: WaveState;
    prepRemaining: number;
    nextWaveRemaining: number;
    nextWaveDelayUnits: number;
    enemies: EnemyState[];
    towers: TowerState[];
    tiles: HexTile[];
    abilities: Partial<Record<MissionAbilityId, AbilitySnapshot>>;
    temporaryWaterTiles: TemporaryWaterTile[];
    terrainOverrides: RuntimeTerrainOverride[];
    sunlightTiles: SunlightTile[];
    pathCenterline: HexCoord[];
    pathRoutes: HexPathRoute[];
    spawnCoord: HexCoord;
    coreCoord: HexCoord;
    outcome: Outcome;
    scriptState: import("../scripting/types.js").TowerScriptStateSnapshot;
    lastEvents: GameEvent[];
}
export interface MissionObjectiveProgress {
    id: string;
    label: string;
    kind: MissionVictoryObjective["kind"];
    current: number;
    target: number;
    complete: boolean;
}
export interface MissionStarSnapshot {
    id: string;
    label: string;
    achieved: boolean;
}
export interface ActionResult {
    ok: boolean;
    reason?: string;
    reasonKey?: string;
    reasonParams?: Record<string, string | number | undefined>;
}
