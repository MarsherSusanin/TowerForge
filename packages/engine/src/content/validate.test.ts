import { describe, expect, it } from "vitest";
import { createGameContentRegistry } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

describe("validateGameContentRegistry", () => {
  it("reports wave route ids that are absent from the mission map", () => {
    const content = createGameContentRegistry({
      balance: {
        defaultMissionId: "mission_01",
        constants: {
          timeUnitSeconds: 1,
          startingCoreHp: 10,
          startingCoins: 50,
          startingResources: { coins: 50, oakRoots: 0 },
          prepTimeUnits: 5,
          moveTowerCost: { coins: 1, oakRoots: 0 },
          waterGroundSpeedFactor: 0.8,
          pathWaterCooldownUnits: 10,
          pathWaterDurationUnits: 5,
          pathWaterRadius: 1,
          pathWaterGroundSpeedFactor: 0.6
        },
        abilities: {
          path_water: {
            id: "path_water",
            label: "Path Water",
            cooldown: 10,
            duration: 5,
            radius: 1
          }
        },
        enemies: {
          crawler: {
            id: "crawler",
            label: "Crawler",
            maxHp: 5,
            speed: 1,
            reward: { coins: 1 },
            coinReward: 1,
            coreDamage: 1,
            color: 0x88aa66
          }
        },
        towers: {
          honey: {
            id: "honey",
            label: "Honey",
            cost: { coins: 1 },
            footprintRadius: 0,
            range: 3,
            attack: {
              kind: "honey",
              fireRate: 1,
              damagePerMushroom: 1,
              startingMushrooms: 1,
              maxMushrooms: 3,
              upgradeCost: 1
            }
          }
        },
        waveSets: {
          waves: [
            {
              id: "wave_1",
              label: "Wave 1",
              groups: [{ enemyId: "crawler", count: 1, spawnInterval: 1, startDelay: 0, routeId: "missing" }]
            }
          ]
        },
        missions: {
          mission_01: {
            id: "mission_01",
            label: "Mission",
            description: "",
            startingCoreHp: 10,
            startingResources: { coins: 50, oakRoots: 0 },
            prepTimeUnits: 5,
            mapId: "map_01",
            waveSetId: "waves",
            buildTowerIds: ["honey"],
            abilityIds: []
          }
        }
      },
      maps: {
        map_01: {
          id: "map_01",
          width: 3,
          height: 1,
          defaultTerrain: "buildable",
          spawnCoord: { q: 0, r: 0 },
          coreCoord: { q: 2, r: 0 },
          pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }],
          pathRoutes: [],
          terrainOverrides: []
        }
      },
      worldMap: {
        width: 100,
        height: 100,
        regions: [{
          id: "region_01",
          label: "Region",
          description: "",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          accent: "#88aa66",
          biome: "test",
          connections: []
        }],
        missionNodes: [{
          missionId: "mission_01",
          regionId: "region_01",
          x: 50,
          y: 50,
          difficulty: 1,
          unlockRequiresMissionIds: []
        }]
      }
    });

    const result = validateGameContentRegistry(content);

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.fieldPath === "groups.routeId" && issue.message.includes("missing"))).toBe(true);
  });
});
