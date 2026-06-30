export type Terrain = "buildable" | "path" | "blocked" | "core" | "spawn" | "water";
export type Outcome = "playing" | "victory" | "defeat";
export type WaveState = "ready" | "spawning" | "between" | "complete";
export type TowerAttackKind =
  | "honey"
  | "chaga"
  | "oak_bolete"
  | "chanterelle"
  | "slippery_jack"
  | "support"
  | "support_buff";
export type ResourceId = "coins" | "oakRoots";
export type EnemyMovementKind = "path" | "direct_flying";
export type EnemyTargetClass = "ground" | "flying";
export type TowerTargetMode = "fastest_ahead" | "largest_hp";
export type MissionAbilityId = "path_water";

export type ResourceBag = Record<ResourceId, number>;

export type ResourceCost = Partial<ResourceBag>;

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
  kind: "oak_bolete_only";
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
}

export interface HoneyAttackModel {
  kind: "honey";
  fireRate: number;
  damagePerMushroom: number;
  startingMushrooms: number;
  maxMushrooms: number;
  upgradeCost: number;
}

export interface ChagaAttackModel {
  kind: "chaga";
  pulseRate: number;
  pulseRateByLevel?: [number, number, number];
  pulseDamage: number;
  sporeDamagePerUnit: number;
  sporeDuration: number;
  upgradeCosts?: ResourceCost[];
}

export interface OakBoleteAttackModel {
  kind: "oak_bolete";
  interval: number;
  damage: number;
  targetPriority: TowerTargetMode;
  rangeByLevel?: [number, number, number];
  upgradeCosts?: ResourceCost[];
}

export interface ChanterelleAttackModel {
  kind: "chanterelle";
  fireRate: number;
  damage: number;
  maxTargetsByLevel: [number, number, number, number];
  upgradeCosts: ResourceCost[];
}

export interface SlipperyJackAttackModel {
  kind: "slippery_jack";
  interval: number;
  damage: number;
  splashDamage: number;
  armoredChipDamage: number;
  splashRadius: number;
  slowFactor: number;
  slowDuration: number;
  intervalByLevel?: [number, number, number];
  upgradeCosts?: ResourceCost[];
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
  requiresAuraFrom?: string;
  attack:
    | HoneyAttackModel
    | ChagaAttackModel
    | OakBoleteAttackModel
    | ChanterelleAttackModel
    | SlipperyJackAttackModel
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

export interface MissionAbilityDefinition {
  id: MissionAbilityId;
  label: string;
  cooldown: number;
  duration: number;
  radius: number;
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
  sporeRemaining: number;
  /** Damage-per-time-unit of the spores currently on this enemy (set by the chaga tower that applied them). */
  sporeDamagePerUnit?: number;
  /** Tower type id that applied the active spores, used for armor resolution of lingering spore damage. */
  sporeSourceTowerTypeId?: string;
  pathOffset: number;
  routeId?: string;
  phaseSpawnsTriggered?: string[];
  statuses?: {
    slow?: {
      factor: number;
      remaining: number;
    };
  };
}

export interface TowerState {
  id: string;
  typeId: string;
  coord: HexCoord;
  footprint: HexCoord[];
  level: number;
  targetMode?: TowerTargetMode;
  mushrooms: number;
  cooldown: number;
}

export type GameEvent =
  | { type: "towerPlaced"; towerId: string; towerTypeId: string }
  | { type: "towerMoved"; towerId: string; from: HexCoord; to: HexCoord; cost: ResourceBag }
  | { type: "towerUpgraded"; towerId: string; level: number; mushrooms: number }
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
  | { type: "chagaPulse"; towerId: string; enemyIds: string[] }
  | { type: "waterAbilityUsed"; abilityId: MissionAbilityId; center: HexCoord; coords: HexCoord[]; duration: number }
  | { type: "oakRootUnlocked"; amount: number }
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
