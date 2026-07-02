import { HexMap, type HexMapDefinition } from "../simulation/map.js";
import type {
  CurrencyDefinition,
  EnemyType,
  MissionAbilityDefinition,
  MissionAbilityId,
  MissionDefinition,
  MissionSunlightDefinition,
  ResourceBag,
  TowerType,
  WaveDefinition
} from "../simulation/types.js";

export const DEFAULT_CURRENCIES: CurrencyDefinition[] = [{ id: "coins", label: "Coins", color: 0xf5c542 }];

export interface WorldRegionDefinition {
  id: string;
  label: string;
  description: string;
  bounds: { x: number; y: number; width: number; height: number };
  accent: string;
  biome: string;
  connections: string[];
}

export interface WorldMissionNode {
  missionId: string;
  regionId: string;
  x: number;
  y: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  unlockRequiresMissionIds: string[];
}

export interface WorldMapCatalog {
  width: number;
  height: number;
  regions: WorldRegionDefinition[];
  missionNodes: WorldMissionNode[];
}

export interface GameBalanceConstants {
  timeUnitSeconds: number;
  startingCoreHp: number;
  startingCoins: number;
  startingResources: ResourceBag;
  prepTimeUnits: number;
  moveTowerCost: ResourceBag;
  waterGroundSpeedFactor: number;
  pathWaterCooldownUnits: number;
  pathWaterDurationUnits: number;
  pathWaterRadius: number;
  pathWaterGroundSpeedFactor: number;
}

export interface MissionDataDefinition {
  id: string;
  label: string;
  description: string;
  availability?: "playable" | "comingSoon";
  countsTowardProgress?: boolean;
  startingCoreHp: number;
  startingResources: ResourceBag;
  prepTimeUnits: number;
  mapId: string;
  waveSetId: string;
  buildTowerIds: string[];
  abilityIds?: MissionAbilityId[];
  sunlight?: MissionSunlightDefinition;
}

export interface MissionContentDefinition extends MissionDefinition {
  mapId: string;
  waveSetId: string;
  buildTowerIds: string[];
  abilityIds: MissionAbilityId[];
  mapFactory: () => HexMap;
}

export interface GameBalanceData {
  constants: GameBalanceConstants;
  currencies?: CurrencyDefinition[];
  defaultMissionId: string;
  abilities: Partial<Record<MissionAbilityId, MissionAbilityDefinition>>;
  enemies: Record<string, EnemyType>;
  towers: Record<string, TowerType>;
  waveSets: Record<string, WaveDefinition[]>;
  missions: Record<string, MissionDataDefinition>;
}

export interface GameContentRegistry {
  constants: GameBalanceConstants;
  currencies: CurrencyDefinition[];
  defaultMissionId: string;
  abilities: Partial<Record<MissionAbilityId, MissionAbilityDefinition>>;
  enemies: Record<string, EnemyType>;
  towers: Record<string, TowerType>;
  waveSets: Record<string, WaveDefinition[]>;
  missions: Record<string, MissionContentDefinition>;
  maps: Record<string, HexMapDefinition>;
  worldMap: WorldMapCatalog;
  visuals: unknown;
  storyComics: Record<string, unknown>;
  storySeenStoragePrefix: string;
  battleBackgrounds: Record<string, unknown>;
  battleBackgroundPlaceholderMissionIds: readonly string[];
  battleBackgroundFallbackMissionId: string;
}

export interface GameContentInput {
  balance: GameBalanceData;
  maps: Record<string, HexMapDefinition>;
  worldMap: WorldMapCatalog;
  visuals?: unknown;
  storyComics?: { seenStoragePrefix: string; comics: Record<string, unknown> };
  battleBackgrounds?: {
    fallbackMissionId: string;
    placeholderMissionIds: string[];
    definitions: Record<string, unknown>;
  };
}

export function createGameContentRegistry(options: GameContentInput): GameContentRegistry {
  const { balance, maps } = options;

  const missions = Object.fromEntries(
    Object.values(balance.missions).map((mission) => {
      const abilityIds = mission.abilityIds ?? [];
      const resolved: MissionContentDefinition = {
        ...mission,
        buildTowerIds: [...mission.buildTowerIds],
        abilityIds: [...abilityIds],
        waves: balance.waveSets[mission.waveSetId] ?? [],
        abilities: abilityIds.map((abilityId) => balance.abilities[abilityId]).filter((a): a is MissionAbilityDefinition => !!a),
        mapFactory: () => {
          const mapDefinition = maps[mission.mapId];
          if (!mapDefinition) {
            throw new Error(`Mission ${mission.id} references unknown map "${mission.mapId}".`);
          }
          return HexMap.fromDefinition(mapDefinition);
        }
      };
      return [mission.id, resolved];
    })
  );

  return {
    constants: balance.constants,
    currencies: balance.currencies && balance.currencies.length > 0 ? balance.currencies : DEFAULT_CURRENCIES,
    defaultMissionId: balance.defaultMissionId,
    abilities: balance.abilities,
    enemies: balance.enemies,
    towers: balance.towers,
    waveSets: balance.waveSets,
    missions,
    maps,
    worldMap: options.worldMap,
    visuals: options.visuals ?? {},
    storyComics: options.storyComics?.comics ?? {},
    storySeenStoragePrefix: options.storyComics?.seenStoragePrefix ?? "story_seen_",
    battleBackgrounds: options.battleBackgrounds?.definitions ?? {},
    battleBackgroundPlaceholderMissionIds: options.battleBackgrounds?.placeholderMissionIds ?? [],
    battleBackgroundFallbackMissionId: options.battleBackgrounds?.fallbackMissionId ?? ""
  };
}
