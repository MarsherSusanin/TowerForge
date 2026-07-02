import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { runBalanceSweep } from "./balance.js";

// Two missions on the same map: one trivially easy (1 weak enemy, strong cheap tower) and one
// unwinnable (a huge wave with no affordable defense), so the advisor flags are deterministic.
function buildContent(): ReturnType<typeof createGameContentRegistry> {
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "easy",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 10,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 2,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10,
        pathWaterDurationUnits: 5,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.3
      },
      abilities: { path_water: { id: "path_water", label: "Water", cooldown: 10, duration: 5, radius: 1 } },
      enemies: {
        grunt: { id: "grunt", label: "Grunt", maxHp: 4, speed: 1, reward: { coins: 3 }, coinReward: 3, coreDamage: 1, color: 0x88aa66 },
        titan: { id: "titan", label: "Titan", maxHp: 100000, speed: 2, reward: { coins: 0 }, coinReward: 0, coreDamage: 50, color: 0x554433 }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 5 },
          footprintRadius: 0,
          range: 8,
          attack: { kind: "single", fireRate: 5, damagePerStack: 10, startingStacks: 3, maxStacks: 8, upgradeCost: 5 }
        }
      },
      waveSets: {
        oneGrunt: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        titanRush: [{ id: "w1", label: "W1", groups: [{ enemyId: "titan", count: 5, spawnInterval: 0.5, startDelay: 0 }] }]
      },
      missions: {
        easy: mission("easy", "oneGrunt"),
        impossible: mission("impossible", "titanRush")
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 9,
        height: 3,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 8, r: 1 },
        pathCenterline: Array.from({ length: 9 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    worldMap: {
      width: 100,
      height: 100,
      regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 100, height: 100 }, accent: "#88aa66", biome: "t", connections: [] }],
      missionNodes: ["easy", "impossible"].map((id) => ({ missionId: id, regionId: "r", x: 1, y: 1, difficulty: 1 as const, unlockRequiresMissionIds: [] }))
    }
  };
  return createGameContentRegistry(input);
}

function mission(id: string, waveSetId: string) {
  return {
    id,
    label: id,
    description: "",
    startingCoreHp: 10,
    startingResources: { coins: 100 },
    prepTimeUnits: 2,
    mapId: "lane",
    waveSetId,
    buildTowerIds: ["pelter"],
    abilityIds: []
  };
}

describe("runBalanceSweep", () => {
  it("flags a trivial mission and an unwinnable mission from simulation outcomes", () => {
    const report = runBalanceSweep(buildContent(), { simSeconds: 120, tickStep: 0.5 });
    const easy = report.missions.find((m) => m.missionId === "easy");
    const impossible = report.missions.find((m) => m.missionId === "impossible");

    expect(easy?.winRate).toBe(1);
    expect(easy?.flags.some((f) => f.code === "trivial")).toBe(true);
    // single-tower missions must not be flagged "dominant_tower" (no alternatives to dominate)
    expect(easy?.flags.some((f) => f.code === "dominant_tower")).toBe(false);

    expect(impossible?.winRate).toBe(0);
    expect(impossible?.flags.some((f) => f.code === "unwinnable")).toBe(true);

    expect(report.summary.missions).toBe(2);
    expect(report.summary.winnable).toBe(1);
    expect(easy?.strategyCount).toBeGreaterThan(3);
    expect(easy?.results.some((result) => result.strategy.placement === "far_path")).toBe(true);
  });

  it("is deterministic — identical content yields an identical report", () => {
    const a = runBalanceSweep(buildContent(), { simSeconds: 120, tickStep: 0.5 });
    const b = runBalanceSweep(buildContent(), { simSeconds: 120, tickStep: 0.5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
