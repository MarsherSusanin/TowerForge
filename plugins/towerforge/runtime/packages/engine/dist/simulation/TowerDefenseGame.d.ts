import { type GameContentRegistry } from "../content/registry.js";
import type { TowerScriptJson } from "../scripting/types.js";
import { GridMap } from "./map.js";
import type { ActionResult, CurrencyDefinition, DifficultyDefinition, EnemyState, GameEvent, GameSnapshot, HexCoord, MissionAbilityId, ResourceBag, ResourceCost, TowerTargetMode, TowerState, WaveState } from "./types.js";
export interface TowerDefenseGameOptions {
    missionId: string;
    content: GameContentRegistry;
    difficultyId?: string;
    /** Persistent profile input. The pure engine consumes levels but never reads or writes storage. */
    metaUpgradeLevels?: Record<string, number>;
}
export declare class TowerDefenseGame {
    readonly content: GameContentRegistry;
    readonly mission: GameContentRegistry["missions"][string];
    readonly map: GridMap;
    coreHp: number;
    resources: ResourceBag;
    waveIndex: number;
    startedWaveCount: number;
    waveState: WaveState;
    prepRemaining: number;
    outcome: GameSnapshot["outcome"];
    enemies: EnemyState[];
    towers: TowerState[];
    lastEvents: GameEvent[];
    readonly currencies: CurrencyDefinition[];
    readonly difficulty: DifficultyDefinition;
    private readonly currencyIds;
    private readonly metaUpgradeLevels;
    private readonly maxCoreHp;
    private readonly towerDamageMultiplier;
    private readonly towerFireRateMetaMultiplier;
    private enemyCounter;
    private towerCounter;
    private clearedWaveCount;
    private killCount;
    private leakCount;
    private killCountByEnemyType;
    private completedObjectiveIds;
    private earnedStarIds;
    private spawnQueue;
    private missionElapsed;
    private nextWaveStartAt;
    private abilityCooldowns;
    private temporaryWaterTiles;
    private runtimeTerrainOverrides;
    private readonly sunlightPathKeys;
    private readonly sunlightTilesSnapshot;
    private readonly directFlightLine;
    private readonly staticTilesSnapshot;
    private readonly staticPathCenterlineSnapshot;
    private readonly staticPathRoutesSnapshot;
    private readonly staticSpawnCoordSnapshot;
    private readonly staticCoreCoordSnapshot;
    private scriptValues;
    private scriptDiagnostics;
    private scriptHandlerLastRun;
    private scriptEventCursor;
    private scriptActionsRemaining;
    private scriptTerrainChangesRemaining;
    private scriptSignalDepth;
    constructor(options: TowerDefenseGameOptions);
    get coins(): number;
    set coins(value: number);
    get towerTypes(): Record<string, import("./types.js").TowerType>;
    get enemyTypes(): Record<string, import("./types.js").EnemyType>;
    get waves(): import("./types.js").WaveDefinition[];
    reset(): void;
    startNextWave(): ActionResult;
    canPlaceTower(typeId: string, coord: HexCoord): ActionResult;
    canPlaceTowerAnywhere(typeId: string): ActionResult;
    placeTower(typeId: string, coord: HexCoord): ActionResult;
    canMoveTower(towerId: string, coord: HexCoord): ActionResult;
    moveTower(towerId: string, coord: HexCoord): ActionResult;
    canUpgradeTower(towerId: string): ActionResult;
    getTowerUpgradeCost(towerOrId: TowerState | string): ResourceCost | null;
    upgradeTower(towerId: string): ActionResult;
    getTowerSellRefund(towerOrId: TowerState | string): ResourceBag | null;
    canSellTower(towerId: string): ActionResult;
    sellTower(towerId: string): ActionResult;
    setTowerTargetMode(towerId: string, mode: TowerTargetMode): ActionResult;
    usePathWaterAbility(center: HexCoord): ActionResult;
    /**
     * The `strike`/`freeze` engine presets, expressed as the same composable effects a custom
     * ability declares via `MissionAbilityDefinition.effects`. Returns undefined for any other id
     * (including `path_water`, which stays on its own bespoke tile-targeting handler below — its
     * validation/failure modes are tile-specific, not enemy-targeted).
     */
    private builtinAbilityEffects;
    private applyAbilityEffect;
    /**
     * Trigger a mission ability at a target coord. `path_water` routes to its own handler (a
     * tile effect, not enemy-targeted). Every other ability — `strike`/`freeze` presets or a
     * custom author-declared one — resolves to an `effects[]` composition applied to every enemy
     * within `radius` of `center`, via the shared applyAbilityEffect primitive. A custom ability
     * needs no engine code: declare `effects` on it and it just works.
     */
    useAbility(abilityId: MissionAbilityId, center: HexCoord): ActionResult;
    /**
     * Dispatch an author-defined event into TowerScript. This is the only custom event bridge:
     * callers provide JSON data, while scripts still receive no executable host capability.
     */
    emitScriptSignal(signal: string, payload?: TowerScriptJson): ActionResult;
    getTowerIdAt(coord: HexCoord): string | undefined;
    tick(deltaUnits: number): void;
    getSnapshot(): GameSnapshot;
    getRenderSnapshot(): GameSnapshot;
    private buildSnapshot;
    private initializeScripts;
    private beginScriptTransaction;
    private finishScriptedAction;
    private processScriptEvents;
    private runScriptEvent;
    private runScriptHandler;
    private scriptContexts;
    private scriptStateFor;
    private scriptExpressionContext;
    private applyScriptAction;
    private resolveScriptTileTarget;
    private applyTerrainOverride;
    private restoreTerrainOverride;
    private restoreTerrainOverrideByKey;
    private syncTemporaryWaterTiles;
    private terrainMetadata;
    private resolveScriptEnemies;
    private resolveScriptTowers;
    private assertScriptStateSize;
    private recordScriptDiagnostic;
    private cloneScriptJsonObject;
    private cloneScriptValues;
    enemyCoord(enemy: EnemyState): HexCoord;
    private startWave;
    private startScheduledWaves;
    private buildSpawnQueue;
    private spawnDueEnemies;
    private createEnemyState;
    private updateAbilities;
    private updateEnemyStatuses;
    private buildAbilitySnapshot;
    private buildSunlightTilesSnapshot;
    private moveEnemies;
    private applyDotDamage;
    private isPulseTower;
    private firstPulseTowerTypeId;
    private pulseDotDamagePerUnit;
    private applySunlightRegeneration;
    private applyHealAuras;
    /** Boss pattern: enemies with `towerDisrupt` periodically silence towers within radius. */
    private updateTowerDisruptions;
    /** Boss pattern: enemies with `towerAttack` periodically damage the nearest tower with hp; destroy it at 0. */
    private updateEnemyTowerAttacks;
    private destroyTower;
    private updateTowers;
    private updateSingleTower;
    /**
     * Chain delivery: propagate a landed hit hop-by-hop to the nearest not-yet-hit ground enemy
     * within `jumpRadius` of the LAST-hit enemy (not the origin — a true chain, not a fixed-radius
     * splash), for up to `maxJumps` extra hits, each scaled by `damageFalloff^hop`. Deterministic:
     * ties broken by enemy id. Reuses applyTowerDamage so resistances/armor/statusOnHit apply to
     * every hop exactly as they would to a primary hit.
     */
    private propagateChain;
    private updatePulseTower;
    private updateSniperTower;
    private updateAntiAirTower;
    private updateSplashTower;
    private updatePipelineTower;
    private pipelineTargets;
    private applyPipelineEffect;
    private findSingleTarget;
    private findSniperTarget;
    private findAntiAirTargets;
    private findSplashTarget;
    private towerSupportsTargetMode;
    private selectTargets;
    private compareTargets;
    private enemyInRange;
    private towerRange;
    private slipperyJackInterval;
    private towerPulseRate;
    private enemyTrack;
    private enemyTrackForType;
    private enemyTargetClass;
    private enemyTargetClassByType;
    private enemyTerrainSpeedFactor;
    private enemyStatusSpeedFactor;
    private isEnemyInSunlight;
    private aoeDamageAfterSunlight;
    private applyTowerDamage;
    private resolveEffectiveTowerDamage;
    /** The (author-defined) damage type a tower deals; defaults to "physical". */
    private damageTypeOf;
    /** Enemy's incoming-damage multiplier for a damage type (unlisted types = 1, clamped >= 0). */
    private resistanceMultiplier;
    private isDamageBlockedByArmor;
    /** "pierce_only" armor is fully pierced by any sniper-kind weapon, regardless of its tower id. */
    private piercesSniperArmor;
    private armoredChipDamageForTower;
    private hasPierceOnlyArmor;
    private applySlow;
    /** Apply a tower's data-driven on-hit status effects. Content-agnostic: keyed on attack.statusOnHit. */
    private applyStatusOnHit;
    /**
     * Apply a status-effect spec to an enemy. The shared primitive behind both a tower's
     * `attack.statusOnHit` (via applyStatusOnHit) and an ability's `{kind:"status"}` effect
     * (via applyAbilityEffect) — one status vocabulary, two triggers.
     */
    private applyStatusEffect;
    private triggerEnemyPhaseSpawns;
    private createPhaseSpawnChildren;
    private towerFireRateMultiplier;
    private supportBuffTouchesTower;
    private enemyRouteProgressRatio;
    private defaultRouteId;
    private resolveRouteId;
    private routePathKey;
    private isTemporaryWaterTile;
    private isInsideAnyPulse;
    private isInsideSupportAura;
    private canOccupyTowerFootprint;
    private dependentsKeepSupportAfterMove;
    private dependentsKeepSupportAfterRemoval;
    private applyPassiveIncome;
    private awardClearedWaveIncome;
    private removeDeadEnemies;
    private spawnOnDeathChildren;
    private resolveWaveState;
    private victoryObjectives;
    private buildObjectiveProgress;
    private objectiveLabel;
    private failureConditionMet;
    private starConditionMet;
    private buildStarSnapshot;
    private syncPrepRemaining;
    private getNextWaveRemaining;
    private isPathBlockerType;
    private enemyAvoidanceOffset;
    /** Build a full bag over the declared currency set, defaulting any missing currency to 0. */
    private cloneResources;
    private normalizeMetaUpgradeLevels;
    private metaEffectTotal;
    private initialResources;
    private cleanCoord;
    private normalizeCost;
    private hasResources;
    private spendResources;
    private addResources;
    private addToBag;
    private scaleBag;
    private bagHasValue;
    private formatCost;
    private fail;
    private costReasonParams;
}
