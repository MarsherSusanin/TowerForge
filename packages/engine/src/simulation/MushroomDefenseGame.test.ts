import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { MushroomDefenseGame } from "./MushroomDefenseGame.js";

// A compact registry whose tower/enemy ids deliberately do NOT match attack kinds, so the tests
// double as regressions against hardcoded-id behavior in the engine.
function buildContent(): ReturnType<typeof createGameContentRegistry> {
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "basic",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100, oakRoots: 0 },
        prepTimeUnits: 5,
        moveTowerCost: { coins: 1, oakRoots: 0 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10,
        pathWaterDurationUnits: 5,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.3
      },
      abilities: {
        path_water: { id: "path_water", label: "Water", cooldown: 10, duration: 5, radius: 1 }
      },
      enemies: {
        grunt: { id: "grunt", label: "Grunt", maxHp: 6, speed: 1, reward: { coins: 2 }, coinReward: 2, coreDamage: 1, color: 0x88aa66 },
        tank: { id: "tank", label: "Tank", maxHp: 80, speed: 1, reward: { coins: 5 }, coinReward: 5, coreDamage: 5, color: 0x554433 },
        sponge: { id: "sponge", label: "Sponge", maxHp: 500, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0x77aa99 },
        wall: { id: "wall", label: "Wall", maxHp: 400, speed: 0.2, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0x222222, isPathBlocker: true },
        armored: { id: "armored", label: "Armored", maxHp: 8, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 5, color: 0x445566, armor: { kind: "oak_bolete_only" } }
      },
      towers: {
        // honey-kind tower, id != "honey"
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 8,
          attack: { kind: "honey", fireRate: 5, damagePerMushroom: 5, startingMushrooms: 3, maxMushrooms: 8, upgradeCost: 5 }
        },
        // oak_bolete-kind tower, id != "oak_bolete" (regression for setTowerTargetMode)
        sniper: {
          id: "sniper",
          label: "Sniper",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 8,
          attack: { kind: "oak_bolete", interval: 1, damage: 4, targetPriority: "fastest_ahead" }
        },
        // chaga-kind tower, id != "chaga" (regression for spore damage)
        fungus: {
          id: "fungus",
          label: "Fungus",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 1,
          attack: { kind: "chaga", pulseRate: 2, pulseDamage: 1, sporeDamagePerUnit: 5, sporeDuration: 8 }
        }
      },
      waveSets: {
        oneGrunt: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        oneTank: [{ id: "w1", label: "W1", groups: [{ enemyId: "tank", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        oneSponge: [{ id: "w1", label: "W1", groups: [{ enemyId: "sponge", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        oneArmored: [{ id: "w1", label: "W1", groups: [{ enemyId: "armored", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        blockerLine: [
          {
            id: "w1",
            label: "W1",
            groups: [
              { enemyId: "wall", count: 1, spawnInterval: 1, startDelay: 0 },
              { enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 1 }
            ]
          }
        ]
      },
      missions: {
        basic: mission("basic", "oneGrunt", 20),
        leak: mission("leak", "oneTank", 3),
        spore: mission("spore", "oneSponge", 50),
        blocker: mission("blocker", "blockerLine", 50),
        armored: mission("armored", "oneArmored", 3)
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
      regions: [{ id: "reg", label: "Reg", description: "", bounds: { x: 0, y: 0, width: 100, height: 100 }, accent: "#88aa66", biome: "t", connections: [] }],
      missionNodes: ["basic", "leak", "spore", "blocker"].map((id) => ({
        missionId: id,
        regionId: "reg",
        x: 50,
        y: 50,
        difficulty: 1 as const,
        unlockRequiresMissionIds: []
      }))
    }
  };
  return createGameContentRegistry(input);
}

function mission(id: string, waveSetId: string, startingCoreHp: number) {
  return {
    id,
    label: id,
    description: "",
    startingCoreHp,
    startingResources: { coins: 100, oakRoots: 0 },
    prepTimeUnits: 5,
    mapId: "lane",
    waveSetId,
    buildTowerIds: ["pelter", "sniper", "fungus"],
    abilityIds: []
  };
}

function tickFor(game: MushroomDefenseGame, units: number, step = 0.25): void {
  for (let elapsed = 0; elapsed < units; elapsed += step) {
    game.tick(Math.min(step, units - elapsed));
  }
}

describe("MushroomDefenseGame", () => {
  it("spawns enemies, fires towers, and awards coins on kill", () => {
    const game = new MushroomDefenseGame({ missionId: "basic", content: buildContent() });
    expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
    const coinsAfterBuild = game.coins;
    expect(game.startNextWave().ok).toBe(true);

    tickFor(game, 20);
    const snap = game.getSnapshot();

    expect(snap.outcome).toBe("victory");
    expect(game.coins).toBeGreaterThan(coinsAfterBuild); // grunt kill paid out
  });

  it("rejects placing a tower the player cannot afford", () => {
    const game = new MushroomDefenseGame({ missionId: "basic", content: buildContent() });
    game.coins = 0;
    const result = game.placeTower("pelter", { q: 1, r: 0 });
    expect(result.ok).toBe(false);
    expect(result.reasonKey).toBe("reason.needCost");
  });

  it("lets the core take damage and declares defeat when enemies leak", () => {
    const game = new MushroomDefenseGame({ missionId: "leak", content: buildContent() });
    expect(game.startNextWave().ok).toBe(true);
    tickFor(game, 30);
    const snap = game.getSnapshot();
    expect(snap.coreHp).toBeLessThan(game.mission.startingCoreHp);
    expect(snap.outcome).toBe("defeat");
  });

  // Regression for #1: target mode keyed on attack.kind, not the literal id "oak_bolete".
  it("allows setting target mode on any oak_bolete-kind tower regardless of id", () => {
    const game = new MushroomDefenseGame({ missionId: "basic", content: buildContent() });
    expect(game.placeTower("sniper", { q: 2, r: 0 }).ok).toBe(true);
    const towerId = game.getSnapshot().towers[0]!.id;
    const result = game.setTowerTargetMode(towerId, "largest_hp");
    expect(result.ok).toBe(true);
    expect(game.getSnapshot().towers[0]!.targetMode).toBe("largest_hp");
  });

  it("refuses target mode on towers that do not support it", () => {
    const game = new MushroomDefenseGame({ missionId: "basic", content: buildContent() });
    expect(game.placeTower("pelter", { q: 2, r: 0 }).ok).toBe(true);
    const towerId = game.getSnapshot().towers[0]!.id;
    const result = game.setTowerTargetMode(towerId, "largest_hp");
    expect(result.ok).toBe(false);
    expect(result.reasonKey).toBe("reason.targetModeUnsupported");
  });

  // Regression for #2: spores from a renamed chaga tower keep ticking after the enemy leaves the aura.
  it("applies lingering spore damage from a chaga-kind tower with a custom id", () => {
    const game = new MushroomDefenseGame({ missionId: "spore", content: buildContent() });
    expect(game.placeTower("fungus", { q: 0, r: 0 }).ok).toBe(true);
    expect(game.startNextWave().ok).toBe(true);

    let recordedSource: string | undefined;
    let recordedDamage: number | undefined;
    let hpWhenSpored = Infinity;
    // Advance until the sponge has been infected, capturing the spore bookkeeping.
    for (let i = 0; i < 40 && recordedSource === undefined; i += 1) {
      game.tick(0.25);
      const enemy = game.getSnapshot().enemies.find((e) => e.typeId === "sponge");
      if (enemy && enemy.sporeRemaining > 0) {
        recordedSource = enemy.sporeSourceTowerTypeId;
        recordedDamage = enemy.sporeDamagePerUnit;
        hpWhenSpored = enemy.hp;
      }
    }

    expect(recordedSource).toBe("fungus");
    expect(recordedDamage).toBe(5);

    // Keep ticking; once the sponge is out of the (range-1) aura, spores must still erode its HP.
    tickFor(game, 6);
    const enemy = game.getSnapshot().enemies.find((e) => e.typeId === "sponge");
    expect(enemy).toBeDefined();
    expect(enemy!.hp).toBeLessThan(hpWhenSpored);
  });

  // Regression: oak_bolete_only armor is pierced by attack.kind, not the literal tower id "oak_bolete".
  it("pierces oak_bolete_only armor with any oak_bolete-kind tower, blocks others", () => {
    const pierced = new MushroomDefenseGame({ missionId: "armored", content: buildContent() });
    expect(pierced.placeTower("sniper", { q: 4, r: 0 }).ok).toBe(true); // oak_bolete kind, id "sniper"
    expect(pierced.startNextWave().ok).toBe(true);
    tickFor(pierced, 20);
    expect(pierced.getSnapshot().outcome).toBe("victory");

    const blocked = new MushroomDefenseGame({ missionId: "armored", content: buildContent() });
    expect(blocked.placeTower("pelter", { q: 4, r: 0 }).ok).toBe(true); // honey kind cannot pierce
    expect(blocked.startNextWave().ok).toBe(true);
    tickFor(blocked, 20);
    expect(blocked.getSnapshot().outcome).toBe("defeat");
  });

  // Regression for #3: path blocking is driven by the isPathBlocker flag, not hardcoded enemy ids.
  it("steers following enemies around isPathBlocker enemies", () => {
    const game = new MushroomDefenseGame({ missionId: "blocker", content: buildContent() });
    expect(game.startNextWave().ok).toBe(true);

    let maxFollowerOffset = 0;
    for (let i = 0; i < 80; i += 1) {
      game.tick(0.25);
      const grunt = game.getSnapshot().enemies.find((e) => e.typeId === "grunt");
      if (grunt) {
        maxFollowerOffset = Math.max(maxFollowerOffset, Math.abs(grunt.pathOffset));
      }
    }
    expect(maxFollowerOffset).toBeGreaterThan(0);
  });
});
