import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { runHeadlessMission } from "./headless.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { SingleAttackModel } from "./types.js";

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
        startingResources: { coins: 100 },
        prepTimeUnits: 5,
        moveTowerCost: { coins: 1 },
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
        armored: { id: "armored", label: "Armored", maxHp: 8, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 5, color: 0x445566, armor: { kind: "pierce_only" } }
      },
      towers: {
        // single-kind tower, id != "single"
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 8,
          attack: { kind: "single", fireRate: 5, damagePerStack: 5, startingStacks: 3, maxStacks: 8, upgradeCost: 5 }
        },
        // sniper-kind tower, id != "sniper" (regression for setTowerTargetMode)
        sniper: {
          id: "sniper",
          label: "Sniper",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 8,
          attack: { kind: "sniper", interval: 1, damage: 4, targetPriority: "fastest_ahead" }
        },
        // pulse-kind tower, id != "pulse" (regression for dot damage)
        sprayer: {
          id: "sprayer",
          label: "Sprayer",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 1,
          attack: { kind: "pulse", pulseRate: 2, pulseDamage: 1, dotDamagePerUnit: 5, dotDuration: 8 }
        }
      },
      waveSets: {
        oneGrunt: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        oneTank: [{ id: "w1", label: "W1", groups: [{ enemyId: "tank", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        oneSponge: [{ id: "w1", label: "W1", groups: [{ enemyId: "sponge", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        oneArmored: [{ id: "w1", label: "W1", groups: [{ enemyId: "armored", count: 1, spawnInterval: 1, startDelay: 0 }] }],
        targetPair: [{ id: "w1", label: "W1", groups: [
          { enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 },
          { enemyId: "tank", count: 1, spawnInterval: 1, startDelay: 0 }
        ] }],
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
        dot: mission("dot", "oneSponge", 50),
        blocker: mission("blocker", "blockerLine", 50),
        armored: mission("armored", "oneArmored", 3),
        targeting: mission("targeting", "targetPair", 20)
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
      missionNodes: ["basic", "leak", "dot", "blocker"].map((id) => ({
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
    startingResources: { coins: 100 },
    prepTimeUnits: 5,
    mapId: "lane",
    waveSetId,
    buildTowerIds: ["pelter", "sniper", "sprayer"],
    abilityIds: []
  };
}

function tickFor(game: TowerDefenseGame, units: number, step = 0.25): void {
  for (let elapsed = 0; elapsed < units; elapsed += step) {
    game.tick(Math.min(step, units - elapsed));
  }
}

describe("TowerDefenseGame", () => {
  it("spawns enemies, fires towers, and awards coins on kill", () => {
    const game = new TowerDefenseGame({ missionId: "basic", content: buildContent() });
    expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
    const coinsAfterBuild = game.coins;
    expect(game.startNextWave().ok).toBe(true);

    tickFor(game, 20);
    const snap = game.getSnapshot();

    expect(snap.outcome).toBe("victory");
    expect(game.coins).toBeGreaterThan(coinsAfterBuild); // grunt kill paid out
  });

  it("rejects placing a tower the player cannot afford", () => {
    const game = new TowerDefenseGame({ missionId: "basic", content: buildContent() });
    game.coins = 0;
    const result = game.placeTower("pelter", { q: 1, r: 0 });
    expect(result.ok).toBe(false);
    expect(result.reasonKey).toBe("reason.needCost");
  });

  it("refunds placement and upgrade investment when a tower is sold", () => {
    const content = buildContent();
    content.missions.basic!.economy = { sellRefundRatio: 0.5 };
    const game = new TowerDefenseGame({ missionId: "basic", content });
    expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
    const towerId = game.towers[0]!.id;
    expect(game.upgradeTower(towerId).ok).toBe(true);
    expect(game.getTowerSellRefund(towerId)).toEqual({ coins: 3 });
    expect(game.resources.coins).toBe(94);

    expect(game.sellTower(towerId).ok).toBe(true);
    expect(game.resources.coins).toBe(97);
    expect(game.towers).toHaveLength(0);
    expect(game.getTowerIdAt({ q: 1, r: 0 })).toBeUndefined();
    expect(game.lastEvents).toContainEqual({ type: "towerSold", towerId, towerTypeId: "pelter", refund: { coins: 3 } });
  });

  it("refuses to sell the only support source of a dependent tower", () => {
    const content = buildContent();
    content.towers.beacon = {
      id: "beacon", label: "Beacon", cost: { coins: 1 }, footprintRadius: 0, range: 3,
      attack: { kind: "support", auraRadius: 3, unlocksTowerIds: ["ward"] }
    };
    content.towers.ward = {
      id: "ward", label: "Ward", cost: { coins: 1 }, footprintRadius: 0, range: 2, requiresAuraFrom: "beacon",
      attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
    };
    const game = new TowerDefenseGame({ missionId: "basic", content });
    expect(game.placeTower("beacon", { q: 1, r: 0 }).ok).toBe(true);
    const beaconId = game.towers[0]!.id;
    expect(game.placeTower("ward", { q: 2, r: 0 }).ok).toBe(true);
    expect(game.sellTower(beaconId)).toMatchObject({ ok: false, reasonKey: "reason.dependentsLoseAura" });
    expect(game.towers.map((tower) => tower.typeId)).toEqual(["beacon", "ward"]);
  });

  it("applies authored wave, passive, interest, and early-start income deterministically", () => {
    const content = buildContent();
    content.missions.basic!.waves = [
      { id: "empty_1", label: "Empty 1", groups: [] },
      { id: "empty_2", label: "Empty 2", groups: [] }
    ];
    content.missions.basic!.prepTimeUnits = 5;
    content.missions.basic!.economy = {
      perWaveStart: { coins: 2 },
      perWaveClear: { coins: 5 },
      passivePerTimeUnit: { coins: 1 },
      interestRate: 0.1,
      interestCap: { coins: 10 },
      earlyStartBonusPerUnit: { coins: 3 }
    };
    const game = new TowerDefenseGame({ missionId: "basic", content });

    expect(game.startNextWave().ok).toBe(true);
    game.tick(0.2);
    expect(game.getSnapshot().clearedWaveCount).toBe(1);
    expect(game.startNextWave().ok).toBe(true);
    game.tick(0.2);

    const snapshot = game.getSnapshot();
    expect(snapshot.outcome).toBe("victory");
    expect(snapshot.clearedWaveCount).toBe(2);
    expect(snapshot.resources.coins).toBeCloseTo(148.8, 5);
    expect(snapshot.lastEvents.some((event) => event.type === "waveCleared" && event.waveIndex === 1)).toBe(true);
  });

  it("supports selling through the headless action contract", () => {
    const result = runHeadlessMission({
      content: buildContent(), missionId: "basic",
      actions: [
        { type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } },
        { type: "sellTower", towerId: "tower_1" }
      ]
    });
    expect(result.actionResults.every((item) => item.result.ok)).toBe(true);
    expect(result.snapshot.towers).toHaveLength(0);
    expect(result.snapshot.resources.coins).toBe(99.7);
  });

  it("wins from an authored survive objective and awards deterministic stars", () => {
    const content = buildContent();
    content.missions.basic!.objectives = {
      victory: [{ id: "hold", label: "Hold the line", kind: "surviveSeconds", seconds: 1 }],
      failure: [{ id: "late", kind: "timeLimit", seconds: 3 }],
      stars: [
        { id: "healthy", label: "Untouched core", kind: "coreHpAtLeast", amount: 20 },
        { id: "fast", label: "Quick hold", kind: "timeAtMost", seconds: 1.5 }
      ]
    };
    const game = new TowerDefenseGame({ missionId: "basic", content });
    game.startNextWave();
    for (let index = 0; index < 10 && game.outcome === "playing"; index += 1) game.tick(0.2);
    const snapshot = game.getSnapshot();
    expect(snapshot.outcome).toBe("victory");
    expect(snapshot.enemies.length).toBeGreaterThan(0);
    expect(snapshot.objectiveProgress).toContainEqual(expect.objectContaining({ id: "hold", complete: true }));
    expect(snapshot.stars).toEqual([
      { id: "healthy", label: "Untouched core", achieved: true },
      { id: "fast", label: "Quick hold", achieved: true }
    ]);
    expect(snapshot.lastEvents.filter((event) => event.type === "starEarned")).toHaveLength(2);
  });

  it("loses when an authored max-leaks condition is exceeded", () => {
    const content = buildContent();
    content.missions.leak!.startingCoreHp = 20;
    content.missions.leak!.objectives = {
      victory: [{ id: "clear", kind: "clearWaves" }],
      failure: [{ id: "perfect", label: "No leaks", kind: "maxLeaks", maxLeaks: 0 }]
    };
    const game = new TowerDefenseGame({ missionId: "leak", content });
    game.startNextWave();
    for (let index = 0; index < 200 && game.outcome === "playing"; index += 1) game.tick(0.2);
    const snapshot = game.getSnapshot();
    expect(snapshot.outcome).toBe("defeat");
    expect(snapshot.coreHp).toBeGreaterThan(0);
    expect(snapshot.leakCount).toBe(1);
    expect(snapshot.lastEvents).toContainEqual({ type: "objectiveFailed", objectiveId: "perfect", kind: "maxLeaks" });
  });

  it("can win by accumulating an authored resource target", () => {
    const content = buildContent();
    content.missions.basic!.economy = { passivePerTimeUnit: { coins: 2 } };
    content.missions.basic!.objectives = {
      victory: [{ id: "bank", kind: "accumulateResource", resourceId: "coins", amount: 101 }]
    };
    const game = new TowerDefenseGame({ missionId: "basic", content });
    game.startNextWave();
    for (let index = 0; index < 10 && game.outcome === "playing"; index += 1) game.tick(0.2);
    expect(game.getSnapshot()).toMatchObject({
      outcome: "victory",
      objectiveProgress: [expect.objectContaining({ id: "bank", complete: true })]
    });
  });

  // Arbitrary currencies: a tower priced in a non-coins currency spends/rewards that currency.
  it("tracks, spends, and rewards an author-defined currency beyond coins", () => {
    const reg = createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies: [{ id: "coins", label: "Coins" }, { id: "gems", label: "Gems" }],
        constants: {
          timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 100,
          startingResources: { coins: 100, gems: 3 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
          waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5,
          pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
        },
        abilities: { path_water: { id: "path_water", label: "Path Water", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { mob: { id: "mob", label: "Mob", maxHp: 1, speed: 0.5, reward: { coins: 2, gems: 1 }, coinReward: 2, coreDamage: 1, color: 1 } },
        towers: { gem: { id: "gem", label: "Gem Tower", cost: { gems: 2 }, footprintRadius: 0, range: 9, attack: { kind: "single", fireRate: 5, damagePerStack: 50, startingStacks: 1, maxStacks: 3, upgradeCost: 1 } } },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "mob", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 10, startingResources: { coins: 100, gems: 3 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "w", buildTowerIds: ["gem"], abilityIds: [] } }
      },
      maps: { lane: { id: "lane", width: 6, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 }, pathCenterline: [{ q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 3, r: 1 }, { q: 4, r: 1 }, { q: 5, r: 1 }], pathRoutes: [], terrainOverrides: [{ q: 1, r: 1, terrain: "path" }, { q: 2, r: 1, terrain: "path" }, { q: 3, r: 1, terrain: "path" }, { q: 4, r: 1, terrain: "path" }] } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
    const game = new TowerDefenseGame({ missionId: "m", content: reg });
    expect(game.resources.gems).toBe(3);
    expect(game.placeTower("gem", { q: 2, r: 0 }).ok).toBe(true);
    expect(game.resources.gems).toBe(1); // spent 2 gems
    expect(game.resources.coins).toBe(100); // coins untouched
    game.resources.gems = 0;
    expect(game.canPlaceTowerAnywhere("gem").reason).toContain("Gems"); // label-aware message
    game.resources.gems = 1;
    game.startNextWave();
    tickFor(game, 20);
    expect(game.resources.gems).toBeGreaterThan(1); // gem reward on kill
  });

  // Data-driven on-hit status effects (content-agnostic): any damaging tower can stun/poison/slow.
  function statusContent(towerAttack: SingleAttackModel, enemyHp = 200, enemySpeed = 0.6) {
    return createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies: [{ id: "coins", label: "Coins" }],
        constants: { timeUnitSeconds: 1, startingCoreHp: 30, startingCoins: 100, startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { tank: { id: "tank", label: "Tank", maxHp: enemyHp, speed: enemySpeed, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: { t: { id: "t", label: "T", cost: { coins: 1 }, footprintRadius: 0, range: 12, attack: towerAttack } },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "tank", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 30, startingResources: { coins: 100 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "w", buildTowerIds: ["t"], abilityIds: [] } }
      },
      maps: { lane: { id: "lane", width: 12, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 11, r: 1 }, pathCenterline: Array.from({ length: 12 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: Array.from({ length: 10 }, (_, i) => ({ q: i + 1, r: 1, terrain: "path" as const })) } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
  }

  it("stuns enemies via attack.statusOnHit — a stunned enemy is frozen in place", () => {
    // Low damage so the tank survives; high stun so it's perpetually re-frozen near spawn.
    const reg = statusContent({ kind: "single", fireRate: 2, damagePerStack: 3, startingStacks: 1, maxStacks: 1, upgradeCost: 1, statusOnHit: { stun: 4 } }, 400, 0.8);
    const game = new TowerDefenseGame({ missionId: "m", content: reg });
    expect(game.placeTower("t", { q: 2, r: 0 }).ok).toBe(true);
    game.startNextWave();
    tickFor(game, 25);
    const enemy = game.getSnapshot().enemies[0];
    expect(enemy, "tank should still be alive (chipped slowly while frozen)").toBeTruthy();
    expect(enemy!.statuses?.stun?.remaining ?? 0).toBeGreaterThan(0); // actively stunned
    expect(enemy!.pathProgress).toBeLessThan(2); // frozen near spawn, did not advance down the lane
  });

  it("poisons enemies via attack.statusOnHit — DoT keeps damaging and can kill after hits stop", () => {
    // Tiny direct damage but strong poison: the kill is only possible via the lingering DoT.
    const reg = statusContent({ kind: "single", fireRate: 0.5, damagePerStack: 2, startingStacks: 1, maxStacks: 1, upgradeCost: 1, statusOnHit: { poison: { dps: 12, duration: 40 } } }, 100, 0.5);
    const game = new TowerDefenseGame({ missionId: "m", content: reg });
    expect(game.placeTower("t", { q: 2, r: 0 }).ok).toBe(true);
    game.startNextWave();
    // After the first hit (~t=2) the enemy carries poison; confirm DoT is ticking its HP down.
    tickFor(game, 4);
    const mid = game.getSnapshot().enemies[0];
    expect(mid?.statuses?.poison?.remaining ?? 0).toBeGreaterThan(0);
    expect(mid!.hp).toBeLessThan(96); // > the ~2 direct damage dealt so far → poison contributed
    tickFor(game, 16);
    expect(game.getSnapshot().enemies.length).toBe(0); // poison finished it off before it leaked
  });

  it("lets an author opt flying enemies into splash damage and slow without changing the ground-only default", () => {
    const run = (affectsClasses?: Array<"ground" | "flying">) => {
      const reg = buildContent();
      reg.enemies.flier = {
        id: "flier", label: "Flier", maxHp: 100, speed: 0.2, reward: { coins: 1 }, coinReward: 1,
        coreDamage: 1, color: 0x99aaff, movementKind: "direct_flying", targetClass: "flying"
      };
      reg.towers.mortar = {
        id: "mortar", label: "Mortar", cost: { coins: 1 }, footprintRadius: 0, range: 8,
        attack: {
          kind: "splash", interval: 1, damage: 1, splashDamage: 5, armoredChipDamage: 0,
          splashRadius: 2, slowFactor: 0.5, slowDuration: 3, ...(affectsClasses ? { affectsClasses } : {})
        }
      };
      reg.waveSets.mixed = [{ id: "w1", label: "W1", groups: [
        { enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 },
        { enemyId: "flier", count: 1, spawnInterval: 1, startDelay: 0 }
      ] }];
      const baseMission = reg.missions.basic!;
      reg.missions.mixed = {
        ...baseMission,
        id: "mixed",
        label: "Mixed",
        mapId: baseMission.mapId!,
        mapFactory: baseMission.mapFactory!,
        abilityIds: baseMission.abilityIds ?? [],
        waveSetId: "mixed",
        waves: reg.waveSets.mixed,
        buildTowerIds: ["mortar"]
      };
      const game = new TowerDefenseGame({ missionId: "mixed", content: reg });
      expect(game.placeTower("mortar", { q: 1, r: 0 }).ok).toBe(true);
      game.startNextWave();
      tickFor(game, 1);
      return game.getSnapshot().enemies.find((enemy) => enemy.typeId === "flier");
    };

    const legacy = run();
    expect(legacy?.hp).toBe(100);
    expect(legacy?.statuses?.slow).toBeUndefined();
    const configured = run(["ground", "flying"]);
    expect(configured?.hp).toBeLessThan(100);
    expect(configured?.statuses?.slow?.remaining ?? 0).toBeGreaterThan(0);
  });

  it("scales tower damage by the enemy's resistance for the attack's damage type", () => {
    const damageDealt = (resistances?: Record<string, number>) => {
      const reg = createGameContentRegistry({
        balance: {
          defaultMissionId: "m",
          currencies: [{ id: "coins", label: "Coins" }],
          constants: { timeUnitSeconds: 1, startingCoreHp: 30, startingCoins: 100, startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
          abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
          enemies: { tank: { id: "tank", label: "Tank", maxHp: 1000, speed: 0.4, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1, ...(resistances ? { resistances } : {}) } },
          towers: { t: { id: "t", label: "T", cost: { coins: 1 }, footprintRadius: 0, range: 12, attack: { kind: "single", damageType: "fire", fireRate: 2, damagePerStack: 10, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } } },
          waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "tank", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
          missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 30, startingResources: { coins: 100 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "w", buildTowerIds: ["t"], abilityIds: [] } }
        },
        maps: { lane: { id: "lane", width: 12, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 11, r: 1 }, pathCenterline: Array.from({ length: 12 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: Array.from({ length: 10 }, (_, i) => ({ q: i + 1, r: 1, terrain: "path" as const })) } },
        worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
      });
      const game = new TowerDefenseGame({ missionId: "m", content: reg });
      game.placeTower("t", { q: 2, r: 0 });
      game.startNextWave();
      tickFor(game, 15);
      return 1000 - game.getSnapshot().enemies[0]!.hp; // total damage taken
    };

    const neutral = damageDealt();
    expect(neutral).toBeGreaterThan(0);
    expect(damageDealt({ fire: 0.5 })).toBeCloseTo(neutral * 0.5, 4); // resists fire → half damage
    expect(damageDealt({ fire: 2 })).toBeCloseTo(neutral * 2, 4);     // weak to fire → double damage
    expect(damageDealt({ ice: 0.5 })).toBeCloseTo(neutral, 4);        // resistance to a different type → unaffected
  });

  it("lets a boss enemy disrupt (silence) towers within range", () => {
    const reg = createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies: [{ id: "coins", label: "Coins" }],
        constants: { timeUnitSeconds: 1, startingCoreHp: 100, startingCoins: 100, startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { boss: { id: "boss", label: "Boss", maxHp: 500, speed: 0.3, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1, towerDisrupt: { interval: 2, radius: 4, duration: 6 } } },
        towers: { t: { id: "t", label: "T", cost: { coins: 1 }, footprintRadius: 0, range: 12, attack: { kind: "single", fireRate: 2, damagePerStack: 5, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } } },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "boss", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 100, startingResources: { coins: 100 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "w", buildTowerIds: ["t"], abilityIds: [] } }
      },
      maps: { lane: { id: "lane", width: 12, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 11, r: 1 }, pathCenterline: Array.from({ length: 12 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: Array.from({ length: 10 }, (_, i) => ({ q: i + 1, r: 1, terrain: "path" as const })) } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
    const game = new TowerDefenseGame({ missionId: "m", content: reg });
    expect(game.placeTower("t", { q: 2, r: 0 }).ok).toBe(true);
    const towerId = game.getSnapshot().towers[0]!.id;
    game.startNextWave();

    let sawDisruptEvent = false;
    let sawDisabled = false;
    for (let i = 0; i < 40; i++) {
      game.tick(0.5);
      if (game.lastEvents.some((e) => e.type === "towerDisrupted" && e.towerIds.includes(towerId))) sawDisruptEvent = true;
      if ((game.getSnapshot().towers[0]?.disabledFor ?? 0) > 0) sawDisabled = true;
    }
    expect(sawDisruptEvent).toBe(true); // the boss pulsed a disrupt hitting the tower
    expect(sawDisabled).toBe(true);     // the tower was silenced at some point
  });

  it("lets a boss enemy damage towers via towerAttack and destroy them at 0 HP", () => {
    const reg = createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies: [{ id: "coins", label: "Coins" }],
        constants: { timeUnitSeconds: 1, startingCoreHp: 100, startingCoins: 100, startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { boss: { id: "boss", label: "Boss", maxHp: 1000, speed: 0.25, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1, towerAttack: { interval: 2, damage: 50, range: 5 } } },
        towers: { t: { id: "t", label: "T", cost: { coins: 1 }, footprintRadius: 0, range: 1, maxHp: 100, attack: { kind: "single", fireRate: 0.1, damagePerStack: 1, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } } },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "boss", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 100, startingResources: { coins: 100 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "w", buildTowerIds: ["t"], abilityIds: [] } }
      },
      maps: { lane: { id: "lane", width: 12, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 11, r: 1 }, pathCenterline: Array.from({ length: 12 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: Array.from({ length: 10 }, (_, i) => ({ q: i + 1, r: 1, terrain: "path" as const })) } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
    const game = new TowerDefenseGame({ missionId: "m", content: reg });
    expect(game.placeTower("t", { q: 2, r: 0 }).ok).toBe(true);
    expect(game.getSnapshot().towers[0]!.hp).toBe(100); // hp initialized to maxHp
    game.startNextWave();

    let attacked = false;
    let destroyed = false;
    for (let i = 0; i < 60; i++) {
      game.tick(0.5);
      for (const e of game.lastEvents) {
        if (e.type === "towerAttacked" && e.towerId === "tower_1") attacked = true;
        if (e.type === "towerDestroyed" && e.towerId === "tower_1") destroyed = true;
      }
    }
    expect(attacked).toBe(true);  // boss damaged the tower
    expect(destroyed).toBe(true); // and destroyed it once hp hit 0
    expect(game.getSnapshot().towers.length).toBe(0); // removed from the board
    expect(game.getTowerIdAt({ q: 2, r: 0 })).toBeUndefined(); // tile freed for rebuilding
  });

  it("supports strike (AoE damage) and freeze (AoE stun) mission abilities with cooldowns", () => {
    const reg = createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies: [{ id: "coins", label: "Coins" }],
        constants: { timeUnitSeconds: 1, startingCoreHp: 100, startingCoins: 100, startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: {
          strike: { id: "strike", label: "Strike", cooldown: 20, duration: 0, radius: 3, damage: 50 },
          freeze: { id: "freeze", label: "Freeze", cooldown: 20, duration: 0, radius: 3, stunDuration: 5 }
        },
        enemies: { mob: { id: "mob", label: "Mob", maxHp: 300, speed: 0.2, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: { t: { id: "t", label: "T", cost: { coins: 1 }, footprintRadius: 0, range: 3, attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } } },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "mob", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 100, startingResources: { coins: 100 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "w", buildTowerIds: ["t"], abilityIds: ["strike", "freeze"] } }
      },
      maps: { lane: { id: "lane", width: 12, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 11, r: 1 }, pathCenterline: Array.from({ length: 12 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: Array.from({ length: 10 }, (_, i) => ({ q: i + 1, r: 1, terrain: "path" as const })) } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
    const game = new TowerDefenseGame({ missionId: "m", content: reg });
    game.startNextWave();
    game.tick(1); // spawn the enemy near the start
    const at = { q: 0, r: 1 };

    const before = game.getSnapshot().enemies[0]!.hp;
    expect(game.useAbility("strike", at).ok).toBe(true);
    expect(game.getSnapshot().enemies[0]!.hp).toBe(before - 50); // AoE damage applied
    expect(game.useAbility("strike", at).ok).toBe(false);        // now on cooldown

    expect(game.useAbility("freeze", at).ok).toBe(true);
    expect(game.getSnapshot().enemies[0]!.statuses?.stun?.remaining ?? 0).toBeGreaterThan(0); // stunned

    const headless = runHeadlessMission({
      content: reg,
      missionId: "m",
      tickStep: 1,
      actions: [
        { type: "startWave" },
        { type: "tick", units: 1 },
        { type: "useAbility", abilityId: "strike", center: at },
        { type: "useAbility", abilityId: "freeze", center: at }
      ]
    });
    expect(headless.actionResults[2]!.result.ok).toBe(true);
    expect(headless.actionResults[2]!.snapshot.enemies[0]!.hp).toBe(250);
    expect(headless.actionResults[3]!.result.ok).toBe(true);
    expect(headless.actionResults[3]!.snapshot.enemies[0]!.statuses?.stun?.remaining ?? 0).toBeGreaterThan(0);
  });

  it("guarantees coins as the first currency and dedupes the declared set", () => {
    const reg = createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies: [{ id: "gems", label: "Gems" }, { id: "coins", label: "Coins" }, { id: "gems", label: "Dup" }],
        constants: { timeUnitSeconds: 1, startingCoreHp: 5, startingCoins: 0, startingResources: { coins: 0 }, prepTimeUnits: 0, moveTowerCost: { coins: 0 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: {},
        towers: {},
        waveSets: { w: [] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 5, startingResources: { coins: 0 }, prepTimeUnits: 0, mapId: "lane", waveSetId: "w", buildTowerIds: [], abilityIds: [] } }
      },
      maps: { lane: { id: "lane", width: 3, height: 1, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 2, r: 0 }, pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], pathRoutes: [], terrainOverrides: [] } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
    const game = new TowerDefenseGame({ missionId: "m", content: reg });
    expect(game.currencies.map((c) => c.id)).toEqual(["coins", "gems"]); // coins reordered to front, duplicate dropped
  });

  it("lets the core take damage and declares defeat when enemies leak", () => {
    const game = new TowerDefenseGame({ missionId: "leak", content: buildContent() });
    expect(game.startNextWave().ok).toBe(true);
    tickFor(game, 30);
    const snap = game.getSnapshot();
    expect(snap.coreHp).toBeLessThan(game.mission.startingCoreHp);
    expect(snap.outcome).toBe("defeat");
  });

  // Regression for #1: target mode keyed on attack.kind, not the literal id "sniper".
  it("allows setting target mode on any sniper-kind tower regardless of id", () => {
    const game = new TowerDefenseGame({ missionId: "basic", content: buildContent() });
    expect(game.placeTower("sniper", { q: 2, r: 0 }).ok).toBe(true);
    const towerId = game.getSnapshot().towers[0]!.id;
    const result = game.setTowerTargetMode(towerId, "largest_hp");
    expect(result.ok).toBe(true);
    expect(game.getSnapshot().towers[0]!.targetMode).toBe("largest_hp");
  });

  it("allows target modes on non-sniper attacking towers", () => {
    const game = new TowerDefenseGame({ missionId: "basic", content: buildContent() });
    expect(game.placeTower("pelter", { q: 2, r: 0 }).ok).toBe(true);
    const towerId = game.getSnapshot().towers[0]!.id;
    const result = game.setTowerTargetMode(towerId, "weakest");
    expect(result.ok).toBe(true);
    expect(game.getSnapshot().towers[0]!.targetMode).toBe("weakest");
  });

  it("refuses target mode on area-all towers and unknown modes", () => {
    const game = new TowerDefenseGame({ missionId: "dot", content: buildContent() });
    expect(game.placeTower("sprayer", { q: 0, r: 0 }).ok).toBe(true);
    const towerId = game.getSnapshot().towers[0]!.id;
    const result = game.setTowerTargetMode(towerId, "strongest");
    expect(result.ok).toBe(false);
    expect(result.reasonKey).toBe("reason.targetModeUnsupported");

    const other = new TowerDefenseGame({ missionId: "basic", content: buildContent() });
    expect(other.placeTower("pelter", { q: 2, r: 0 }).ok).toBe(true);
    expect(other.setTowerTargetMode(other.getSnapshot().towers[0]!.id, "random" as never)).toMatchObject({ ok: false, reasonKey: "reason.targetModeUnknown" });
  });

  it("uses strongest and weakest priorities deterministically", () => {
    const firstHit = (mode: "strongest" | "weakest") => {
      const game = new TowerDefenseGame({ missionId: "targeting", content: buildContent() });
      expect(game.placeTower("pelter", { q: 2, r: 0 }).ok).toBe(true);
      expect(game.setTowerTargetMode(game.getSnapshot().towers[0]!.id, mode).ok).toBe(true);
      expect(game.startNextWave().ok).toBe(true);
      game.tick(0.05);
      return game.getSnapshot().lastEvents.find((event) => event.type === "enemyHit")?.enemyTypeId;
    };
    expect(firstHit("strongest")).toBe("tank");
    expect(firstHit("weakest")).toBe("grunt");
  });

  // Regression for #2: dots from a renamed pulse tower keep ticking after the enemy leaves the aura.
  it("applies lingering dot damage from a pulse-kind tower with a custom id", () => {
    const game = new TowerDefenseGame({ missionId: "dot", content: buildContent() });
    expect(game.placeTower("sprayer", { q: 0, r: 0 }).ok).toBe(true);
    expect(game.startNextWave().ok).toBe(true);

    let recordedSource: string | undefined;
    let recordedDamage: number | undefined;
    let hpWhenDotd = Infinity;
    // Advance until the sponge has been infected, capturing the dot bookkeeping.
    for (let i = 0; i < 40 && recordedSource === undefined; i += 1) {
      game.tick(0.25);
      const enemy = game.getSnapshot().enemies.find((e) => e.typeId === "sponge");
      if (enemy && enemy.dotRemaining > 0) {
        recordedSource = enemy.dotSourceTowerTypeId;
        recordedDamage = enemy.dotDamagePerUnit;
        hpWhenDotd = enemy.hp;
      }
    }

    expect(recordedSource).toBe("sprayer");
    expect(recordedDamage).toBe(5);

    // Keep ticking; once the sponge is out of the (range-1) aura, dots must still erode its HP.
    tickFor(game, 6);
    const enemy = game.getSnapshot().enemies.find((e) => e.typeId === "sponge");
    expect(enemy).toBeDefined();
    expect(enemy!.hp).toBeLessThan(hpWhenDotd);
  });

  // Regression: pierce_only armor is pierced by attack.kind, not the literal tower id "sniper".
  it("pierces pierce_only armor with any sniper-kind tower, blocks others", () => {
    const pierced = new TowerDefenseGame({ missionId: "armored", content: buildContent() });
    expect(pierced.placeTower("sniper", { q: 4, r: 0 }).ok).toBe(true); // sniper kind, id "sniper"
    expect(pierced.startNextWave().ok).toBe(true);
    tickFor(pierced, 20);
    expect(pierced.getSnapshot().outcome).toBe("victory");

    const blocked = new TowerDefenseGame({ missionId: "armored", content: buildContent() });
    expect(blocked.placeTower("pelter", { q: 4, r: 0 }).ok).toBe(true); // single kind cannot pierce
    expect(blocked.startNextWave().ok).toBe(true);
    tickFor(blocked, 20);
    expect(blocked.getSnapshot().outcome).toBe("defeat");
  });

  // Regression for #3: path blocking is driven by the isPathBlocker flag, not hardcoded enemy ids.
  it("steers following enemies around isPathBlocker enemies", () => {
    const game = new TowerDefenseGame({ missionId: "blocker", content: buildContent() });
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

  it("executes declarative tower targeting, area delivery, and ordered effects", () => {
    const content = buildContent();
    content.towers.conduit = {
      id: "conduit",
      label: "Conduit",
      cost: { coins: 1 },
      footprintRadius: 0,
      range: 8,
      attack: {
        kind: "pipeline",
        interval: 1,
        targeting: { classes: ["ground"], mode: "strongest" },
        delivery: { kind: "area", radius: 2, secondaryMultiplier: 0.5 },
        effects: [
          { kind: "damage", amount: 10, damageType: "arcane", armorPiercing: true },
          { kind: "status", status: { stun: 2 } }
        ]
      }
    };
    content.missions.targeting!.buildTowerIds.push("conduit");
    const game = new TowerDefenseGame({ missionId: "targeting", content });
    expect(game.placeTower("conduit", { q: 1, r: 0 }).ok).toBe(true);
    expect(game.startNextWave().ok).toBe(true);
    game.tick(0.1);

    const enemies = game.getSnapshot().enemies;
    expect(enemies).toHaveLength(2);
    expect(enemies.every((enemy) => enemy.hp < enemy.maxHp)).toBe(true);
    expect(enemies.every((enemy) => (enemy.statuses?.stun?.remaining ?? 0) > 0)).toBe(true);
    expect(game.lastEvents.filter((event) => event.type === "towerFired")).toHaveLength(2);
  });

  it("applies selected difficulty and persistent meta upgrades as launch-time inputs", () => {
    const content = buildContent();
    content.difficulties = [
      { id: "normal", label: "Normal" },
      { id: "veteran", label: "Veteran", enemyHpMultiplier: 2, enemySpeedMultiplier: 1.25, startingResourceMultiplier: 0.5, coreHpMultiplier: 1.5 }
    ];
    content.defaultDifficultyId = "normal";
    content.metaProgression = {
      currencies: [{ id: "shards", label: "Shards" }],
      rewardsByMission: {},
      upgrades: {
        foundation: {
          id: "foundation", label: "Foundation", maxLevel: 2,
          costs: [{ shards: 1 }, { shards: 2 }],
          effects: [{ kind: "coreHp", amountPerLevel: 2 }, { kind: "startingResource", resourceId: "coins", amountPerLevel: 10 }]
        }
      }
    };
    const game = new TowerDefenseGame({ missionId: "basic", content, difficultyId: "veteran", metaUpgradeLevels: { foundation: 2 } });
    const beforeWave = game.getSnapshot();
    expect(beforeWave.difficultyId).toBe("veteran");
    expect(beforeWave.maxCoreHp).toBe(34);
    expect(beforeWave.resources.coins).toBe(70);
    game.startNextWave();
    game.tick(0.1);
    expect(game.getSnapshot().enemies[0]?.maxHp).toBe(12);
  });

  it("executes deterministic global and object-bound TowerScripts", () => {
    const content = buildContent();
    content.scripts = {
      authored_rules: {
        schemaVersion: 1,
        id: "authored_rules",
        bindings: [{ scope: "global" }, { scope: "tower", ids: ["pelter"] }, { scope: "enemy", ids: ["grunt"] }],
        initialState: { executions: 0 },
        handlers: {
          gameStarted: [{ actions: [{ action: "grantResource", resourceId: "coins", amount: 5 }] }],
          towerPlaced: [{
            when: { $op: "eq", args: [{ $get: "self.typeId" }, "pelter"] },
            actions: [{ action: "grantResource", resourceId: "coins", amount: 3 }, { action: "incrementState", key: "executions" }]
          }],
          waveStarted: [{ actions: [{ action: "emitSignal", signal: "wave_bonus", payload: { $get: "event.waveIndex" } }] }],
          signal: [{
            when: { $op: "eq", args: [{ $get: "event.signal" }, "wave_bonus"] },
            actions: [{ action: "grantResource", resourceId: "coins", amount: 2 }]
          }],
          tick: [{ every: 0.1, actions: [{ action: "damageEnemy", target: "self", amount: 100 }] }],
          enemyKilled: [{
            when: { $op: "eq", args: [{ $get: "self.typeId" }, "grunt"] },
            actions: [{ action: "grantResource", resourceId: "coins", amount: 7 }, { action: "incrementState", key: "executions" }]
          }]
        }
      },
      external_bridge: {
        schemaVersion: 1,
        id: "external_bridge",
        bindings: [{ scope: "wave", ids: ["oneGrunt"] }],
        initialState: { starts: 0 },
        handlers: {
          waveStarted: [{ actions: [{ action: "incrementState", key: "starts" }] }],
          signal: [{
            when: { $op: "eq", args: [{ $get: "event.signal" }, "author_bonus"] },
            actions: [{ action: "grantResource", resourceId: "coins", amount: { $get: "event.payload.amount" } }]
          }]
        }
      }
    };

    const game = new TowerDefenseGame({ missionId: "basic", content });
    expect(game.coins).toBe(105);
    expect(game.placeTower("pelter", { q: 1, r: 0 }).ok).toBe(true);
    expect(game.coins).toBe(107);
    expect(game.startNextWave().ok).toBe(true);
    expect(game.coins).toBe(109);
    expect(game.emitScriptSignal("author_bonus", { amount: 11 }).ok).toBe(true);
    expect(game.emitScriptSignal("bad signal", null).ok).toBe(false);
    game.tick(0.1);

    const snapshot = game.getSnapshot();
    expect(snapshot.outcome).toBe("victory");
    expect(snapshot.scriptState.values.authored_rules?.["tower:tower_1"]?.executions).toBe(1);
    expect(snapshot.scriptState.values.authored_rules?.["enemy:enemy_1"]?.executions).toBe(1);
    expect(snapshot.scriptState.values.external_bridge?.["wave:oneGrunt"]?.starts).toBe(1);
    expect(snapshot.scriptState.diagnostics).toEqual([]);
    expect(game.coins).toBe(129); // +11 external signal, +2 normal kill reward, +7 scripted reward
    expect(game.lastEvents.some((event) => event.type === "scriptSignal" && event.signal === "wave_bonus")).toBe(false); // action events reset on tick
  });
});

describe("deferred death near the core (regression)", () => {
  function strikeContent(): ReturnType<typeof createGameContentRegistry> {
    return createGameContentRegistry({
      balance: {
        defaultMissionId: "basic",
        constants: {
          timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100, startingResources: { coins: 100 },
          prepTimeUnits: 5, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
          pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.3
        },
        abilities: { strike: { id: "strike", label: "Strike", cooldown: 1, duration: 0, radius: 10, damage: 100 } },
        enemies: { grunt: { id: "grunt", label: "Grunt", maxHp: 6, speed: 1, reward: { coins: 2 }, coinReward: 2, coreDamage: 5, color: 0x88aa66 } },
        towers: { pelter: { id: "pelter", label: "Pelter", cost: { coins: 1 }, footprintRadius: 0, range: 8, attack: { kind: "single", fireRate: 5, damagePerStack: 5, startingStacks: 3, maxStacks: 8, upgradeCost: 5 } } },
        waveSets: { oneGrunt: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { basic: { id: "basic", label: "basic", description: "", startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 5, mapId: "lane", waveSetId: "oneGrunt", buildTowerIds: ["pelter"], abilityIds: ["strike"] } }
      },
      maps: { lane: { id: "lane", width: 9, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 8, r: 1 }, pathCenterline: Array.from({ length: 9 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: [] } },
      worldMap: { width: 100, height: 100, regions: [{ id: "reg", label: "Reg", description: "", bounds: { x: 0, y: 0, width: 100, height: 100 }, accent: "#88aa66", biome: "t", connections: [] }], missionNodes: [{ missionId: "basic", regionId: "reg", x: 50, y: 50, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
  }

  // An enemy killed by an ability the tick before it would reach the core used to keep moving,
  // "leak" into the core (dealing core damage), and forfeit its kill reward — because moveEnemies()
  // advanced already-dead enemies before removeDeadEnemies() could reap them.
  it("rewards (and does not leak) an enemy killed by an ability just before the core", () => {
    const game = new TowerDefenseGame({ missionId: "basic", content: strikeContent() });
    game.startNextWave();
    game.tick(0.1); // spawn the grunt
    const enemy = game.getSnapshot().enemies[0]!;
    game.enemies[0]!.pathProgress = 7.95; // one hex short of the core (track end index 8)

    const coreBefore = game.coreHp;
    const coinsBefore = game.coins;
    expect(game.useAbility("strike", { q: 8, r: 1 }).ok).toBe(true);
    expect(game.enemies[0]!.hp).toBeLessThanOrEqual(0); // killed, removal deferred to next tick

    game.tick(0.1);
    const events = game.lastEvents;
    expect(events.some((e) => e.type === "enemyLeaked")).toBe(false); // did NOT leak
    expect(game.coreHp).toBe(coreBefore); // no core damage from the dead enemy
    const killed = events.find((e): e is Extract<typeof events[number], { type: "enemyKilled" }> => e.type === "enemyKilled" && e.enemyId === enemy.id);
    expect(killed).toBeTruthy(); // counted as a kill...
    expect(game.coins).toBe(coinsBefore + 2); // ...and rewarded
    expect(game.enemies).toHaveLength(0);
  });
});
