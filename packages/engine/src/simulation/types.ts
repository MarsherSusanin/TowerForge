export type Terrain = "buildable" | "path" | "blocked" | "core" | "spawn" | "water";
export type Outcome = "playing" | "victory" | "defeat";
export type WaveState = "ready" | "spawning" | "between" | "complete";
export type TowerAttackKind =
  | "single"
  | "pulse"
  | "sniper"
  | "antiair"
  | "splash"
  | "support"
  | "support_buff";
// Currencies are author-defined. "coins" is the conventional primary currency that always
// exists, but a project may declare any number of additional currencies (see CurrencyDefinition).
export type ResourceId = "coins" | (string & {});
export type EnemyMovementKind = "path" | "direct_flying";
export type EnemyTargetClass = "ground" | "flying";
export type TowerTargetMode = "fastest_ahead" | "largest_hp";
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

export interface HexCoord {
  q: number;
  r: number;
}

export interface HexTile extends HexCoord {
  terrain: Terrain;
  occupiedBy?: string;
}

export interface HexPathRoute {
  id: string;
  pathCenterline: HexCoord[];
}

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

export interface TowerType {
  id: string;
  label: string;
  cost: ResourceCost;
  footprintRadius: number;
  range: number;
  /** If set, the tower has this much health and can be destroyed by enemy `towerAttack`. Omit = indestructible. */
  maxHp?: number;
  requiresAuraFrom?: string;
  attack:
    | SingleAttackModel
    | PulseAttackModel
    | SniperAttackModel
    | AntiAirAttackModel
    | SplashAttackModel
    | SupportAttackModel
    | SupportBuffAttackModel;
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
  startingCoreHp: number;
  startingResources: ResourceBag;
  prepTimeUnits: number;
  waves: WaveDefinition[];
  countsTowardProgress?: boolean;
  abilities?: MissionAbilityDefinition[];
  sunlight?: MissionSunlightDefinition;
}

/**
 * A composable primitive an ability applies to each enemy within its radius. The same shape
 * `applyStatusEffect` already resolves for a tower's `attack.statusOnHit` — abilities and tower
 * attacks share one status-effect vocabulary. A custom (non-preset) ability author-declares
 * `MissionAbilityDefinition.effects` from these; no engine code is needed for a new ability that
 * only needs damage and/or status effects.
 */
export type AbilityEffect = { kind: "damage"; amount: number } | { kind: "status"; status: StatusEffectSpec };

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
  slow?: { factor: number; duration: number };
  /** Damage-over-time: `dps` damage per time-unit for `duration` seconds. */
  poison?: { dps: number; duration: number };
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
  /** Remaining time this tower is disabled (silenced) by an enemy tower-disrupt pulse; 0 = active. */
  disabledFor?: number;
  /** Current health if the tower type has `maxHp`; when it reaches 0 the tower is destroyed. */
  hp?: number;
}

export type GameEvent =
  | { type: "towerPlaced"; towerId: string; towerTypeId: string }
  | { type: "towerMoved"; towerId: string; from: HexCoord; to: HexCoord; cost: ResourceBag }
  | { type: "towerUpgraded"; towerId: string; level: number; stacks: number }
  | { type: "towerDisrupted"; enemyId: string; enemyTypeId: string; towerIds: string[]; duration: number }
  | { type: "towerAttacked"; enemyId: string; enemyTypeId: string; towerId: string; damage: number }
  | { type: "towerDestroyed"; towerId: string; towerTypeId: string; enemyId: string }
  | { type: "towerTargetModeChanged"; towerId: string; mode: TowerTargetMode }
  | { type: "enemyKilled"; enemyId: string; enemyTypeId: string; coins: number; resources: ResourceBag }
  | {
      type: "enemySpawnedOnDeath";
      parentEnemyId: string;
      parentEnemyTypeId: string;
      enemyTypeId: string;
      enemyIds: string[];
    }
  | { type: "enemyLeaked"; enemyId: string; enemyTypeId: string; damage: number }
  | { type: "waveStarted"; waveIndex: number }
  | { type: "towerFired"; towerId: string; enemyId: string; damage: number }
  | { type: "enemyHit"; towerId: string; enemyId: string; enemyTypeId: string; damage: number }
  | { type: "enemyArmorBlocked"; towerId: string; enemyId: string; enemyTypeId: string; rawDamage: number }
  | { type: "enemyHealed"; healerEnemyId: string; targetEnemyId: string; targetEnemyTypeId: string; amount: number }
  | {
      type: "enemyPhaseSpawned";
      parentEnemyId: string;
      parentEnemyTypeId: string;
      enemyTypeId: string;
      enemyIds: string[];
      hpRatio: number;
    }
  | { type: "areaPulse"; towerId: string; enemyIds: string[] }
  | { type: "waterAbilityUsed"; abilityId: MissionAbilityId; center: HexCoord; coords: HexCoord[]; duration: number }
  | { type: "abilityUsed"; abilityId: MissionAbilityId; center: HexCoord; enemyIds: string[]; effects: AbilityEffect[] }
  | { type: "victory" }
  | { type: "defeat" };

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

export interface SunlightTile extends HexCoord {
  pathOrder: number;
  routeId?: string;
}

export interface GameSnapshot {
  missionId: string;
  missionLabel: string;
  coreHp: number;
  maxCoreHp: number;
  coins: number;
  resources: ResourceBag;
  waveIndex: number;
  totalWaves: number;
  startedWaveCount: number;
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
  sunlightTiles: SunlightTile[];
  pathCenterline: HexCoord[];
  pathRoutes: HexPathRoute[];
  spawnCoord: HexCoord;
  coreCoord: HexCoord;
  outcome: Outcome;
  lastEvents: GameEvent[];
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
  reasonKey?: string;
  reasonParams?: Record<string, string | number | undefined>;
}
