import { GridMap } from "../simulation/map.js";
import { normalizeTerrainTypes } from "../simulation/terrain.js";
export const DEFAULT_CURRENCIES = [{ id: "coins", label: "Coins", color: 0xf5c542 }];
export function createGameContentRegistry(options) {
    const { balance, maps } = options;
    const missions = Object.fromEntries(Object.values(balance.missions).map((mission) => {
        const abilityIds = mission.abilityIds ?? [];
        const resolved = {
            ...mission,
            buildTowerIds: [...mission.buildTowerIds],
            abilityIds: [...abilityIds],
            waves: balance.waveSets[mission.waveSetId] ?? [],
            abilities: abilityIds.map((abilityId) => balance.abilities[abilityId]).filter((a) => !!a),
            mapFactory: () => {
                const mapDefinition = maps[mission.mapId];
                if (!mapDefinition) {
                    throw new Error(`Mission ${mission.id} references unknown map "${mission.mapId}".`);
                }
                return GridMap.fromDefinition(mapDefinition);
            }
        };
        return [mission.id, resolved];
    }));
    return {
        constants: balance.constants,
        currencies: balance.currencies && balance.currencies.length > 0 ? balance.currencies : DEFAULT_CURRENCIES,
        defaultDifficultyId: balance.defaultDifficultyId ?? (Array.isArray(balance.difficulties) ? balance.difficulties[0]?.id : undefined) ?? "normal",
        difficulties: Array.isArray(balance.difficulties) && balance.difficulties.length > 0
            ? balance.difficulties.map((difficulty) => ({ ...difficulty }))
            : [{ id: "normal", label: "Normal" }],
        metaProgression: balance.metaProgression ?? { currencies: [], upgrades: {}, rewardsByMission: {} },
        terrainTypes: normalizeTerrainTypes(balance.terrainTypes, balance.constants.waterGroundSpeedFactor),
        defaultMissionId: balance.defaultMissionId,
        abilities: balance.abilities,
        enemies: balance.enemies,
        towers: balance.towers,
        waveSets: balance.waveSets,
        missions,
        maps,
        scripts: options.scripts ?? {},
        worldMap: options.worldMap,
        visuals: options.visuals ?? {},
        storyComics: options.storyComics?.comics ?? {},
        storySeenStoragePrefix: options.storyComics?.seenStoragePrefix ?? "story_seen_",
        battleBackgrounds: options.battleBackgrounds?.definitions ?? {},
        battleBackgroundPlaceholderMissionIds: options.battleBackgrounds?.placeholderMissionIds ?? [],
        battleBackgroundFallbackMissionId: options.battleBackgrounds?.fallbackMissionId ?? ""
    };
}
