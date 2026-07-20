import { type GameContentRegistry } from "../content/registry.js";
import { evaluateTowerScriptExpression } from "../scripting/expression.js";
import { TOWER_SCRIPT_LIMITS } from "../scripting/schema-descriptor.js";
import type {
  TowerScriptAction,
  TowerScriptBinding,
  TowerScriptDefinition,
  TowerScriptDiagnostic,
  TowerScriptEntityTarget,
  TowerScriptEventName,
  TowerScriptHandler,
  TowerScriptJson
} from "../scripting/types.js";
import { coordKey, hexDistance, hexLine } from "./hex.js";
import { HexMap } from "./map.js";
import { TOWER_TARGET_MODES } from "./types.js";
import type {
  AbilityEffect,
  ActionResult,
  ChainDeliverySpec,
  CurrencyDefinition,
  DifficultyDefinition,
  EffectPipelineAttackModel,
  EnemyPhaseSpawnDefinition,
  EnemyState,
  EnemyTargetClass,
  GameEvent,
  GameSnapshot,
  HexCoord,
  HexTile,
  MissionAbilityDefinition,
  MissionAbilityId,
  MissionFailureObjective,
  MissionStarCondition,
  MissionVictoryObjective,
  ResourceBag,
  ResourceCost,
  StatusEffectSpec,
  SunlightTile,
  TemporaryWaterTile,
  TowerTargetMode,
  TowerEffectSpec,
  TowerState,
  WaveState
} from "./types.js";

interface SpawnItem {
  at: number;
  enemyId: string;
  routeId?: string;
}

interface DamageResolutionOptions {
  aoe?: boolean;
  damageType?: string;
  armorPiercing?: boolean;
  applyLegacyStatus?: boolean;
}

interface TowerScriptSelfContext {
  scope: TowerScriptBinding["scope"];
  id: string;
  typeId?: string;
  value: Record<string, unknown>;
}

interface TowerScriptExecutionContext {
  script: TowerScriptDefinition;
  binding: TowerScriptBinding;
  self: TowerScriptSelfContext;
  state: Record<string, TowerScriptJson>;
  stateKey: string;
  event: Record<string, unknown>;
  eventName: TowerScriptEventName;
}

const SCRIPT_GAME_EVENT_NAMES = new Set<TowerScriptEventName>([
  "towerPlaced", "towerSold", "towerMoved", "towerUpgraded", "towerDestroyed", "towerTargetModeChanged",
  "towerFired", "towerResourcesGranted", "enemyHit", "enemyKilled", "enemyLeaked", "enemySpawnedOnDeath",
  "enemyPhaseSpawned", "waveStarted", "waveCleared", "resourcesGranted", "abilityUsed", "objectiveCompleted",
  "objectiveFailed", "starEarned", "victory", "defeat"
]);

export interface TowerDefenseGameOptions {
  missionId: string;
  content: GameContentRegistry;
  difficultyId?: string;
  /** Persistent profile input. The pure engine consumes levels but never reads or writes storage. */
  metaUpgradeLevels?: Record<string, number>;
}

export class TowerDefenseGame {
  readonly content: GameContentRegistry;
  readonly mission: GameContentRegistry["missions"][string];
  readonly map: HexMap;
  coreHp: number;
  resources: ResourceBag;
  waveIndex = 0;
  startedWaveCount = 0;
  waveState: WaveState = "ready";
  prepRemaining = 0;
  outcome: GameSnapshot["outcome"] = "playing";
  enemies: EnemyState[] = [];
  towers: TowerState[] = [];
  lastEvents: GameEvent[] = [];
  readonly currencies: CurrencyDefinition[];
  readonly difficulty: DifficultyDefinition;
  private readonly currencyIds: string[];
  private readonly metaUpgradeLevels: Record<string, number>;
  private readonly maxCoreHp: number;
  private readonly towerDamageMultiplier: number;
  private readonly towerFireRateMetaMultiplier: number;

  private enemyCounter = 0;
  private towerCounter = 0;
  private clearedWaveCount = 0;
  private killCount = 0;
  private leakCount = 0;
  private killCountByEnemyType: Record<string, number> = {};
  private completedObjectiveIds = new Set<string>();
  private earnedStarIds = new Set<string>();
  private spawnQueue: SpawnItem[] = [];
  private missionElapsed = 0;
  private nextWaveStartAt: number | null = null;
  private abilityCooldowns: Partial<Record<MissionAbilityId, number>> = {};
  private temporaryWaterTiles: TemporaryWaterTile[] = [];
  private readonly sunlightPathKeys: Set<string>;
  private readonly sunlightTilesSnapshot: SunlightTile[];
  private readonly directFlightLine: HexCoord[];
  private readonly staticTilesSnapshot: HexTile[];
  private readonly staticPathCenterlineSnapshot: HexCoord[];
  private readonly staticPathRoutesSnapshot: GameSnapshot["pathRoutes"];
  private readonly staticSpawnCoordSnapshot: HexCoord;
  private readonly staticCoreCoordSnapshot: HexCoord;
  private scriptValues: Record<string, Record<string, Record<string, TowerScriptJson>>> = {};
  private scriptDiagnostics: TowerScriptDiagnostic[] = [];
  private scriptHandlerLastRun: Record<string, number> = {};
  private scriptEventCursor = 0;
  private scriptActionsRemaining = 0;
  private scriptSignalDepth = 0;

  constructor(options: TowerDefenseGameOptions) {
    this.content = options.content;
    // Currencies are content-defined; "coins" is always guaranteed as the primary (first) currency.
    // Dedupe and reorder defensively so the engine is correct even on content built without the loader.
    const declared = this.content.currencies?.length ? this.content.currencies : [{ id: "coins", label: "Coins" }];
    const seen = new Set<string>();
    const ordered: CurrencyDefinition[] = [];
    for (const currency of declared) {
      if (currency && currency.id && !seen.has(currency.id)) {
        seen.add(currency.id);
        ordered.push(currency);
      }
    }
    if (!seen.has("coins")) ordered.unshift({ id: "coins", label: "Coins" });
    const coinsIndex = ordered.findIndex((c) => c.id === "coins");
    if (coinsIndex > 0) ordered.unshift(ordered.splice(coinsIndex, 1)[0]!);
    this.currencies = ordered;
    this.currencyIds = this.currencies.map((c) => c.id);
    const missionId = options.missionId;
    const mission = this.content.missions[missionId];
    if (!mission) {
      throw new Error(`Mission "${missionId}" not found in content registry.`);
    }
    this.mission = mission;
    this.map = this.mission.mapFactory();
    this.difficulty = this.content.difficulties.find((item) => item.id === options.difficultyId)
      ?? this.content.difficulties.find((item) => item.id === this.content.defaultDifficultyId)
      ?? { id: "normal", label: "Normal" };
    this.metaUpgradeLevels = this.normalizeMetaUpgradeLevels(options.metaUpgradeLevels ?? {});
    this.towerDamageMultiplier = Math.max(0, 1 + this.metaEffectTotal("towerDamage", "multiplierPerLevel"));
    this.towerFireRateMetaMultiplier = Math.max(0.05, 1 + this.metaEffectTotal("towerFireRate", "multiplierPerLevel"));

    this.directFlightLine = hexLine(this.map.spawnCoord, this.map.coreCoord);
    const sunlight = this.buildSunlightTilesSnapshot();
    this.sunlightPathKeys = new Set(sunlight.map((tile) => this.routePathKey(tile.routeId, tile.pathOrder)));
    this.sunlightTilesSnapshot = sunlight;
    this.staticTilesSnapshot = [...this.map.tiles.values()].map(({ q, r, terrain }) => ({ q, r, terrain }));
    this.staticPathCenterlineSnapshot = this.map.pathCenterline.map((coord) => ({ ...coord }));
    this.staticPathRoutesSnapshot = this.map.pathRoutes.map((route) => ({
      id: route.id,
      pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
    }));
    this.staticSpawnCoordSnapshot = { ...this.map.spawnCoord };
    this.staticCoreCoordSnapshot = { ...this.map.coreCoord };
    this.maxCoreHp = Math.max(
      1,
      this.mission.startingCoreHp * (this.difficulty.coreHpMultiplier ?? 1) + this.metaEffectTotal("coreHp", "amountPerLevel")
    );
    this.coreHp = this.maxCoreHp;
    this.resources = this.initialResources();
    this.initializeScripts();
    this.beginScriptTransaction();
    this.runScriptEvent("gameStarted", { type: "gameStarted" });
    this.processScriptEvents();
  }

  get coins(): number {
    return this.resources.coins ?? 0;
  }

  set coins(value: number) {
    this.resources.coins = value;
  }

  get towerTypes() {
    return this.content.towers;
  }

  get enemyTypes() {
    return this.content.enemies;
  }

  get waves() {
    return this.mission.waves;
  }

  reset(): void {
    this.coreHp = this.maxCoreHp;
    this.resources = this.initialResources();
    this.waveIndex = 0;
    this.startedWaveCount = 0;
    this.waveState = "ready";
    this.prepRemaining = 0;
    this.outcome = "playing";
    for (const tower of this.towers) {
      this.map.clearOccupied(tower.id);
    }

    this.enemies = [];
    this.towers = [];
    this.lastEvents = [];
    this.enemyCounter = 0;
    this.towerCounter = 0;
    this.clearedWaveCount = 0;
    this.killCount = 0;
    this.leakCount = 0;
    this.killCountByEnemyType = {};
    this.completedObjectiveIds.clear();
    this.earnedStarIds.clear();
    this.spawnQueue = [];
    this.missionElapsed = 0;
    this.nextWaveStartAt = null;
    this.abilityCooldowns = {};
    this.temporaryWaterTiles = [];
    this.initializeScripts();
    this.beginScriptTransaction();
    this.runScriptEvent("gameStarted", { type: "gameStarted" });
    this.processScriptEvents();
    for (const tile of this.map.tiles.values()) {
      delete tile.occupiedBy;
    }
  }

  startNextWave(): ActionResult {
    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }

