import { GridMap, type GridMapDefinition } from "../simulation/map.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import type { CurrencyDefinition, DifficultyDefinition, EnemyType, MetaProgressionDefinition, MissionAbilityDefinition, MissionAbilityId, MissionDefinition, MissionEconomyDefinition, MissionObjectivesDefinition, MissionSunlightDefinition, ResourceBag, TerrainTypeDefinition, TowerType, WaveDefinition } from "../simulation/types.js";
export declare const DEFAULT_CURRENCIES: CurrencyDefinition[];
export interface WorldRegionDefinition {
    id: string;
    label: string;
    description: string;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
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
    economy?: MissionEconomyDefinition;
    objectives?: MissionObjectivesDefinition;
    sunlight?: MissionSunlightDefinition;
}
export interface MissionContentDefinition extends MissionDefinition {
    mapId: string;
    waveSetId: string;
    buildTowerIds: string[];
    abilityIds: MissionAbilityId[];
    mapFactory: () => GridMap;
}
export interface GameBalanceData {
    constants: GameBalanceConstants;
    currencies?: CurrencyDefinition[];
    defaultDifficultyId?: string;
    difficulties?: DifficultyDefinition[];
    metaProgression?: MetaProgressionDefinition;
    terrainTypes?: Record<string, Partial<TerrainTypeDefinition>>;
    defaultMissionId: string;
    abilities: Partial<Record<MissionAbilityId, MissionAbilityDefinition>>;
    enemies: Record<string, EnemyType>;
    towers: Record<string, TowerType>;
    waveSets: Record<string, WaveDefinition[]>;
    missions: Record<string, MissionDataDefinition>;
}
export interface StoryComicPanel {
    text: string;
    speaker?: string;
    spriteId?: string;
}
export interface StoryComicDefinition {
    id?: string;
    missionId: string;
    title?: string;
    trigger?: "beforeMission" | "afterVictory";
    replay?: "once" | "always";
    panels: StoryComicPanel[];
}
export interface BattleBackgroundDefinition {
    missionId?: string;
    color?: string;
    spriteId?: string;
    opacity?: number;
}
export interface GameContentRegistry {
    constants: GameBalanceConstants;
    currencies: CurrencyDefinition[];
    defaultDifficultyId: string;
    difficulties: DifficultyDefinition[];
    metaProgression: MetaProgressionDefinition;
    terrainTypes: Record<string, TerrainTypeDefinition>;
    defaultMissionId: string;
    abilities: Partial<Record<MissionAbilityId, MissionAbilityDefinition>>;
    enemies: Record<string, EnemyType>;
    towers: Record<string, TowerType>;
    waveSets: Record<string, WaveDefinition[]>;
    missions: Record<string, MissionContentDefinition>;
    maps: Record<string, GridMapDefinition>;
    scripts: Record<string, TowerScriptDefinition>;
    worldMap: WorldMapCatalog;
    visuals: unknown;
    storyComics: Record<string, StoryComicDefinition>;
    storySeenStoragePrefix: string;
    battleBackgrounds: Record<string, BattleBackgroundDefinition>;
    battleBackgroundPlaceholderMissionIds: readonly string[];
    battleBackgroundFallbackMissionId: string;
}
export interface GameContentInput {
    balance: GameBalanceData;
    maps: Record<string, GridMapDefinition>;
    worldMap: WorldMapCatalog;
    scripts?: Record<string, TowerScriptDefinition>;
    visuals?: unknown;
    storyComics?: {
        seenStoragePrefix: string;
        comics: Record<string, StoryComicDefinition>;
    };
    battleBackgrounds?: {
        fallbackMissionId: string;
        placeholderMissionIds: string[];
        definitions: Record<string, BattleBackgroundDefinition>;
    };
}
export declare function createGameContentRegistry(options: GameContentInput): GameContentRegistry;