    if (this.startedWaveCount >= this.mission.waves.length) {
      return this.fail("No waves left.", "reason.noWaves");
    }
    const earlyStartUnits = this.startedWaveCount > 0 ? this.getNextWaveRemaining() : 0;
    const result = this.startWave(this.startedWaveCount, this.missionElapsed, earlyStartUnits);
    if (result.ok) this.finishScriptedAction();
    return result;
  }

  canPlaceTower(typeId: string, coord: HexCoord): ActionResult {
    const type = this.towerTypes[typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }

    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }

    if (!this.hasResources(type.cost)) {
      return this.fail(`Need ${this.formatCost(type.cost)}.`, "reason.needCost", this.costReasonParams(type.cost));
    }

    return this.canOccupyTowerFootprint(typeId, coord);
  }

  canPlaceTowerAnywhere(typeId: string): ActionResult {
    const type = this.towerTypes[typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }

    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }

    if (!this.hasResources(type.cost)) {
      return this.fail(`Need ${this.formatCost(type.cost)}.`, "reason.needCost", this.costReasonParams(type.cost));
    }

    let firstReason = "No valid build space.";
    let firstReasonKey: ActionResult["reasonKey"] = "reason.noBuildSpace";
    let firstReasonParams: ActionResult["reasonParams"] | undefined;
    for (const tile of this.map.tiles.values()) {
      const result = this.canPlaceTower(typeId, tile);
      if (result.ok) {
        return { ok: true };
      }
      firstReason = result.reason ?? firstReason;
      firstReasonKey = result.reasonKey ?? firstReasonKey;
      firstReasonParams = result.reasonParams ?? firstReasonParams;
    }

    return { ok: false, reason: firstReason, reasonKey: firstReasonKey, reasonParams: firstReasonParams };
  }

  placeTower(typeId: string, coord: HexCoord): ActionResult {
    const check = this.canPlaceTower(typeId, coord);
    if (!check.ok) {
      return check;
    }

    const type = this.towerTypes[typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }
    const towerId = `tower_${++this.towerCounter}`;
    const attack = type.attack;
    const tower: TowerState = {
      id: towerId,
      typeId,
      coord: this.cleanCoord(coord),
      footprint: this.map.tilesWithin(coord, type.footprintRadius).map(({ q, r }) => ({ q, r })),
      level: 1,
      targetMode: attack.kind === "sniper"
        ? (attack.targetPriority ?? "first")
        : (attack.kind === "pipeline"
            ? (attack.targeting?.mode ?? "first")
            : (attack.kind === "single" || attack.kind === "antiair" || attack.kind === "splash" ? "first" : undefined)),
      stacks: attack.kind === "single" ? attack.startingStacks : 0,
      cooldown: 0,
      investedResources: this.normalizeCost(type.cost),
      hp: typeof type.maxHp === "number" && type.maxHp > 0 ? type.maxHp : undefined
    };

    this.spendResources(type.cost);
    this.towers.push(tower);
    this.map.setOccupied(tower.footprint, towerId);
    this.lastEvents.push({ type: "towerPlaced", towerId, towerTypeId: typeId });
    this.finishScriptedAction();
    return { ok: true };
  }

  canMoveTower(towerId: string, coord: HexCoord): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) {
      return this.fail("No tower selected.", "reason.noTowerSelected");
    }

    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }

    const moveTowerCost = this.content.constants.moveTowerCost;
    if (!this.hasResources(moveTowerCost)) {
      return this.fail(`Need ${this.formatCost(moveTowerCost)}.`, "reason.needCost", this.costReasonParams(moveTowerCost));
    }

    const footprintCheck = this.canOccupyTowerFootprint(tower.typeId, coord, tower.id);
    if (!footprintCheck.ok) {
      return footprintCheck;
    }

    if (this.towerTypes[tower.typeId]?.attack.kind === "support" && !this.dependentsKeepSupportAfterMove(tower.id, coord)) {
      return this.fail("Dependent towers would lose this support aura.", "reason.dependentsLoseAura");
    }

    return { ok: true };
  }

  moveTower(towerId: string, coord: HexCoord): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) {
      return this.fail("No tower selected.", "reason.noTowerSelected");
    }

    const check = this.canMoveTower(towerId, coord);
    if (!check.ok) {
      return check;
    }

    const from = this.cleanCoord(tower.coord);
    const type = this.towerTypes[tower.typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }
    const footprint = this.map.tilesWithin(coord, type.footprintRadius).map(({ q, r }) => ({ q, r }));

    const moveTowerCost = this.content.constants.moveTowerCost;
    this.spendResources(moveTowerCost);
    this.map.clearOccupied(tower.id);
    tower.coord = this.cleanCoord(coord);
    tower.footprint = footprint;
    this.map.setOccupied(footprint, tower.id);
    this.lastEvents.push({ type: "towerMoved", towerId, from, to: this.cleanCoord(coord), cost: this.cloneResources(moveTowerCost) });
    this.finishScriptedAction();
    return { ok: true };
  }

  canUpgradeTower(towerId: string): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) {
      return this.fail("No tower selected.", "reason.noTowerSelected");
    }

    const cost = this.getTowerUpgradeCost(tower);
    if (!cost) {
      return this.fail("Cluster is already full.", "reason.clusterFull");
    }

    if (!this.hasResources(cost)) {
      return this.fail(`Need ${this.formatCost(cost)}.`, "reason.needCost", this.costReasonParams(cost));
    }

    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }

    return { ok: true };
  }

  getTowerUpgradeCost(towerOrId: TowerState | string): ResourceCost | null {
    const tower = typeof towerOrId === "string" ? this.towers.find((item) => item.id === towerOrId) : towerOrId;
    if (!tower) {
      return null;
    }

    const type = this.towerTypes[tower.typeId];
    if (!type) {
      return null;
    }
    const attack = type.attack;
    if (attack.kind === "single") {
      return tower.stacks >= attack.maxStacks ? null : { coins: attack.upgradeCost };
    }

    const costs = "upgradeCosts" in attack ? attack.upgradeCosts : undefined;
    if (!costs) {
      return null;
    }
    return costs[tower.level - 1] ?? null;
  }

  upgradeTower(towerId: string): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) {
      return this.fail("No tower selected.", "reason.noTowerSelected");
    }

    const check = this.canUpgradeTower(towerId);
    if (!check.ok) {
      return check;
    }

    const cost = this.getTowerUpgradeCost(tower);
    if (!cost) {
      return this.fail("Cluster is already full.", "reason.clusterFull");
    }

    const type = this.towerTypes[tower.typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }
    this.spendResources(cost);
    this.addToBag(tower.investedResources, cost);
    if (type.attack.kind === "single") {
      tower.stacks += 1;
    } else {
      tower.level += 1;
    }
    this.lastEvents.push({ type: "towerUpgraded", towerId, level: tower.level, stacks: tower.stacks });
    this.finishScriptedAction();
    return { ok: true };
  }

  getTowerSellRefund(towerOrId: TowerState | string): ResourceBag | null {
    const tower = typeof towerOrId === "string" ? this.towers.find((item) => item.id === towerOrId) : towerOrId;
    if (!tower) return null;
    const ratio = this.mission.economy?.sellRefundRatio ?? 0.7;
    const refund = this.cloneResources({});
    for (const currencyId of this.currencyIds) {
      const invested = Number(tower.investedResources?.[currencyId]) || 0;
      refund[currencyId] = Math.floor(invested * ratio * 100 + 1e-9) / 100;
    }
    return refund;
  }

  canSellTower(towerId: string): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) return this.fail("No tower selected.", "reason.noTowerSelected");
    if (this.outcome !== "playing") return this.fail("Mission already ended.", "reason.missionEnded");
    if (!this.dependentsKeepSupportAfterRemoval(towerId)) {
      return this.fail("Dependent towers still need this support aura.", "reason.dependentsLoseAura");
    }
    return { ok: true };
  }

  sellTower(towerId: string): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) return this.fail("No tower selected.", "reason.noTowerSelected");
    const check = this.canSellTower(towerId);
    if (!check.ok) return check;
    const refund = this.getTowerSellRefund(tower) ?? this.cloneResources({});
    this.addResources(refund);
    this.destroyTower(towerId);
    this.lastEvents.push({ type: "towerSold", towerId, towerTypeId: tower.typeId, refund });
    this.finishScriptedAction();
    return { ok: true };
  }

  setTowerTargetMode(towerId: string, mode: TowerTargetMode): ActionResult {
    const tower = this.towers.find((item) => item.id === towerId);
    if (!tower) {
      return this.fail("No tower selected.", "reason.noTowerSelected");
    }

    if (!this.towerSupportsTargetMode(tower)) {
      return this.fail("This tower has no selectable target mode.", "reason.targetModeUnsupported");
    }
    if (!(TOWER_TARGET_MODES as readonly string[]).includes(mode)) {
      return this.fail("Unknown target mode.", "reason.targetModeUnknown", { mode });
    }

    tower.targetMode = mode;
    this.lastEvents.push({ type: "towerTargetModeChanged", towerId, mode });
    this.finishScriptedAction();
    return { ok: true };
  }

  usePathWaterAbility(center: HexCoord): ActionResult {
    const ability = this.mission.abilities?.find((item) => item.id === "path_water");
    if (!ability) {
      return this.fail("Water spill is not available in this mission.", "reason.abilityUnavailable");
    }

    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }

    const remaining = this.abilityCooldowns.path_water ?? 0;
    if (remaining > 0) {
      return this.fail("Water spill is still recharging.", "reason.abilityCooldown", { seconds: Math.ceil(remaining) });
    }

    const targetTile = this.map.getTile(center);
    if (!targetTile || targetTile.terrain !== "path") {
      return this.fail("Water can only be poured onto the path.", "reason.abilityPathOnly");
    }

    const effectCoords = this.map
      .allPathCoords()
      .filter((coord) => hexDistance(coord, center) <= ability.radius)
      .filter((coord) => this.map.getTile(coord)?.terrain === "path");
    if (effectCoords.length === 0) {
      return this.fail("Water can only be poured onto the path.", "reason.abilityPathOnly");
    }

    const activeByKey = new Map(this.temporaryWaterTiles.map((tile) => [coordKey(tile), tile]));
    for (const coord of effectCoords) {
      const key = coordKey(coord);
      const existing = activeByKey.get(key);
      if (existing) {
        existing.expiresIn = Math.max(existing.expiresIn, ability.duration);
      } else {
        const tile = { q: coord.q, r: coord.r, expiresIn: ability.duration };
        activeByKey.set(key, tile);
        this.temporaryWaterTiles.push(tile);
      }
    }

    this.abilityCooldowns.path_water = ability.cooldown;
    this.lastEvents.push({
      type: "waterAbilityUsed",
      abilityId: ability.id,
      center: { ...center },
      coords: effectCoords.map((coord) => ({ ...coord })),
      duration: ability.duration
    });
    this.finishScriptedAction();
    return { ok: true };
  }

  /**
   * The `strike`/`freeze` engine presets, expressed as the same composable effects a custom
   * ability declares via `MissionAbilityDefinition.effects`. Returns undefined for any other id
   * (including `path_water`, which stays on its own bespoke tile-targeting handler below — its
   * validation/failure modes are tile-specific, not enemy-targeted).
   */
  private builtinAbilityEffects(abilityId: MissionAbilityId, ability: MissionAbilityDefinition): AbilityEffect[] | undefined {
    if (abilityId === "strike") {
      return [{ kind: "damage", amount: Math.max(0, ability.damage ?? 0) }];
    }
    if (abilityId === "freeze") {
      return [{ kind: "status", status: { stun: ability.stunDuration ?? ability.duration } }];
    }
    return undefined;
  }

  private applyAbilityEffect(enemy: EnemyState, effect: AbilityEffect): void {
    if (effect.kind === "damage") {
      enemy.hp -= Math.max(0, effect.amount); // reward/removal handled by the next removeDeadEnemies() pass
    } else if (effect.kind === "status") {
      this.applyStatusEffect(enemy, effect.status);
    }
  }

  /**
   * Trigger a mission ability at a target coord. `path_water` routes to its own handler (a
   * tile effect, not enemy-targeted). Every other ability — `strike`/`freeze` presets or a
   * custom author-declared one — resolves to an `effects[]` composition applied to every enemy
   * within `radius` of `center`, via the shared applyAbilityEffect primitive. A custom ability
   * needs no engine code: declare `effects` on it and it just works.
   */
  useAbility(abilityId: MissionAbilityId, center: HexCoord): ActionResult {
    if (abilityId === "path_water") {
      return this.usePathWaterAbility(center);
    }
    const ability = this.mission.abilities?.find((item) => item.id === abilityId);
    if (!ability) {
      return this.fail("This ability is not available in this mission.", "reason.abilityUnavailable");
    }
    if (this.outcome !== "playing") {
      return this.fail("Mission already ended.", "reason.missionEnded");
    }
    const remaining = this.abilityCooldowns[abilityId] ?? 0;
    if (remaining > 0) {
      return this.fail("Ability is still recharging.", "reason.abilityCooldown", { seconds: Math.ceil(remaining) });
    }

    const effects = ability.effects ?? this.builtinAbilityEffects(abilityId, ability);
    if (!effects || effects.length === 0) {
      return this.fail("Unknown ability.", "reason.abilityUnavailable");
    }

    const targets = this.enemies.filter((enemy) => enemy.hp > 0 && hexDistance(this.enemyCoord(enemy), center) <= ability.radius);
    const enemyIds: string[] = [];
    for (const enemy of targets) {
      for (const effect of effects) {
        this.applyAbilityEffect(enemy, effect);
      }
      enemyIds.push(enemy.id);
    }
    this.abilityCooldowns[abilityId] = ability.cooldown;
    this.lastEvents.push({ type: "abilityUsed", abilityId, center: { ...center }, enemyIds, effects });
    this.finishScriptedAction();
    return { ok: true };
  }

  /**
   * Dispatch an author-defined event into TowerScript. This is the only custom event bridge:
   * callers provide JSON data, while scripts still receive no executable host capability.
   */
  emitScriptSignal(signal: string, payload: TowerScriptJson = null): ActionResult {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(signal)) {
      return this.fail("Script signal must be a safe identifier.", "reason.invalidScriptSignal");
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      return this.fail("Script signal payload must be JSON-compatible.", "reason.invalidScriptPayload");
    }
    if (serialized === undefined || serialized.length > TOWER_SCRIPT_LIMITS.externalSignalPayloadBytes) {
      return this.fail("Script signal payload exceeds 64 KiB.", "reason.invalidScriptPayload");
    }
    const safePayload = JSON.parse(serialized) as TowerScriptJson;
    this.beginScriptTransaction();
    this.lastEvents.push({ type: "scriptSignal", scriptId: "external", signal, payload: safePayload });
    this.runScriptEvent("signal", { type: "signal", signal, payload: safePayload, sourceScriptId: "external" });
    this.processScriptEvents();
    return { ok: true };
  }

  getTowerIdAt(coord: HexCoord): string | undefined {
    return this.map.occupiedTowerAt(coord);
  }

  tick(deltaUnits: number): void {
    this.lastEvents = [];
    this.scriptEventCursor = 0;
    this.beginScriptTransaction();

    if (this.outcome !== "playing") {
      return;
    }

    const delta = Math.max(0, Math.min(deltaUnits, 0.2));
    this.updateAbilities(delta);
    this.updateEnemyStatuses(delta);

    if (this.startedWaveCount > 0) {
      this.missionElapsed += delta;
      this.applyPassiveIncome(delta);
      this.startScheduledWaves();
      this.spawnDueEnemies();
      this.syncPrepRemaining();
    }

    this.moveEnemies(delta);
    this.applySunlightRegeneration(delta);
    this.applyHealAuras(delta);
    this.applyDotDamage(delta);
    this.updateTowerDisruptions(delta);
    this.updateEnemyTowerAttacks(delta);
    this.updateTowers(delta);
    this.triggerEnemyPhaseSpawns();
    this.removeDeadEnemies();
    this.processScriptEvents();
    if (this.outcome === "playing") this.runScriptEvent("tick", { type: "tick", delta });
    this.removeDeadEnemies();
    this.processScriptEvents();
    this.resolveWaveState();
    this.processScriptEvents();
  }

  getSnapshot(): GameSnapshot {
    return this.buildSnapshot(true);
  }

  getRenderSnapshot(): GameSnapshot {
    return this.buildSnapshot(false);
  }

  private buildSnapshot(copyStaticState: boolean): GameSnapshot {
    return {
      missionId: this.mission.id,
      missionLabel: this.mission.label,
      difficultyId: this.difficulty.id,
      difficultyLabel: this.difficulty.label,
      coreHp: this.coreHp,
      maxCoreHp: this.maxCoreHp,
      coins: this.coins,
      resources: this.cloneResources(this.resources),
      waveIndex: this.waveIndex,
      totalWaves: this.mission.waves.length,
      startedWaveCount: this.startedWaveCount,
      clearedWaveCount: this.clearedWaveCount,
      killCount: this.killCount,
      leakCount: this.leakCount,
      killCountByEnemyType: { ...this.killCountByEnemyType },
      objectiveProgress: this.buildObjectiveProgress(),
      stars: this.buildStarSnapshot(),
      missionElapsed: this.missionElapsed,
      waveState: this.waveState,
      prepRemaining: this.prepRemaining,
      nextWaveRemaining: this.getNextWaveRemaining(),
      nextWaveDelayUnits: this.mission.prepTimeUnits,
      enemies: this.enemies.map((enemy) => ({
        ...enemy,
        routeId: enemy.routeId,
        phaseSpawnsTriggered: enemy.phaseSpawnsTriggered ? [...enemy.phaseSpawnsTriggered] : undefined,
        statuses: enemy.statuses
          ? {
              ...(enemy.statuses.slow ? { slow: { ...enemy.statuses.slow } } : {}),
              ...(enemy.statuses.stun ? { stun: { ...enemy.statuses.stun } } : {}),
              ...(enemy.statuses.poison ? { poison: { ...enemy.statuses.poison } } : {})
            }
          : {}
      })),
      towers: this.towers.map((tower) => ({
        ...tower,
        coord: { ...tower.coord },
        footprint: tower.footprint.map((coord) => ({ ...coord }))
      })),
      tiles: copyStaticState ? [...this.map.tiles.values()].map((tile) => ({ ...tile })) : this.staticTilesSnapshot,
      abilities: this.buildAbilitySnapshot(),
      temporaryWaterTiles: this.temporaryWaterTiles.map((tile) => ({ ...tile })),
      sunlightTiles: copyStaticState
        ? this.sunlightTilesSnapshot.map((tile) => ({ ...tile }))
        : this.sunlightTilesSnapshot,
      pathCenterline: copyStaticState
        ? this.map.pathCenterline.map((coord) => ({ ...coord }))
        : this.staticPathCenterlineSnapshot,
      pathRoutes: copyStaticState
        ? this.map.pathRoutes.map((route) => ({
            id: route.id,
            pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
          }))
        : this.staticPathRoutesSnapshot,
      spawnCoord: copyStaticState ? { ...this.map.spawnCoord } : this.staticSpawnCoordSnapshot,
      coreCoord: copyStaticState ? { ...this.map.coreCoord } : this.staticCoreCoordSnapshot,
      outcome: this.outcome,
      scriptState: {
        values: this.cloneScriptValues(),
        diagnostics: this.scriptDiagnostics.map((diagnostic) => ({ ...diagnostic }))
      },
      lastEvents: [...this.lastEvents]
    };
  }

  private initializeScripts(): void {
    this.scriptValues = {};
    this.scriptDiagnostics = [];
    this.scriptHandlerLastRun = {};
    this.scriptEventCursor = 0;
    this.scriptActionsRemaining = 0;
    this.scriptSignalDepth = 0;
    for (const scriptId of Object.keys(this.content.scripts ?? {}).sort()) this.scriptValues[scriptId] = {};
  }

  private beginScriptTransaction(): void {
    this.scriptActionsRemaining = TOWER_SCRIPT_LIMITS.actionsPerTransaction;
    this.scriptSignalDepth = 0;
  }

  private finishScriptedAction(): void {
    this.beginScriptTransaction();
    this.processScriptEvents();
  }

  private processScriptEvents(): void {
    let processed = 0;
    while (this.scriptEventCursor < this.lastEvents.length && processed < TOWER_SCRIPT_LIMITS.eventsPerTransaction) {
      const event = this.lastEvents[this.scriptEventCursor++];
      processed += 1;
      if (!event || event.type === "scriptDiagnostic" || event.type === "scriptSignal") continue;
      if (SCRIPT_GAME_EVENT_NAMES.has(event.type as TowerScriptEventName)) {
        this.runScriptEvent(event.type as TowerScriptEventName, event as unknown as Record<string, unknown>);
      }
    }
    if (this.scriptEventCursor < this.lastEvents.length) {
      this.recordScriptDiagnostic({
        scriptId: "runtime",
        event: "tick",
        code: "budget_exceeded",
        message: `TowerScript event processing exceeded ${TOWER_SCRIPT_LIMITS.eventsPerTransaction} events in one transaction.`
      });
      this.scriptEventCursor = this.lastEvents.length;
    }
  }

  private runScriptEvent(eventName: TowerScriptEventName, event: Record<string, unknown>): void {
    for (const script of Object.values(this.content.scripts ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!script || script.enabled === false) continue;
      const handlers = script.handlers?.[eventName] ?? [];
      if (!Array.isArray(handlers) || handlers.length === 0) continue;
      const seenContexts = new Set<string>();
      for (const binding of script.bindings ?? []) {
        for (const self of this.scriptContexts(binding, eventName, event)) {
          const contextIdentity = `${self.scope}:${self.id}`;
          if (seenContexts.has(contextIdentity)) continue;
          seenContexts.add(contextIdentity);
          const stateKey = contextIdentity;
          const context: TowerScriptExecutionContext = {
            script,
            binding,
            self,
            state: this.scriptStateFor(script, stateKey),
            stateKey,
            event,
            eventName
          };
          handlers.forEach((handler, index) => this.runScriptHandler(context, handler, index));
        }
      }
    }
  }

  private runScriptHandler(context: TowerScriptExecutionContext, handler: TowerScriptHandler, handlerIndex: number): void {
    const handlerId = handler.id ?? String(handlerIndex);
    try {
      if (context.eventName === "tick" && typeof handler.every === "number") {
        const timerKey = `${context.script.id}:${context.stateKey}:${handlerId}`;
        const lastRun = this.scriptHandlerLastRun[timerKey];
        if (lastRun !== undefined && this.missionElapsed - lastRun + 0.000001 < handler.every) return;
        this.scriptHandlerLastRun[timerKey] = this.missionElapsed;
      }
      const expressionBudget = { remaining: TOWER_SCRIPT_LIMITS.expressionOperationsPerHandler };
      const root = this.scriptExpressionContext(context);
      if (handler.when !== undefined && !evaluateTowerScriptExpression(handler.when, root, expressionBudget)) return;
      for (const action of handler.actions ?? []) {
        this.scriptActionsRemaining -= 1;
        if (this.scriptActionsRemaining < 0) throw new Error("TowerScript action budget exceeded.");
        this.applyScriptAction(action, context, root, expressionBudget);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordScriptDiagnostic({
        scriptId: context.script.id,
        handlerId,
        event: context.eventName,
        code: /budget exceeded/i.test(message) ? "budget_exceeded" : /expression|\$get|\$op|context path/i.test(message) ? "invalid_expression" : "runtime_error",
        message
      });
    }
  }

  private scriptContexts(binding: TowerScriptBinding, eventName: TowerScriptEventName, event: Record<string, unknown>): TowerScriptSelfContext[] {
    const accepts = (id: string) => !binding.ids || binding.ids.includes(id);
    if (binding.scope === "global") return [{ scope: "global", id: "global", value: { id: "global" } }];
    if (binding.scope === "mission") {
      return accepts(this.mission.id)
        ? [{
            scope: "mission",
            id: this.mission.id,
            value: {
              id: this.mission.id,
              label: this.mission.label,
              mapId: this.mission.mapId,
              waveSetId: this.mission.waveSetId,
              startingResources: { ...this.mission.startingResources },
              waveCount: this.mission.waves.length
            }
          }]
        : [];
    }
    if (binding.scope === "map") {
      return accepts(this.mission.mapId)
        ? [{
            scope: "map",
            id: this.mission.mapId,
            value: {
              id: this.mission.mapId,
              width: this.map.width,
              height: this.map.height,
              spawnCoord: { ...this.map.spawnCoord },
              coreCoord: { ...this.map.coreCoord },
              pathLength: this.map.pathCenterline.length,
              routeIds: this.map.pathRoutes.map((route) => route.id)
            }
          }]
        : [];
    }
    if (binding.scope === "wave") {
      return accepts(this.mission.waveSetId)
        ? [{
            scope: "wave",
            id: this.mission.waveSetId,
            value: {
              id: this.mission.waveSetId,
              currentIndex: this.waveIndex,
              startedCount: this.startedWaveCount,
              clearedCount: this.clearedWaveCount,
              state: this.waveState,
              totalCount: this.mission.waves.length
            }
          }]
        : [];
    }
    if (binding.scope === "ability") {
      const abilityId = typeof event.abilityId === "string" ? event.abilityId : null;
      if (!abilityId || !accepts(abilityId)) return [];
      return [{ scope: "ability", id: abilityId, typeId: abilityId, value: { id: abilityId, ...(this.content.abilities[abilityId] ?? {}) } as Record<string, unknown> }];
    }
    if (binding.scope === "tower") {
      const candidates: TowerScriptSelfContext[] = [];
      if (eventName === "tick") {
        for (const tower of this.towers) if (accepts(tower.typeId)) candidates.push({ scope: "tower", id: tower.id, typeId: tower.typeId, value: tower as unknown as Record<string, unknown> });
        return candidates;
      }
      const towerIds = [event.towerId, ...(Array.isArray(event.towerIds) ? event.towerIds : [])].filter((value): value is string => typeof value === "string");
      for (const towerId of towerIds) {
        const tower = this.towers.find((item) => item.id === towerId);
        const typeId = tower?.typeId ?? (typeof event.towerTypeId === "string" ? event.towerTypeId : undefined);
        if (typeId && accepts(typeId)) candidates.push({ scope: "tower", id: towerId, typeId, value: tower ? tower as unknown as Record<string, unknown> : { id: towerId, typeId } });
      }
      return candidates;
    }
    if (binding.scope === "enemy") {
      const candidates: TowerScriptSelfContext[] = [];
      if (eventName === "tick") {
        for (const enemy of this.enemies) if (accepts(enemy.typeId)) candidates.push({ scope: "enemy", id: enemy.id, typeId: enemy.typeId, value: enemy as unknown as Record<string, unknown> });
        return candidates;
      }
      const enemyIds = [
        event.enemyId,
        event.targetEnemyId,
        ...(Array.isArray(event.enemyIds) ? event.enemyIds : [])
      ].filter((value): value is string => typeof value === "string");
      for (const enemyId of enemyIds) {
        const enemy = this.enemies.find((item) => item.id === enemyId);
        const typeId = enemy?.typeId ?? (typeof event.enemyTypeId === "string" ? event.enemyTypeId : undefined);
        if (typeId && accepts(typeId)) candidates.push({ scope: "enemy", id: enemyId, typeId, value: enemy ? enemy as unknown as Record<string, unknown> : { id: enemyId, typeId } });
      }
      return candidates;
    }
    return [];
  }

  private scriptStateFor(script: TowerScriptDefinition, stateKey: string): Record<string, TowerScriptJson> {
    const scriptStates = this.scriptValues[script.id] ??= {};
    return scriptStates[stateKey] ??= this.cloneScriptJsonObject(script.initialState ?? {});
  }

  private scriptExpressionContext(context: TowerScriptExecutionContext): Record<string, unknown> {
    return {
      event: context.event,
      self: context.self.value,
      state: context.state,
      game: {
        missionId: this.mission.id,
        mapId: this.mission.mapId,
        difficultyId: this.difficulty.id,
        elapsed: this.missionElapsed,
        waveIndex: this.waveIndex,
        startedWaveCount: this.startedWaveCount,
        clearedWaveCount: this.clearedWaveCount,
        killCount: this.killCount,
        leakCount: this.leakCount,
        coreHp: this.coreHp,
        maxCoreHp: this.maxCoreHp,
        resources: this.resources,
        enemyCount: this.enemies.length,
        towerCount: this.towers.length,
        outcome: this.outcome
      }
    };
  }

  private applyScriptAction(
    action: TowerScriptAction,
    context: TowerScriptExecutionContext,
    root: Record<string, unknown>,
    budget: { remaining: number }
  ): void {
    const evaluate = (expression: Parameters<typeof evaluateTowerScriptExpression>[0]) => evaluateTowerScriptExpression(expression, root, budget);
    const numberValue = (expression: Parameters<typeof evaluateTowerScriptExpression>[0], fallback = 0) => {
      const value = evaluate(expression);
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };
    if (action.action === "grantResource") {
      if (!this.currencyIds.includes(action.resourceId)) throw new Error(`Unknown runtime currency "${action.resourceId}".`);
      const amount = numberValue(action.amount);
      this.resources[action.resourceId] = Math.max(0, Math.min(1e12, (this.resources[action.resourceId] ?? 0) + amount));
      return;
    }
    if (action.action === "damageCore") {
      this.coreHp = Math.max(0, this.coreHp - Math.max(0, numberValue(action.amount)));
      if (this.coreHp <= 0 && this.outcome === "playing") {
        this.outcome = "defeat";
        this.lastEvents.push({ type: "defeat" });
      }
      return;
    }
    if (action.action === "healCore") {
      this.coreHp = Math.min(this.maxCoreHp, this.coreHp + Math.max(0, numberValue(action.amount)));
      return;
    }
    if (action.action === "damageEnemy" || action.action === "healEnemy") {
      const amount = Math.max(0, numberValue(action.amount));
      for (const enemy of this.resolveScriptEnemies(action.target, context)) {
        enemy.hp = action.action === "damageEnemy" ? enemy.hp - amount : Math.min(enemy.maxHp, enemy.hp + amount);
      }
      return;
    }
    if (action.action === "applyStatus") {
      for (const enemy of this.resolveScriptEnemies(action.target, context)) this.applyStatusEffect(enemy, action.status);
      return;
    }
    if (action.action === "setTowerCooldown") {
      const value = Math.max(0, numberValue(action.value));
      for (const tower of this.resolveScriptTowers(action.target, context)) tower.cooldown = value;
      return;
    }
    if (action.action === "addTowerStacks") {
      const amount = Math.trunc(numberValue(action.amount));
      for (const tower of this.resolveScriptTowers(action.target, context)) tower.stacks = Math.max(0, Math.min(999, tower.stacks + amount));
      return;
    }
    if (action.action === "spawnEnemy") {
      const count = Math.max(0, Math.min(TOWER_SCRIPT_LIMITS.spawnedEnemiesPerAction, Math.trunc(action.count === undefined ? 1 : numberValue(action.count, 1))));
      const progress = Math.max(0, numberValue(action.pathProgress ?? 0));
      for (let index = 0; index < count; index += 1) {
        const enemy = this.createEnemyState(action.enemyTypeId, progress, 0, action.routeId);
        if (!enemy) throw new Error(`Unknown enemy type "${action.enemyTypeId}".`);
        this.enemies.push(enemy);
      }
      return;
    }
    if (action.action === "setState") {
      context.state[action.key] = evaluate(action.value);
      this.assertScriptStateSize(context);
      return;
    }
    if (action.action === "incrementState") {
      const current = typeof context.state[action.key] === "number" ? context.state[action.key] as number : 0;
      const next = current + (action.amount === undefined ? 1 : numberValue(action.amount, 1));
      context.state[action.key] = Number.isFinite(next) ? Math.max(-1e12, Math.min(1e12, next)) : 0;
      this.assertScriptStateSize(context);
      return;
    }
    if (action.action === "emitSignal") {
      if (this.scriptSignalDepth >= TOWER_SCRIPT_LIMITS.signalRecursionDepth) throw new Error("TowerScript signal recursion budget exceeded.");
      const payload = action.payload === undefined ? null : evaluate(action.payload);
      this.lastEvents.push({ type: "scriptSignal", scriptId: context.script.id, signal: action.signal, payload });
      this.scriptSignalDepth += 1;
      this.runScriptEvent("signal", { type: "signal", signal: action.signal, payload, sourceScriptId: context.script.id });
      this.scriptSignalDepth -= 1;
    }
  }

  private resolveScriptEnemies(target: TowerScriptEntityTarget, context: TowerScriptExecutionContext): EnemyState[] {
    if (target === "allEnemies") return this.enemies.filter((enemy) => enemy.hp > 0);
    const id = target === "self" && context.self.scope === "enemy"
      ? context.self.id
      : target === "eventEnemy" && typeof context.event.enemyId === "string" ? context.event.enemyId : null;
    const enemy = id ? this.enemies.find((item) => item.id === id && item.hp > 0) : undefined;
    return enemy ? [enemy] : [];
  }

  private resolveScriptTowers(target: TowerScriptEntityTarget, context: TowerScriptExecutionContext): TowerState[] {
    if (target === "allTowers") return [...this.towers];
    const id = target === "self" && context.self.scope === "tower"
      ? context.self.id
      : target === "eventTower" && typeof context.event.towerId === "string" ? context.event.towerId : null;
    const tower = id ? this.towers.find((item) => item.id === id) : undefined;
    return tower ? [tower] : [];
  }

  private assertScriptStateSize(context: TowerScriptExecutionContext): void {
    if (JSON.stringify(context.state).length > TOWER_SCRIPT_LIMITS.stateBytesPerBinding) throw new Error(`TowerScript state for ${context.stateKey} exceeds 64 KiB.`);
  }

  private recordScriptDiagnostic(diagnostic: TowerScriptDiagnostic): void {
    this.scriptDiagnostics.push(diagnostic);
    if (this.scriptDiagnostics.length > TOWER_SCRIPT_LIMITS.retainedDiagnostics) this.scriptDiagnostics.shift();
    this.lastEvents.push({ type: "scriptDiagnostic", diagnostic });
  }

  private cloneScriptJsonObject(value: Record<string, TowerScriptJson>): Record<string, TowerScriptJson> {
    return JSON.parse(JSON.stringify(value)) as Record<string, TowerScriptJson>;
  }

  private cloneScriptValues(): Record<string, Record<string, Record<string, TowerScriptJson>>> {
    return JSON.parse(JSON.stringify(this.scriptValues)) as Record<string, Record<string, Record<string, TowerScriptJson>>>;
  }

  enemyCoord(enemy: EnemyState): HexCoord {
    const track = this.enemyTrack(enemy);
    const index = Math.min(Math.round(enemy.pathProgress), track.length - 1);
    return track[index] ?? { q: 0, r: 0 };
  }

  private startWave(waveIndex: number, startedAt: number, earlyStartUnits = 0): ActionResult {
    const wave = this.mission.waves[waveIndex];
    if (!wave) {
      return this.fail("No waves left.", "reason.noWaves");
    }

    this.waveIndex = waveIndex;
    this.startedWaveCount = Math.max(this.startedWaveCount, waveIndex + 1);
    this.waveState = "spawning";
    this.spawnQueue.push(...this.buildSpawnQueue(wave, startedAt));
    this.spawnQueue.sort((a, b) => a.at - b.at);
    this.nextWaveStartAt =
      this.startedWaveCount < this.mission.waves.length ? startedAt + this.mission.prepTimeUnits : null;
    this.syncPrepRemaining();
    const waveStartIncome = this.normalizeCost(this.mission.economy?.perWaveStart ?? {});
    if (this.bagHasValue(waveStartIncome)) {
      this.addResources(waveStartIncome);
      this.lastEvents.push({ type: "resourcesGranted", source: "waveStart", waveIndex, resources: waveStartIncome });
    }
    if (earlyStartUnits > 0) {
      const bonus = this.scaleBag(this.mission.economy?.earlyStartBonusPerUnit ?? {}, earlyStartUnits);
      if (this.bagHasValue(bonus)) {
        this.addResources(bonus);
        this.lastEvents.push({ type: "resourcesGranted", source: "earlyStart", waveIndex, resources: bonus });
      }
    }
    this.lastEvents.push({ type: "waveStarted", waveIndex });
    return { ok: true };
  }

  private startScheduledWaves(): void {
    while (
      this.nextWaveStartAt !== null &&
      this.startedWaveCount < this.mission.waves.length &&
      this.missionElapsed + 0.0001 >= this.nextWaveStartAt
    ) {
      const scheduledAt = this.nextWaveStartAt;
      this.startWave(this.startedWaveCount, scheduledAt);
    }
  }

  private buildSpawnQueue(wave = this.mission.waves[this.waveIndex], baseAt = 0): SpawnItem[] {
    const queue: SpawnItem[] = [];
    if (!wave) {
      return queue;
    }

    for (const group of wave.groups) {
      for (let i = 0; i < group.count; i += 1) {
        queue.push({
          at: baseAt + group.startDelay + i * group.spawnInterval,
          enemyId: group.enemyId,
          routeId: group.routeId
        });
      }
    }

    return queue.sort((a, b) => a.at - b.at);
  }

  private spawnDueEnemies(): void {
    let consumed = 0;
    while (consumed < this.spawnQueue.length && (this.spawnQueue[consumed]?.at ?? Infinity) <= this.missionElapsed + 0.0001) {
      const item = this.spawnQueue[consumed];
      if (item) {
        const enemy = this.createEnemyState(item.enemyId, 0, 0, item.routeId);
        if (enemy) {
          this.enemies.push(enemy);
        }
      }
      consumed += 1;
    }

    if (consumed > 0) {
      this.spawnQueue.splice(0, consumed);
    }
  }

  private createEnemyState(typeId: string, pathProgress: number, pathOffset: number, routeId?: string): EnemyState | null {
    const type = this.enemyTypes[typeId];
    if (!type) {
      return null;
    }

    const resolvedRouteId = this.enemyTargetClassByType(typeId) === "ground" ? this.resolveRouteId(routeId) : undefined;
    const trackEnd = Math.max(0, this.enemyTrackForType(typeId, resolvedRouteId).length - 1);
    return {
      id: `enemy_${++this.enemyCounter}`,
      typeId,
      hp: type.maxHp * (this.difficulty.enemyHpMultiplier ?? 1),
      maxHp: type.maxHp * (this.difficulty.enemyHpMultiplier ?? 1),
      pathProgress: Math.max(0, Math.min(pathProgress, Math.max(0, trackEnd - 0.001))),
      dotRemaining: 0,
      pathOffset,
      routeId: resolvedRouteId,
      phaseSpawnsTriggered: type.phaseSpawns?.length ? [] : undefined,
      statuses: {}
    };
  }

  private updateAbilities(delta: number): void {
    for (const ability of this.mission.abilities ?? []) {
      const remaining = this.abilityCooldowns[ability.id] ?? 0;
      this.abilityCooldowns[ability.id] = Math.max(0, remaining - delta);
    }

    let writeIndex = 0;
    for (const tile of this.temporaryWaterTiles) {
      tile.expiresIn = Math.max(0, tile.expiresIn - delta);
      if (tile.expiresIn > 0) {
        this.temporaryWaterTiles[writeIndex] = tile;
        writeIndex += 1;
      }
    }
    this.temporaryWaterTiles.length = writeIndex;
  }

  private updateEnemyStatuses(delta: number): void {
    for (const enemy of this.enemies) {
      const statuses = enemy.statuses;
      if (!statuses) {
        continue;
      }
      if (statuses.slow) {
        statuses.slow.remaining = Math.max(0, statuses.slow.remaining - delta);
        if (statuses.slow.remaining <= 0) delete statuses.slow;
      }
      if (statuses.stun) {
        statuses.stun.remaining = Math.max(0, statuses.stun.remaining - delta);
        if (statuses.stun.remaining <= 0) delete statuses.stun;
      }
      if (statuses.poison) {
        // Damage-over-time; death + reward is handled by the later removeDeadEnemies() pass.
        if (enemy.hp > 0) enemy.hp -= statuses.poison.dps * delta;
        statuses.poison.remaining = Math.max(0, statuses.poison.remaining - delta);
        if (statuses.poison.remaining <= 0) delete statuses.poison;
      }
    }
  }

  private buildAbilitySnapshot(): GameSnapshot["abilities"] {
    const abilities: GameSnapshot["abilities"] = {};
    for (const ability of this.mission.abilities ?? []) {
      const cooldownRemaining = Math.max(0, this.abilityCooldowns[ability.id] ?? 0);
      abilities[ability.id] = {
        id: ability.id,
        label: ability.label,
        cooldown: ability.cooldown,
        cooldownRemaining,
        duration: ability.duration,
        radius: ability.radius,
        ready: cooldownRemaining <= 0 && this.outcome === "playing"
      };
    }
    return abilities;
  }

  private buildSunlightTilesSnapshot(): SunlightTile[] {
    const sunlight = this.mission.sunlight;
    if (!sunlight) {
      return [];
    }

    const tiles: SunlightTile[] = [];
    for (const pathOrder of sunlight.pathOrders ?? []) {
      const coord = this.map.pathCenterline[pathOrder];
      if (coord) {
        tiles.push({ ...coord, pathOrder, routeId: this.defaultRouteId() });
      }
    }
    for (const tile of sunlight.pathTiles ?? []) {
      const route = this.map.pathRouteById(tile.routeId);
      const coord = route?.pathCenterline[tile.pathOrder];
      if (coord && route) {
        tiles.push({ ...coord, pathOrder: tile.pathOrder, routeId: route.id });
      }
    }
    return tiles.sort((a, b) => {
      const route = (a.routeId ?? "").localeCompare(b.routeId ?? "");
      return route || a.pathOrder - b.pathOrder;
    });
  }

  private moveEnemies(delta: number): void {
    for (const enemy of this.enemies) {
      // An enemy killed between ticks (by an ability) or earlier this tick is pending removal by
      // removeDeadEnemies() — it must not keep advancing, or it can reach the core and "leak"
      // (deal core damage + forfeit its kill reward) despite already being dead.
      if (enemy.hp <= 0) {
        continue;
      }
      const type = this.enemyTypes[enemy.typeId];
      if (!type) {
        continue;
      }
      const trackEnd = this.enemyTrack(enemy).length - 1;
      const desiredOffset = this.enemyTargetClass(enemy) === "ground" ? this.enemyAvoidanceOffset(enemy) : 0;
      enemy.pathOffset += (desiredOffset - enemy.pathOffset) * Math.min(1, delta * 6);
      const avoidanceSpeedFactor = Math.abs(desiredOffset) > 0.05 ? 0.82 : 1;
      const terrainSpeedFactor = this.enemyTerrainSpeedFactor(enemy);
      const statusSpeedFactor = this.enemyStatusSpeedFactor(enemy);
      enemy.pathProgress += type.speed * (this.difficulty.enemySpeedMultiplier ?? 1) * avoidanceSpeedFactor * terrainSpeedFactor * statusSpeedFactor * delta;

      if (enemy.pathProgress >= trackEnd) {
        enemy.hp = 0;
        const coreDamage = type.coreDamage * (this.difficulty.coreDamageMultiplier ?? 1);
        this.coreHp = Math.max(0, this.coreHp - coreDamage);
        this.lastEvents.push({
          type: "enemyLeaked",
          enemyId: enemy.id,
          enemyTypeId: enemy.typeId,
          damage: coreDamage
        });
        this.leakCount += 1;

        if (this.coreHp <= 0 && this.outcome === "playing") {
          this.outcome = "defeat";
          this.lastEvents.push({ type: "defeat" });
        }
      }
    }
  }

  private applyDotDamage(delta: number): void {
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || enemy.dotRemaining <= 0) {
        continue;
      }

      if (this.isInsideAnyPulse(enemy)) {
        continue;
      }

      enemy.dotRemaining = Math.max(0, enemy.dotRemaining - delta);
      const sourceTowerTypeId = enemy.dotSourceTowerTypeId ?? this.firstPulseTowerTypeId();
      const damagePerUnit = enemy.dotDamagePerUnit ?? this.pulseDotDamagePerUnit(sourceTowerTypeId);
      const baseDamage = Math.max(0, damagePerUnit) * delta;
      enemy.hp -= this.resolveEffectiveTowerDamage(sourceTowerTypeId ?? "", enemy, baseDamage, { aoe: true });

      if (enemy.dotRemaining <= 0) {
        delete enemy.dotDamagePerUnit;
        delete enemy.dotSourceTowerTypeId;
      }
    }
  }

  private isPulseTower(tower: TowerState): boolean {
    return this.towerTypes[tower.typeId]?.attack.kind === "pulse";
  }

  private firstPulseTowerTypeId(): string | undefined {
    for (const [typeId, type] of Object.entries(this.towerTypes)) {
      if (type.attack.kind === "pulse") {
        return typeId;
      }
    }
    return undefined;
  }

  private pulseDotDamagePerUnit(towerTypeId: string | undefined): number {
    if (!towerTypeId) {
      return 0;
    }
    const attack = this.towerTypes[towerTypeId]?.attack;
    return attack?.kind === "pulse" ? attack.dotDamagePerUnit : 0;
  }

  private applySunlightRegeneration(delta: number): void {
    const regenPerUnit = this.mission.sunlight?.regenPerUnit ?? 0;
    if (regenPerUnit <= 0 || this.sunlightPathKeys.size === 0) {
      return;
    }

    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || enemy.hp >= enemy.maxHp || !this.isEnemyInSunlight(enemy)) {
        continue;
      }
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + regenPerUnit * delta);
    }
  }

  private applyHealAuras(delta: number): void {
    const healByTargetId = new Map<string, { amount: number; healerId: string }>();
    for (const healer of this.enemies) {
      if (healer.hp <= 0) {
        continue;
      }
      const aura = this.enemyTypes[healer.typeId]?.healAura;
      if (!aura || aura.radius <= 0 || aura.healPerUnit <= 0) {
        continue;
      }
      const healerCoord = this.enemyCoord(healer);
      for (const target of this.enemies) {
        if (target.hp <= 0 || target.hp >= target.maxHp) {
          continue;
        }
        if (!aura.includeSelf && target.id === healer.id) {
          continue;
        }
        if (hexDistance(healerCoord, this.enemyCoord(target)) > aura.radius) {
          continue;
        }
        const previous = healByTargetId.get(target.id);
        const amount = aura.healPerUnit * delta;
        if (previous && aura.stacks !== false) {
          previous.amount += amount;
        } else if (!previous) {
          healByTargetId.set(target.id, { amount, healerId: healer.id });
        }
      }
    }

    for (const [targetId, heal] of healByTargetId) {
      const target = this.enemies.find((enemy) => enemy.id === targetId);
      if (!target || target.hp <= 0 || target.hp >= target.maxHp) {
        continue;
      }
      const previousHp = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + heal.amount);
      const amount = target.hp - previousHp;
      if (amount > 0.0001) {
        this.lastEvents.push({
          type: "enemyHealed",
          healerEnemyId: heal.healerId,
          targetEnemyId: target.id,
          targetEnemyTypeId: target.typeId,
          amount
        });
      }
    }
  }

  /** Boss pattern: enemies with `towerDisrupt` periodically silence towers within radius. */
  private updateTowerDisruptions(delta: number): void {
    if (this.towers.length === 0) {
      return;
    }
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      const disrupt = this.enemyTypes[enemy.typeId]?.towerDisrupt;
      if (!disrupt || disrupt.interval <= 0 || disrupt.duration <= 0) {
        continue;
      }
      enemy.disruptCooldown = (enemy.disruptCooldown ?? disrupt.interval) - delta;
      if (enemy.disruptCooldown > 0) {
        continue;
      }
      enemy.disruptCooldown = disrupt.interval;
      const center = this.enemyCoord(enemy);
      const disabledTowerIds: string[] = [];
      for (const tower of this.towers) {
        if (hexDistance(center, tower.coord) <= disrupt.radius) {
          tower.disabledFor = Math.max(tower.disabledFor ?? 0, disrupt.duration);
          disabledTowerIds.push(tower.id);
        }
      }
      if (disabledTowerIds.length > 0) {
        this.lastEvents.push({ type: "towerDisrupted", enemyId: enemy.id, enemyTypeId: enemy.typeId, towerIds: disabledTowerIds, duration: disrupt.duration });
      }
    }
  }

  /** Boss pattern: enemies with `towerAttack` periodically damage the nearest tower with hp; destroy it at 0. */
  private updateEnemyTowerAttacks(delta: number): void {
    if (this.towers.length === 0) {
      return;
    }
    const destroyedIds: string[] = [];
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      const attack = this.enemyTypes[enemy.typeId]?.towerAttack;
      if (!attack || attack.interval <= 0 || attack.damage <= 0) {
        continue;
      }
      enemy.towerAttackCooldown = (enemy.towerAttackCooldown ?? attack.interval) - delta;
      if (enemy.towerAttackCooldown > 0) {
        continue;
      }
      enemy.towerAttackCooldown = attack.interval;
      const center = this.enemyCoord(enemy);
      let target: TowerState | null = null;
      let best = Infinity;
      for (const tower of this.towers) {
        if (typeof tower.hp !== "number" || tower.hp <= 0) continue; // indestructible or already downed this tick
        const dist = hexDistance(center, tower.coord);
        if (dist <= attack.range && dist < best) { best = dist; target = tower; }
      }
      if (!target) continue;
      target.hp = (target.hp ?? 0) - attack.damage;
      this.lastEvents.push({ type: "towerAttacked", enemyId: enemy.id, enemyTypeId: enemy.typeId, towerId: target.id, damage: attack.damage });
      if (target.hp <= 0) {
        destroyedIds.push(target.id);
        this.lastEvents.push({ type: "towerDestroyed", towerId: target.id, towerTypeId: target.typeId, enemyId: enemy.id });
      }
    }
    for (const id of destroyedIds) this.destroyTower(id);
  }

  private destroyTower(towerId: string): void {
    const index = this.towers.findIndex((tower) => tower.id === towerId);
    if (index < 0) return;
    this.map.clearOccupied(towerId); // free the footprint tiles for rebuilding
    this.towers.splice(index, 1);
  }

  private updateTowers(delta: number): void {
    for (const tower of this.towers) {
      const type = this.towerTypes[tower.typeId];
      if (!type) {
        continue;
      }
      if (tower.disabledFor && tower.disabledFor > 0) {
        tower.disabledFor = Math.max(0, tower.disabledFor - delta); // silenced by an enemy disrupt pulse
        continue;
      }
      tower.cooldown -= delta;
      const fireRateMultiplier = this.towerFireRateMultiplier(tower);

      if (type.attack.kind === "single") {
        this.updateSingleTower(tower, type.attack.fireRate * fireRateMultiplier, type.attack.damagePerStack, type.attack.chain);
      } else if (type.attack.kind === "pulse") {
        this.updatePulseTower(
          tower,
          this.towerPulseRate(tower) * fireRateMultiplier,
          type.attack.pulseDamage,
          type.attack.dotDuration,
          type.attack.dotDamagePerUnit
        );
      } else if (type.attack.kind === "sniper") {
        this.updateSniperTower(tower, type.attack.interval / fireRateMultiplier, type.attack.damage);
      } else if (type.attack.kind === "antiair") {
        this.updateAntiAirTower(tower, type.attack.fireRate * fireRateMultiplier, type.attack.damage);
      } else if (type.attack.kind === "splash") {
        this.updateSplashTower(tower, fireRateMultiplier);
      } else if (type.attack.kind === "pipeline") {
        this.updatePipelineTower(tower, type.attack, fireRateMultiplier);
      }
    }
  }

  private updateSingleTower(tower: TowerState, fireRate: number, damagePerStack: number, chain?: ChainDeliverySpec): void {
    const interval = 1 / fireRate;
    let shots = 0;

    while (tower.cooldown <= 0 && shots < 4) {
      const target = this.findSingleTarget(tower);
      if (!target) {
        tower.cooldown = 0;
        return;
      }

      const damage = tower.stacks * damagePerStack;
      this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
      const applied = this.applyTowerDamage(tower, target, damage);
      if (chain && applied > 0) {
        this.propagateChain(tower, target, damage, chain);
      }
      tower.cooldown += interval;
      shots += 1;
    }
  }

  /**
   * Chain delivery: propagate a landed hit hop-by-hop to the nearest not-yet-hit ground enemy
   * within `jumpRadius` of the LAST-hit enemy (not the origin — a true chain, not a fixed-radius
   * splash), for up to `maxJumps` extra hits, each scaled by `damageFalloff^hop`. Deterministic:
   * ties broken by enemy id. Reuses applyTowerDamage so resistances/armor/statusOnHit apply to
   * every hop exactly as they would to a primary hit.
   */
  private propagateChain(tower: TowerState, originTarget: EnemyState, baseDamage: number, chain: ChainDeliverySpec): void {
    const alreadyHit = new Set<string>([originTarget.id]);
    let current = originTarget;
    for (let hop = 1; hop <= chain.maxJumps; hop += 1) {
      const fromCoord = this.enemyCoord(current);
      let next: EnemyState | undefined;
      let bestDistance = Infinity;
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0 || alreadyHit.has(enemy.id) || this.enemyTargetClass(enemy) !== "ground") {
          continue;
        }
        const distance = hexDistance(fromCoord, this.enemyCoord(enemy));
        if (distance > chain.jumpRadius) {
          continue;
        }
        if (!next || distance < bestDistance || (distance === bestDistance && enemy.id < next.id)) {
          next = enemy;
          bestDistance = distance;
        }
      }
      if (!next) {
        return;
      }
      alreadyHit.add(next.id);
      const hopDamage = baseDamage * Math.pow(chain.damageFalloff, hop);
      this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: next.id, damage: hopDamage });
      this.applyTowerDamage(tower, next, hopDamage);
      current = next;
    }
  }

  private updatePulseTower(
    tower: TowerState,
    pulseRate: number,
    pulseDamage: number,
    dotDuration: number,
    dotDamagePerUnit: number
  ): void {
    const interval = 1 / pulseRate;
    let pulses = 0;

    while (tower.cooldown <= 0 && pulses < 3) {
      const targets = this.enemies.filter(
        (enemy) =>
          enemy.hp > 0 && this.enemyTargetClass(enemy) === "ground" && this.enemyInRange(tower, enemy, this.towerRange(tower))
      );
      if (targets.length === 0) {
        tower.cooldown = 0;
        return;
      }

      for (const target of targets) {
        const damage = this.applyTowerDamage(tower, target, pulseDamage, { aoe: true });
        if (damage > 0) {
          target.dotRemaining = dotDuration;
          target.dotDamagePerUnit = dotDamagePerUnit;
          target.dotSourceTowerTypeId = tower.typeId;
        }
      }

      this.lastEvents.push({ type: "areaPulse", towerId: tower.id, enemyIds: targets.map((target) => target.id) });
      tower.cooldown += interval;
      pulses += 1;
    }
  }

  private updateSniperTower(tower: TowerState, interval: number, damage: number): void {
    let shots = 0;

    while (tower.cooldown <= 0 && shots < 2) {
      const target = this.findSniperTarget(tower);
      if (!target) {
        tower.cooldown = 0;
        return;
      }

      this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
      this.applyTowerDamage(tower, target, damage);
      tower.cooldown += interval;
      shots += 1;
    }
  }

  private updateAntiAirTower(tower: TowerState, fireRate: number, damage: number): void {
    const interval = 1 / fireRate;
    let volleys = 0;

    while (tower.cooldown <= 0 && volleys < 3) {
      const targets = this.findAntiAirTargets(tower);
      if (targets.length === 0) {
        tower.cooldown = 0;
        return;
      }

      for (const target of targets) {
        this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage });
        this.applyTowerDamage(tower, target, damage);
      }

      tower.cooldown += interval;
      volleys += 1;
    }
  }

  private updateSplashTower(tower: TowerState, fireRateMultiplier = 1): void {
    const type = this.towerTypes[tower.typeId];
    if (!type || type.attack.kind !== "splash") {
      return;
    }
    const attack = type.attack;
    const interval = this.slipperyJackInterval(tower) / fireRateMultiplier;
    let shots = 0;

    while (tower.cooldown <= 0 && shots < 3) {
      const target = this.findSplashTarget(tower);
      if (!target) {
        tower.cooldown = 0;
        return;
      }

      const targetCoord = this.enemyCoord(target);
      const targets = this.enemies.filter(
        (enemy) =>
          enemy.hp > 0 &&
          (attack.affectsClasses ?? ["ground"]).includes(this.enemyTargetClass(enemy)) &&
          hexDistance(this.enemyCoord(enemy), targetCoord) <= attack.splashRadius
      );

      this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.id, damage: attack.damage });
      for (const enemy of targets) {
        this.applyTowerDamage(tower, enemy, enemy.id === target.id ? attack.damage : attack.splashDamage);
        this.applySlow(enemy, attack.slowFactor, attack.slowDuration, attack.affectsClasses);
      }

      tower.cooldown += interval;
      shots += 1;
    }
  }

  private updatePipelineTower(tower: TowerState, attack: EffectPipelineAttackModel, fireRateMultiplier: number): void {
    const levelIndex = Math.max(0, tower.level - 1);
    const baseInterval = attack.intervalByLevel?.[Math.min(levelIndex, attack.intervalByLevel.length - 1)] ?? attack.interval;
    const interval = baseInterval / Math.max(0.05, fireRateMultiplier);
    let activations = 0;
    while (tower.cooldown <= 0 && activations < 4) {
      const targets = this.pipelineTargets(tower, attack);
      if (targets.length === 0) {
        tower.cooldown = 0;
        return;
      }
      for (const target of targets) {
        const expectedDamage = attack.effects.reduce((sum, effect) => {
          if (effect.kind !== "damage") return sum;
          const amount = effect.amountByLevel?.[Math.min(levelIndex, effect.amountByLevel.length - 1)] ?? effect.amount;
          return sum + amount * target.damageMultiplier;
        }, 0);
        this.lastEvents.push({ type: "towerFired", towerId: tower.id, enemyId: target.enemy.id, damage: expectedDamage });
        for (const effect of attack.effects) this.applyPipelineEffect(tower, target.enemy, effect, target.damageMultiplier, levelIndex, attack.delivery.kind === "area" || attack.delivery.kind === "aura");
      }
      tower.cooldown += interval;
      activations += 1;
    }
  }

  private pipelineTargets(
    tower: TowerState,
    attack: EffectPipelineAttackModel
  ): Array<{ enemy: EnemyState; damageMultiplier: number }> {
    const classes = attack.targeting?.classes?.length ? attack.targeting.classes : ["ground" as const];
    const inRange = this.enemies
      .filter((enemy) => enemy.hp > 0 && classes.includes(this.enemyTargetClass(enemy)) && this.enemyInRange(tower, enemy, this.towerRange(tower)))
      .sort((left, right) => this.compareTargets(tower, left, right));
    if (attack.delivery.kind === "aura") return inRange.map((enemy) => ({ enemy, damageMultiplier: 1 }));

    const primaryLimit = attack.delivery.kind === "single" ? 1 : Math.max(1, attack.targeting?.maxTargets ?? 1);
    const primaries = inRange.slice(0, primaryLimit);
    if (attack.delivery.kind === "single" || attack.delivery.kind === "multi") {
      return primaries.map((enemy) => ({ enemy, damageMultiplier: 1 }));
    }

    const delivered = new Map<string, { enemy: EnemyState; damageMultiplier: number }>();
    for (const primary of primaries) {
      delivered.set(primary.id, { enemy: primary, damageMultiplier: 1 });
      if (attack.delivery.kind === "area") {
        const multiplier = Math.max(0, attack.delivery.secondaryMultiplier ?? 1);
        const center = this.enemyCoord(primary);
        for (const enemy of this.enemies) {
          if (enemy.hp <= 0 || !classes.includes(this.enemyTargetClass(enemy)) || hexDistance(center, this.enemyCoord(enemy)) > attack.delivery.radius) continue;
          const nextMultiplier = enemy.id === primary.id ? 1 : multiplier;
          const current = delivered.get(enemy.id);
          if (!current || nextMultiplier > current.damageMultiplier) delivered.set(enemy.id, { enemy, damageMultiplier: nextMultiplier });
        }
      } else if (attack.delivery.kind === "chain") {
        const delivery = attack.delivery;
        let current = primary;
        const visited = new Set<string>([primary.id]);
        for (let hop = 1; hop <= delivery.maxJumps; hop += 1) {
          const center = this.enemyCoord(current);
          const next = this.enemies
            .filter((enemy) => enemy.hp > 0 && !visited.has(enemy.id) && classes.includes(this.enemyTargetClass(enemy)) && hexDistance(center, this.enemyCoord(enemy)) <= delivery.jumpRadius)
            .sort((left, right) => hexDistance(center, this.enemyCoord(left)) - hexDistance(center, this.enemyCoord(right)) || left.id.localeCompare(right.id))[0];
          if (!next) break;
          visited.add(next.id);
          const damageMultiplier = Math.pow(delivery.damageFalloff ?? 1, hop);
          const existing = delivered.get(next.id);
          if (!existing || damageMultiplier > existing.damageMultiplier) delivered.set(next.id, { enemy: next, damageMultiplier });
          current = next;
        }
      }
    }
    return [...delivered.values()];
  }

  private applyPipelineEffect(
    tower: TowerState,
    enemy: EnemyState,
    effect: TowerEffectSpec,
    deliveryMultiplier: number,
    levelIndex: number,
    aoe: boolean
  ): void {
    if (effect.kind === "damage") {
      const amount = effect.amountByLevel?.[Math.min(levelIndex, effect.amountByLevel.length - 1)] ?? effect.amount;
      this.applyTowerDamage(tower, enemy, amount * deliveryMultiplier, {
        aoe,
        damageType: effect.damageType,
        armorPiercing: effect.armorPiercing,
        applyLegacyStatus: false
      });
    } else if (effect.kind === "status") {
      this.applyStatusEffect(enemy, effect.status);
    } else if (effect.kind === "resource") {
      const resources = this.normalizeCost(effect.resources);
      this.addResources(resources);
      this.lastEvents.push({ type: "towerResourcesGranted", towerId: tower.id, enemyId: enemy.id, resources });
    }
  }

  private findSingleTarget(tower: TowerState): EnemyState | undefined {
    return this.selectTargets(tower, "ground", 1)[0];
  }

  private findSniperTarget(tower: TowerState): EnemyState | undefined {
    return this.selectTargets(tower, "ground", 1)[0];
  }

  private findAntiAirTargets(tower: TowerState): EnemyState[] {
    const type = this.towerTypes[tower.typeId];
    const attack = type?.attack.kind === "antiair" ? type.attack : undefined;
    if (!attack) {
      return [];
    }

    const limit = attack.maxTargetsByLevel[Math.min(tower.level, attack.maxTargetsByLevel.length) - 1] ?? 1;
    return this.selectTargets(tower, "flying", limit);
  }

  private findSplashTarget(tower: TowerState): EnemyState | undefined {
    return this.selectTargets(tower, "ground", 1)[0];
  }

  private towerSupportsTargetMode(tower: TowerState): boolean {
    const kind = this.towerTypes[tower.typeId]?.attack.kind;
    return kind === "single" || kind === "sniper" || kind === "antiair" || kind === "splash" || kind === "pipeline";
  }

  private selectTargets(tower: TowerState, targetClass: "ground" | "flying", limit: number): EnemyState[] {
    const range = this.towerRange(tower);
    return this.enemies
      .filter((enemy) => enemy.hp > 0 && this.enemyTargetClass(enemy) === targetClass && this.enemyInRange(tower, enemy, range))
      .sort((left, right) => this.compareTargets(tower, left, right))
      .slice(0, Math.max(0, limit));
  }

  private compareTargets(tower: TowerState, left: EnemyState, right: EnemyState): number {
    const mode = tower.targetMode ?? "first";
    const leftProgress = this.enemyRouteProgressRatio(left);
    const rightProgress = this.enemyRouteProgressRatio(right);
    const leftDistance = hexDistance(tower.coord, this.enemyCoord(left));
    const rightDistance = hexDistance(tower.coord, this.enemyCoord(right));
    let result = 0;
    if (mode === "last") result = leftProgress - rightProgress;
    else if (mode === "closest") result = leftDistance - rightDistance;
    else if (mode === "furthest") result = rightDistance - leftDistance;
    else if (mode === "strongest" || mode === "largest_hp") result = right.hp - left.hp || rightProgress - leftProgress;
    else if (mode === "weakest") result = left.hp - right.hp || rightProgress - leftProgress;
    else if (mode === "fastest_ahead") {
      result = Number(this.hasPierceOnlyArmor(right)) - Number(this.hasPierceOnlyArmor(left)) || rightProgress - leftProgress;
    } else result = rightProgress - leftProgress;
    return result || left.id.localeCompare(right.id);
  }

  private enemyInRange(tower: TowerState, enemy: EnemyState, range: number): boolean {
    return hexDistance(tower.coord, this.enemyCoord(enemy)) <= range;
  }

  private towerRange(tower: TowerState): number {
    const type = this.towerTypes[tower.typeId];
    if (!type) {
      return 0;
    }
    const attack = type.attack;
    const levelIndex = Math.max(0, tower.level - 1);
    if (attack.kind === "sniper") {
      return attack.rangeByLevel?.[Math.min(levelIndex, attack.rangeByLevel.length - 1)] ?? type.range;
    }
    if (attack.kind === "support") {
      return attack.auraRadiusByLevel?.[Math.min(levelIndex, attack.auraRadiusByLevel.length - 1)] ?? attack.auraRadius;
    }
    if (attack.kind === "support_buff") {
      return attack.auraRadius;
    }
    if (attack.kind === "pipeline") {
      return attack.rangeByLevel?.[Math.min(levelIndex, attack.rangeByLevel.length - 1)] ?? type.range;
    }
    return type.range;
  }

  private slipperyJackInterval(tower: TowerState): number {
    const type = this.towerTypes[tower.typeId];
    if (!type || type.attack.kind !== "splash") {
      return 1;
    }
    const levelIndex = Math.max(0, tower.level - 1);
    return type.attack.intervalByLevel?.[Math.min(levelIndex, type.attack.intervalByLevel.length - 1)] ?? type.attack.interval;
  }

  private towerPulseRate(tower: TowerState): number {
    const type = this.towerTypes[tower.typeId];
    if (!type || type.attack.kind !== "pulse") {
      return 1;
    }
    const levelIndex = Math.max(0, tower.level - 1);
    return type.attack.pulseRateByLevel?.[Math.min(levelIndex, type.attack.pulseRateByLevel.length - 1)] ?? type.attack.pulseRate;
  }

  private enemyTrack(enemy: EnemyState): HexCoord[] {
    return this.enemyTrackForType(enemy.typeId, enemy.routeId);
  }

  private enemyTrackForType(typeId: string, routeId?: string): HexCoord[] {
    return this.enemyTypes[typeId]?.movementKind === "direct_flying"
      ? this.directFlightLine
      : (this.map.pathRouteById(routeId)?.pathCenterline ?? this.map.pathCenterline);
  }

  private enemyTargetClass(enemy: EnemyState): "ground" | "flying" {
    return this.enemyTargetClassByType(enemy.typeId);
  }

  private enemyTargetClassByType(typeId: string): "ground" | "flying" {
    return this.enemyTypes[typeId]?.targetClass ?? "ground";
  }

  private enemyTerrainSpeedFactor(enemy: EnemyState): number {
    const type = this.enemyTypes[enemy.typeId];
    if (!type || type.movementKind === "direct_flying" || type.ignoresWaterSlow || this.enemyTargetClass(enemy) !== "ground") {
      return 1;
    }
    const coord = this.enemyCoord(enemy);
    const staticFactor = this.map.getTile(coord)?.terrain === "water" ? this.content.constants.waterGroundSpeedFactor : 1;
    const temporaryFactor = this.isTemporaryWaterTile(coord) ? this.content.constants.pathWaterGroundSpeedFactor : 1;
    return Math.min(staticFactor, temporaryFactor);
  }

  private enemyStatusSpeedFactor(enemy: EnemyState): number {
    if ((enemy.statuses?.stun?.remaining ?? 0) > 0) {
      return 0; // stunned enemies are frozen in place
    }
    const slow = enemy.statuses?.slow;
    if (!slow || slow.remaining <= 0) {
      return 1;
    }
    return Math.min(1, Math.max(0.05, slow.factor));
  }

  private isEnemyInSunlight(enemy: EnemyState): boolean {
    if (this.sunlightPathKeys.size === 0 || this.enemyTargetClass(enemy) !== "ground") {
      return false;
    }
    const track = this.enemyTrack(enemy);
    const order = Math.min(Math.round(enemy.pathProgress), track.length - 1);
    return this.sunlightPathKeys.has(this.routePathKey(enemy.routeId, order));
  }

  private aoeDamageAfterSunlight(enemy: EnemyState, damage: number): number {
    if (damage <= 0 || !this.isEnemyInSunlight(enemy)) {
      return damage;
    }
    return damage * (this.mission.sunlight?.aoeDamageMultiplier ?? 1);
  }

  private applyTowerDamage(
    tower: TowerState,
    enemy: EnemyState,
    rawDamage: number,
    options: DamageResolutionOptions = {}
  ): number {
    const damage = this.resolveEffectiveTowerDamage(tower.typeId, enemy, rawDamage, options);
    if (damage > 0) {
      enemy.hp -= damage;
      if (options.applyLegacyStatus !== false) this.applyStatusOnHit(tower.typeId, enemy);
      this.lastEvents.push({
        type: "enemyHit",
        towerId: tower.id,
        enemyId: enemy.id,
        enemyTypeId: enemy.typeId,
        damage
      });
      return damage;
    }

    if (rawDamage > 0 && this.isDamageBlockedByArmor(tower.typeId, enemy, options.armorPiercing)) {
      this.lastEvents.push({
        type: "enemyArmorBlocked",
        towerId: tower.id,
        enemyId: enemy.id,
        enemyTypeId: enemy.typeId,
        rawDamage
      });
    }
    return 0;
  }

  private resolveEffectiveTowerDamage(
    towerTypeId: string,
    enemy: EnemyState,
    rawDamage: number,
    options: DamageResolutionOptions = {}
  ): number {
    let damage = rawDamage * this.towerDamageMultiplier;
    damage = options.aoe ? this.aoeDamageAfterSunlight(enemy, damage) : damage;
    if (damage <= 0) {
      return 0;
    }

    // Elemental resistances: scale by the enemy's multiplier for this attack's (author-defined) damage type.
    damage *= this.resistanceMultiplier(enemy, options.damageType ?? this.damageTypeOf(towerTypeId));
    if (damage <= 0) {
      return 0;
    }

    const armor = this.enemyTypes[enemy.typeId]?.armor;
    if (!armor || armor.kind !== "pierce_only" || options.armorPiercing || this.piercesSniperArmor(towerTypeId)) {
      return damage;
    }

    damage = Math.min(damage, this.armoredChipDamageForTower(towerTypeId, armor.chipDamageByTowerId));
    return Math.max(0, damage);
  }

  /** The (author-defined) damage type a tower deals; defaults to "physical". */
  private damageTypeOf(towerTypeId: string): string {
    const attack = this.towerTypes[towerTypeId]?.attack as { damageType?: string } | undefined;
    return attack?.damageType ?? "physical";
  }

  /** Enemy's incoming-damage multiplier for a damage type (unlisted types = 1, clamped >= 0). */
  private resistanceMultiplier(enemy: EnemyState, damageType: string): number {
    const value = this.enemyTypes[enemy.typeId]?.resistances?.[damageType];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 1;
  }

  private isDamageBlockedByArmor(towerTypeId: string, enemy: EnemyState, armorPiercing = false): boolean {
    const armor = this.enemyTypes[enemy.typeId]?.armor;
    if (!armor || armor.kind !== "pierce_only" || armorPiercing || this.piercesSniperArmor(towerTypeId)) {
      return false;
    }
    return this.armoredChipDamageForTower(towerTypeId, armor.chipDamageByTowerId) <= 0;
  }

  /** "pierce_only" armor is fully pierced by any sniper-kind weapon, regardless of its tower id. */
  private piercesSniperArmor(towerTypeId: string): boolean {
    return this.towerTypes[towerTypeId]?.attack.kind === "sniper";
  }

  private armoredChipDamageForTower(towerTypeId: string, chipDamageByTowerId?: Record<string, number>): number {
    const configured = chipDamageByTowerId?.[towerTypeId];
    if (typeof configured === "number" && Number.isFinite(configured)) {
      return Math.max(0, configured);
    }

    const attack = this.towerTypes[towerTypeId]?.attack;
    return attack?.kind === "splash" ? Math.max(0, attack.armoredChipDamage) : 0;
  }

  private hasPierceOnlyArmor(enemy: EnemyState): boolean {
    return this.enemyTypes[enemy.typeId]?.armor?.kind === "pierce_only";
  }

  private applySlow(enemy: EnemyState, factor: number, duration: number, affectsClasses: EnemyTargetClass[] = ["ground"]): void {
    if (!affectsClasses.includes(this.enemyTargetClass(enemy)) || factor >= 1 || factor <= 0 || duration <= 0) {
      return;
    }

    const existing = enemy.statuses?.slow;
    enemy.statuses ??= {};
    enemy.statuses.slow = {
      factor: existing ? Math.min(existing.factor, factor) : factor,
      remaining: Math.max(existing?.remaining ?? 0, duration)
    };
  }

  /** Apply a tower's data-driven on-hit status effects. Content-agnostic: keyed on attack.statusOnHit. */
  private applyStatusOnHit(towerTypeId: string, enemy: EnemyState): void {
    const spec = (this.towerTypes[towerTypeId]?.attack as { statusOnHit?: StatusEffectSpec } | undefined)?.statusOnHit;
    if (!spec) return;
    this.applyStatusEffect(enemy, spec);
  }

  /**
   * Apply a status-effect spec to an enemy. The shared primitive behind both a tower's
   * `attack.statusOnHit` (via applyStatusOnHit) and an ability's `{kind:"status"}` effect
   * (via applyAbilityEffect) — one status vocabulary, two triggers.
   */
  private applyStatusEffect(enemy: EnemyState, spec: StatusEffectSpec): void {
    if (spec.slow) {
      this.applySlow(enemy, spec.slow.factor, spec.slow.duration, spec.slowAffectsClasses);
    }
    if (typeof spec.stun === "number" && spec.stun > 0) {
      enemy.statuses ??= {};
      enemy.statuses.stun = { remaining: Math.max(enemy.statuses.stun?.remaining ?? 0, spec.stun) };
    }
    if (spec.poison && spec.poison.dps > 0 && spec.poison.duration > 0) {
      enemy.statuses ??= {};
      const existing = enemy.statuses.poison;
      enemy.statuses.poison = {
        dps: Math.max(existing?.dps ?? 0, spec.poison.dps),
        remaining: Math.max(existing?.remaining ?? 0, spec.poison.duration)
      };
    }
  }

  private triggerEnemyPhaseSpawns(): void {
    const spawned: EnemyState[] = [];
    for (const parent of this.enemies) {
      if (parent.hp <= 0) {
        continue;
      }
      const type = this.enemyTypes[parent.typeId];
      if (!type?.phaseSpawns?.length) {
        continue;
      }
      parent.phaseSpawnsTriggered ??= [];
      for (const phase of type.phaseSpawns) {
        const key = `${phase.hpRatio}:${phase.enemyId}`;
        if (parent.phaseSpawnsTriggered.includes(key) || parent.hp / parent.maxHp > phase.hpRatio) {
          continue;
        }
        parent.phaseSpawnsTriggered.push(key);
        const children = this.createPhaseSpawnChildren(parent, phase);
        if (children.length > 0) {
          spawned.push(...children);
          this.lastEvents.push({
            type: "enemyPhaseSpawned",
            parentEnemyId: parent.id,
            parentEnemyTypeId: parent.typeId,
            enemyTypeId: phase.enemyId,
            enemyIds: children.map((child) => child.id),
            hpRatio: phase.hpRatio
          });
        }
      }
    }
    if (spawned.length > 0) {
      this.enemies.push(...spawned);
    }
  }

  private createPhaseSpawnChildren(parent: EnemyState, phase: EnemyPhaseSpawnDefinition): EnemyState[] {
    const parentRatio = this.enemyRouteProgressRatio(parent);
    const routeIds = phase.routeIds?.length ? phase.routeIds : [parent.routeId ?? this.defaultRouteId()];
    const children: EnemyState[] = [];
    for (let index = 0; index < phase.count; index += 1) {
      const routeId = this.resolveRouteId(routeIds[index % routeIds.length]);
      const track = this.enemyTrackForType(phase.enemyId, routeId);
      const trackEnd = Math.max(0, track.length - 1);
      const progress = Math.min(
        Math.max(0, parentRatio * trackEnd + (phase.progressOffset ?? 0)),
        Math.max(0, trackEnd - 0.001)
      );
      const offset = phase.pathOffsets?.[index] ?? (index % 2 === 0 ? -0.22 : 0.22);
      const child = this.createEnemyState(phase.enemyId, progress, offset, routeId);
      if (child) {
        children.push(child);
      }
    }
    return children;
  }

  private towerFireRateMultiplier(tower: TowerState): number {
    let best = this.towerFireRateMetaMultiplier;
    for (const support of this.towers) {
      if (support.id === tower.id) {
        continue;
      }
      const supportType = this.towerTypes[support.typeId];
      const attack = supportType?.attack;
      if (attack?.kind !== "support_buff" || !attack.affectsTowerIds.includes(tower.typeId)) {
        continue;
      }
      if (!this.supportBuffTouchesTower(support, tower)) {
        continue;
      }
      const levelIndex = Math.max(0, support.level - 1);
      const multiplier =
        attack.fireRateMultiplierByLevel[Math.min(levelIndex, attack.fireRateMultiplierByLevel.length - 1)] ?? 1;
      best = Math.max(best, multiplier * this.towerFireRateMetaMultiplier);
    }
    return best;
  }

  private supportBuffTouchesTower(support: TowerState, target: TowerState): boolean {
    const supportType = this.towerTypes[support.typeId];
    const targetType = this.towerTypes[target.typeId];
    const attack = supportType?.attack;
    if (!supportType || !targetType || attack?.kind !== "support_buff") {
      return false;
    }

    const edgeDistance = Math.max(0, hexDistance(support.coord, target.coord) - supportType.footprintRadius - targetType.footprintRadius);
    return edgeDistance <= this.towerRange(support);
  }

  private enemyRouteProgressRatio(enemy: EnemyState): number {
    const track = this.enemyTrack(enemy);
    return enemy.pathProgress / Math.max(1, track.length - 1);
  }

  private defaultRouteId(): string {
    return this.map.pathRoutes[0]?.id ?? "main";
  }

  private resolveRouteId(routeId: string | undefined): string {
    return this.map.pathRouteById(routeId)?.id ?? this.defaultRouteId();
  }

  private routePathKey(routeId: string | undefined, pathOrder: number): string {
    return `${this.resolveRouteId(routeId)}:${pathOrder}`;
  }

  private isTemporaryWaterTile(coord: HexCoord): boolean {
    const key = coordKey(coord);
    return this.temporaryWaterTiles.some((tile) => coordKey(tile) === key && tile.expiresIn > 0);
  }

  private isInsideAnyPulse(enemy: EnemyState): boolean {
    return (
      this.enemyTargetClass(enemy) === "ground" &&
      this.towers.some((tower) => this.isPulseTower(tower) && this.enemyInRange(tower, enemy, this.towerRange(tower)))
    );
  }

  private isInsideSupportAura(sourceTypeId: string, coord: HexCoord): boolean {
    const sourceType = this.towerTypes[sourceTypeId];
    if (sourceType?.attack.kind !== "support") {
      return false;
    }

    return this.towers.some(
      (tower) => tower.typeId === sourceTypeId && hexDistance(tower.coord, coord) <= this.towerRange(tower)
    );
  }

  private canOccupyTowerFootprint(typeId: string, coord: HexCoord, ignoreTowerId?: string): ActionResult {
    const type = this.towerTypes[typeId];
    if (!type) {
      return this.fail("Unknown tower type.", "reason.unknownTower");
    }

    if (type.requiresAuraFrom && !this.isInsideSupportAura(type.requiresAuraFrom, coord)) {
      return this.fail(`${type.label} needs a support aura.`, "reason.needsAura", { tower: typeId });
    }

    const footprint = this.map.tilesWithin(coord, type.footprintRadius);
    if (footprint.length === 0) {
      return this.fail("Outside map.", "reason.outsideMap");
    }

    const expectedFootprintSize = 1 + 3 * type.footprintRadius * (type.footprintRadius + 1);
    if (footprint.length < expectedFootprintSize) {
      return this.fail("Tower does not fit.", "reason.noFit");
    }

    for (const tile of footprint) {
      if (tile.terrain === "water") {
        return this.fail("Cannot build on water.", "reason.water");
      }
      if (tile.terrain !== "buildable") {
        return this.fail("Can only build outside the path.", "reason.path");
      }
      if (tile.occupiedBy && tile.occupiedBy !== ignoreTowerId) {
        return this.fail("Another tower already occupies this tile.", "reason.occupied");
      }
    }

    return { ok: true };
  }

  private dependentsKeepSupportAfterMove(sourceTowerId: string, nextCoord: HexCoord): boolean {
    const sourceTower = this.towers.find((tower) => tower.id === sourceTowerId);
    if (!sourceTower) {
      return false;
    }

    const sourceType = this.towerTypes[sourceTower.typeId];
    if (!sourceType || sourceType.attack.kind !== "support") {
      return true;
    }

    const unlocked = new Set(sourceType.attack.unlocksTowerIds);
    const otherSources = this.towers.filter((tower) => tower.typeId === sourceTower.typeId && tower.id !== sourceTowerId);
    const movedRange = this.towerRange(sourceTower);

    return this.towers.every((tower) => {
      if (!unlocked.has(tower.typeId)) {
        return true;
      }

      if (hexDistance(nextCoord, tower.coord) <= movedRange) {
        return true;
      }

      return otherSources.some((source) => hexDistance(source.coord, tower.coord) <= this.towerRange(source));
    });
  }

  private dependentsKeepSupportAfterRemoval(sourceTowerId: string): boolean {
    const sourceTower = this.towers.find((tower) => tower.id === sourceTowerId);
    if (!sourceTower) return false;
    const sourceType = this.towerTypes[sourceTower.typeId];
    if (!sourceType || sourceType.attack.kind !== "support") return true;
    const unlocked = new Set(sourceType.attack.unlocksTowerIds);
    const otherSources = this.towers.filter((tower) => tower.typeId === sourceTower.typeId && tower.id !== sourceTowerId);
    return this.towers.every((tower) => {
      if (tower.id === sourceTowerId || !unlocked.has(tower.typeId)) return true;
      return otherSources.some((source) => hexDistance(source.coord, tower.coord) <= this.towerRange(source));
    });
  }

  private applyPassiveIncome(delta: number): void {
    const passive = this.mission.economy?.passivePerTimeUnit;
    if (!passive || delta <= 0) return;
    this.addResources(this.scaleBag(passive, delta));
  }

  private awardClearedWaveIncome(): void {
    while (this.clearedWaveCount < this.startedWaveCount) {
      const waveIndex = this.clearedWaveCount;
      const income = this.normalizeCost(this.mission.economy?.perWaveClear ?? {});
      const interest = this.cloneResources({});
      const rate = Math.max(0, this.mission.economy?.interestRate ?? 0);
      const cap = this.mission.economy?.interestCap;
      for (const currencyId of this.currencyIds) {
        const raw = Math.max(0, (this.resources[currencyId] ?? 0) * rate);
        const max = Number(cap?.[currencyId]);
        interest[currencyId] = Number.isFinite(max) && max >= 0 ? Math.min(raw, max) : raw;
      }
      this.addResources(income);
      this.addResources(interest);
      this.clearedWaveCount += 1;
      this.lastEvents.push({ type: "waveCleared", waveIndex, income, interest });
    }
  }

  private removeDeadEnemies(): void {
    const survivors: EnemyState[] = [];
    const spawned: EnemyState[] = [];

    for (const enemy of this.enemies) {
      if (enemy.hp > 0) {
        survivors.push(enemy);
        continue;
      }

      if (enemy.pathProgress < this.enemyTrack(enemy).length - 1) {
        const type = this.enemyTypes[enemy.typeId];
        if (!type) {
          continue;
        }
        const reward = this.scaleBag(this.normalizeCost(type.reward), this.difficulty.enemyRewardMultiplier ?? 1);
        this.addResources(reward);
        this.killCount += 1;
        this.killCountByEnemyType[enemy.typeId] = (this.killCountByEnemyType[enemy.typeId] ?? 0) + 1;
        this.lastEvents.push({
          type: "enemyKilled",
          enemyId: enemy.id,
          enemyTypeId: enemy.typeId,
          coins: reward.coins ?? 0,
          resources: reward
        });
        spawned.push(...this.spawnOnDeathChildren(enemy));
      }
    }

    this.enemies = [...survivors, ...spawned];
  }

  private spawnOnDeathChildren(parent: EnemyState): EnemyState[] {
    const spawn = this.enemyTypes[parent.typeId]?.spawnOnDeath;
    if (!spawn || spawn.count <= 0) {
      return [];
    }

    const childRouteId = this.enemyTargetClassByType(spawn.enemyId) === "ground" ? parent.routeId : undefined;
    const track = this.enemyTrackForType(spawn.enemyId, childRouteId);
    const trackEnd = Math.max(0, track.length - 1);
    const childProgress = Math.min(parent.pathProgress + spawn.forwardPathSteps, Math.max(0, trackEnd - 0.001));
    const children: EnemyState[] = [];
    for (let index = 0; index < spawn.count; index += 1) {
      const offset = spawn.pathOffsets?.[index] ?? 0;
      const child = this.createEnemyState(spawn.enemyId, childProgress, offset, childRouteId);
      if (child) {
        children.push(child);
      }
    }

    if (children.length > 0) {
      this.lastEvents.push({
        type: "enemySpawnedOnDeath",
        parentEnemyId: parent.id,
        parentEnemyTypeId: parent.typeId,
        enemyTypeId: spawn.enemyId,
        enemyIds: children.map((child) => child.id)
      });
    }
    return children;
  }

  private resolveWaveState(): void {
    if (this.outcome !== "playing") {
      return;
    }

    if (this.startedWaveCount === 0) {
      this.waveState = "ready";
      this.prepRemaining = 0;
      return;
    }

    const battlefieldClear = this.spawnQueue.length === 0 && this.enemies.length === 0;
    if (battlefieldClear) this.awardClearedWaveIncome();
    const allWavesClear = this.startedWaveCount >= this.mission.waves.length && battlefieldClear;
    this.waveState = allWavesClear ? "complete" : battlefieldClear ? "between" : "spawning";
    this.syncPrepRemaining();

    const progress = this.buildObjectiveProgress();
    for (const objective of progress) {
      if (objective.complete && !this.completedObjectiveIds.has(objective.id)) {
        this.completedObjectiveIds.add(objective.id);
        this.lastEvents.push({ type: "objectiveCompleted", objectiveId: objective.id, kind: objective.kind });
      }
    }
    const failed = (this.mission.objectives?.failure ?? []).find((condition) => this.failureConditionMet(condition));
    if (failed) {
      this.outcome = "defeat";
      this.prepRemaining = 0;
      this.lastEvents.push({ type: "objectiveFailed", objectiveId: failed.id, kind: failed.kind });
      this.lastEvents.push({ type: "defeat" });
      return;
    }
    if (progress.length > 0 && progress.every((objective) => objective.complete)) {
      this.outcome = "victory";
      this.prepRemaining = 0;
      for (const star of this.mission.objectives?.stars ?? []) {
        if (this.starConditionMet(star) && !this.earnedStarIds.has(star.id)) {
          this.earnedStarIds.add(star.id);
          this.lastEvents.push({ type: "starEarned", starId: star.id });
        }
      }
      this.lastEvents.push({ type: "victory" });
      return;
    }
  }

  private victoryObjectives(): MissionVictoryObjective[] {
    const authored = this.mission.objectives?.victory;
    return authored?.length ? authored : [{ id: "clear_waves", label: "Clear all waves", kind: "clearWaves" }];
  }

  private buildObjectiveProgress() {
    return this.victoryObjectives().map((objective) => {
      let current = 0;
      let target = 1;
      if (objective.kind === "clearWaves") {
        current = this.clearedWaveCount;
        target = this.mission.waves.length;
      } else if (objective.kind === "surviveSeconds") {
        current = this.missionElapsed;
        target = objective.seconds;
      } else if (objective.kind === "killCount") {
        current = objective.enemyTypeId ? this.killCountByEnemyType[objective.enemyTypeId] ?? 0 : this.killCount;
        target = objective.count;
      } else if (objective.kind === "accumulateResource") {
        current = this.resources[objective.resourceId] ?? 0;
        target = objective.amount;
      }
      return {
        id: objective.id,
        label: objective.label || this.objectiveLabel(objective.kind),
        kind: objective.kind,
        current,
        target,
        complete: current + 0.000001 >= target
      };
    });
  }

  private objectiveLabel(kind: MissionVictoryObjective["kind"]): string {
    if (kind === "clearWaves") return "Clear all waves";
    if (kind === "surviveSeconds") return "Survive";
    if (kind === "killCount") return "Defeat enemies";
    return "Accumulate resources";
  }

  private failureConditionMet(condition: MissionFailureObjective): boolean {
    if (condition.kind === "maxLeaks") return this.leakCount > condition.maxLeaks;
    return this.missionElapsed > condition.seconds + 0.000001;
  }

  private starConditionMet(condition: MissionStarCondition): boolean {
    if (condition.kind === "coreHpAtLeast") return this.coreHp + 0.000001 >= condition.amount;
    if (condition.kind === "maxLeaks") return this.leakCount <= condition.maxLeaks;
    if (condition.kind === "timeAtMost") return this.missionElapsed <= condition.seconds + 0.000001;
    return (this.resources[condition.resourceId] ?? 0) + 0.000001 >= condition.amount;
  }

  private buildStarSnapshot() {
    return (this.mission.objectives?.stars ?? []).map((star) => ({
      id: star.id,
      label: star.label,
      achieved: this.outcome === "victory" && this.starConditionMet(star)
    }));
  }

  private syncPrepRemaining(): void {
    this.prepRemaining = this.getNextWaveRemaining();
  }

  private getNextWaveRemaining(): number {
    if (this.startedWaveCount === 0 || this.nextWaveStartAt === null) {
      return 0;
    }
    return Math.max(0, this.nextWaveStartAt - this.missionElapsed);
  }

  private isPathBlockerType(typeId: string): boolean {
    return this.enemyTypes[typeId]?.isPathBlocker === true;
  }

  private enemyAvoidanceOffset(enemy: EnemyState): number {
    if (enemy.hp <= 0 || this.isPathBlockerType(enemy.typeId)) {
      return 0;
    }

    const stump = this.enemies
      .filter((item) => item.hp > 0 && this.isPathBlockerType(item.typeId))
      .map((item) => ({
        enemy: item,
        distance: Math.abs(item.pathProgress - enemy.pathProgress)
      }))
      .filter((item) => {
        if (item.enemy.routeId !== enemy.routeId) {
          return false;
        }
        const radius = this.enemyTypes[item.enemy.typeId]?.pathCollisionRadius ?? 1.1;
        return item.distance <= radius + 0.8;
      })
      .sort((a, b) => a.distance - b.distance)[0];

    if (!stump) {
      return 0;
    }

    const numericId = Number(enemy.id.split("_")[1] ?? 0);
    const side = numericId % 2 === 0 ? 1 : -1;
    const stumpRadius = this.enemyTypes[stump.enemy.typeId]?.pathCollisionRadius ?? 1.1;
    const strength = 1 - stump.distance / (stumpRadius + 0.8);
    return side * Math.max(0, strength) * 0.68;
  }

  /** Build a full bag over the declared currency set, defaulting any missing currency to 0. */
  private cloneResources(resources: ResourceBag): ResourceBag {
    const bag: ResourceBag = {};
    for (const id of this.currencyIds) {
      bag[id] = Number(resources?.[id]) || 0;
    }
    return bag;
  }

  private normalizeMetaUpgradeLevels(input: Record<string, number>): Record<string, number> {
    const levels: Record<string, number> = {};
    for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
      const requested = Number(input[upgradeId]) || 0;
      levels[upgradeId] = Math.max(0, Math.min(upgrade.maxLevel, Math.floor(requested)));
    }
    return levels;
  }

  private metaEffectTotal(
    kind: "towerDamage" | "towerFireRate" | "coreHp",
    valueField: "multiplierPerLevel" | "amountPerLevel"
  ): number {
    let total = 0;
    for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
      const level = this.metaUpgradeLevels[upgradeId] ?? 0;
      if (level <= 0) continue;
      for (const effect of upgrade.effects) {
        if (effect.kind !== kind) continue;
        const value = Number((effect as unknown as Record<string, number>)[valueField]) || 0;
        total += value * level;
      }
    }
    return total;
  }

  private initialResources(): ResourceBag {
    const resources = this.scaleBag(this.mission.startingResources, this.difficulty.startingResourceMultiplier ?? 1);
    for (const [upgradeId, upgrade] of Object.entries(this.content.metaProgression.upgrades)) {
      const level = this.metaUpgradeLevels[upgradeId] ?? 0;
      if (level <= 0) continue;
      for (const effect of upgrade.effects) {
        if (effect.kind !== "startingResource" || !this.currencyIds.includes(effect.resourceId)) continue;
        resources[effect.resourceId] = (resources[effect.resourceId] ?? 0) + effect.amountPerLevel * level;
      }
    }
    return resources;
  }

  private cleanCoord(coord: HexCoord): HexCoord {
    return { q: coord.q, r: coord.r };
  }

  private normalizeCost(cost: ResourceCost): ResourceBag {
    return this.cloneResources(cost);
  }

  private hasResources(cost: ResourceCost): boolean {
    return this.currencyIds.every((id) => (this.resources[id] ?? 0) >= (Number(cost?.[id]) || 0));
  }

  private spendResources(cost: ResourceCost): void {
    for (const id of this.currencyIds) {
      this.resources[id] = (this.resources[id] ?? 0) - (Number(cost?.[id]) || 0);
    }
  }

  private addResources(resources: ResourceBag): void {
    for (const id of this.currencyIds) {
      this.resources[id] = (this.resources[id] ?? 0) + (Number(resources?.[id]) || 0);
    }
  }

  private addToBag(target: ResourceBag, resources: ResourceBag): void {
    for (const id of this.currencyIds) target[id] = (target[id] ?? 0) + (Number(resources?.[id]) || 0);
  }

  private scaleBag(resources: ResourceBag, factor: number): ResourceBag {
    const bag = this.cloneResources({});
    for (const id of this.currencyIds) bag[id] = (Number(resources?.[id]) || 0) * factor;
    return bag;
  }

  private bagHasValue(resources: ResourceBag): boolean {
    return this.currencyIds.some((id) => Math.abs(resources[id] ?? 0) > 0.000001);
  }

  private formatCost(cost: ResourceCost): string {
    const normalized = this.normalizeCost(cost);
    const parts: string[] = [];
    for (const currency of this.currencies) {
      const amount = normalized[currency.id] ?? 0;
      if (amount > 0) parts.push(`${amount} ${currency.label}`);
    }
    return parts.join(" and ") || "resources";
  }

  private fail(
    reason: string,
    reasonKey: NonNullable<ActionResult["reasonKey"]>,
    reasonParams?: ActionResult["reasonParams"]
  ): ActionResult {
    return { ok: false, reason, reasonKey, reasonParams };
  }

  private costReasonParams(cost: ResourceCost): ActionResult["reasonParams"] {
    return this.normalizeCost(cost);
  }
}
