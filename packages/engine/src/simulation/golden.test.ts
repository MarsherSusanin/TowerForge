import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { runHeadlessMission, type SimulationAction } from "./headless.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GameEvent, GameSnapshot, MissionAbilityId } from "./types.js";

// ── Wave A safety net ───────────────────────────────────────────────────────
// (1) A determinism test: the SAME scripted mission run twice from scratch must produce a
//     byte-identical final GameSnapshot. This is the project's hardest invariant (no RNG, no
//     Date.now/Math.random) and until now it was enforced only by code review.
// (2) A committed golden snapshot: a regression net so a future refactor (e.g. collapsing the
//     closed attack-kind union into a composable effect pipeline) has to positively confirm it
//     preserves behavior, rather than silently drifting.
// (3) One conformance fixture per mechanic that had ZERO test coverage before this file:
//     healAura, phaseSpawns, spawnOnDeath, antiair, splash, support (aura-gated placement), and
//     support_buff (aura fire-rate boost). statusOnHit/resistance/armor/towerDisrupt/towerAttack/
//     currencies/abilities are already covered in TowerDefenseGame.test.ts and are not duplicated.

const BASE_CONSTANTS = {
  timeUnitSeconds: 1,
  startingCoreHp: 30,
  startingCoins: 200,
  startingResources: { coins: 200 },
  prepTimeUnits: 0,
  moveTowerCost: { coins: 1 },
  waterGroundSpeedFactor: 0.5,
  pathWaterCooldownUnits: 10,
  pathWaterDurationUnits: 5,
  pathWaterRadius: 1,
  pathWaterGroundSpeedFactor: 0.5
};

// A 9-wide single-lane map (matches the idiom used throughout TowerDefenseGame.test.ts), plus a
// buildable row on either side (r=0, r=2) for off-lane support/aura towers.
function laneMap(width = 9) {
  return {
    id: "lane",
    width,
    height: 3,
    defaultTerrain: "buildable" as const,
    spawnCoord: { q: 0, r: 1 },
    coreCoord: { q: width - 1, r: 1 },
    pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: 1 })),
    pathRoutes: [],
    terrainOverrides: Array.from({ length: width - 2 }, (_, i) => ({ q: i + 1, r: 1, terrain: "path" as const }))
  };
}

function worldMapFor(missionIds: string[]) {
  return {
    width: 100,
    height: 100,
    regions: [{ id: "reg", label: "Reg", description: "", bounds: { x: 0, y: 0, width: 100, height: 100 }, accent: "#88aa66", biome: "t", connections: [] }],
    missionNodes: missionIds.map((id) => ({ missionId: id, regionId: "reg", x: 50, y: 50, difficulty: 1 as const, unlockRequiresMissionIds: [] }))
  };
}

function mission(id: string, waveSetId: string, buildTowerIds: string[], startingCoreHp = 30, abilityIds: MissionAbilityId[] = []) {
  return {
    id,
    label: id,
    description: "",
    startingCoreHp,
    startingResources: { coins: 200 },
    prepTimeUnits: 0,
    mapId: "lane",
    waveSetId,
    buildTowerIds,
    abilityIds
  };
}

function tick(game: TowerDefenseGame, units: number, step = 0.25): void {
  for (let elapsed = 0; elapsed < units; elapsed += step) {
    game.tick(Math.min(step, units - elapsed));
  }
}

/** Ticks in small steps and returns every GameEvent emitted along the way (lastEvents resets each tick()). */
function tickCollectingEvents(game: TowerDefenseGame, units: number, step = 0.25): GameEvent[] {
  const collected: GameEvent[] = [];
  for (let elapsed = 0; elapsed < units; elapsed += step) {
    game.tick(Math.min(step, units - elapsed));
    collected.push(...game.lastEvents);
  }
  return collected;
}

// ── (1) + (2): determinism + committed golden snapshot ─────────────────────

function goldenContent() {
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "golden",
      currencies: [{ id: "coins", label: "Coins" }, { id: "gems", label: "Gems" }],
      constants: { ...BASE_CONSTANTS, startingResources: { coins: 200, gems: 5 } },
      abilities: {
        path_water: { id: "path_water", label: "Water", cooldown: 10, duration: 5, radius: 1 },
        strike: { id: "strike", label: "Strike", cooldown: 8, duration: 0, radius: 2, damage: 30 }
      },
      enemies: {
        grunt: { id: "grunt", label: "Grunt", maxHp: 24, speed: 1, reward: { coins: 3 }, coinReward: 3, coreDamage: 1, color: 0x88aa66 },
        frost: {
          id: "frost", label: "Frost", maxHp: 40, speed: 0.8, reward: { coins: 4, gems: 1 }, coinReward: 4, coreDamage: 2, color: 0x66aacc,
          resistances: { fire: 0.25 }
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 10 }, footprintRadius: 0, range: 12,
          attack: { kind: "single", damageType: "fire", fireRate: 2, damagePerStack: 4, startingStacks: 1, maxStacks: 4, upgradeCost: 15 }
        },
        marksman: {
          id: "marksman", label: "Marksman", cost: { coins: 15 }, footprintRadius: 0, range: 12,
          attack: { kind: "sniper", interval: 1.5, damage: 9, targetPriority: "largest_hp" }
        }
      },
      waveSets: {
        golden: [
          { id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 2, spawnInterval: 1, startDelay: 0 }] },
          { id: "w2", label: "W2", groups: [{ enemyId: "frost", count: 2, spawnInterval: 1.2, startDelay: 0 }] }
        ]
      },
      missions: { golden: { ...mission("golden", "golden", ["pelter", "marksman"], 30), abilityIds: ["strike"] } }
    },
    maps: { lane: laneMap(9) },
    worldMap: worldMapFor(["golden"])
  };
  return createGameContentRegistry(input);
}

function runGoldenScript(): GameSnapshot {
  const game = new TowerDefenseGame({ missionId: "golden", content: goldenContent() });
  const actions: SimulationAction[] = [
    { type: "placeTower", towerTypeId: "pelter", coord: { q: 1, r: 0 } },
    { type: "placeTower", towerTypeId: "marksman", coord: { q: 4, r: 0 } },
    { type: "startWave" },
    { type: "tick", units: 4 },
    { type: "upgradeTower", towerId: "tower_1" },
    { type: "tick", units: 4 },
    { type: "useAbility", abilityId: "strike", center: { q: 4, r: 1 } },
    { type: "tick", units: 6 },
    { type: "startWave" },
    { type: "tick", units: 20 }
  ];
  return runHeadlessMission({ content: goldenContent(), missionId: "golden", actions }).snapshot;
}

describe("determinism (Wave A safety net)", () => {
  it("produces a byte-identical final snapshot across two independent runs of the same script", () => {
    const first = runGoldenScript();
    const second = runGoldenScript();
    expect(second).toEqual(first);
  });

  it("matches the committed golden snapshot", () => {
    const snapshot = runGoldenScript();
    // Deliberately drop nothing: a full-fidelity snapshot means any accidental behavior change
    // in the tick pipeline shows up as a diff here, forcing a reviewed `vitest -u`.
    expect(snapshot).toMatchSnapshot();
  });
});

describe("mechanic conformance: healAura", () => {
  function content(healerHasAura: boolean) {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: {
          grunt: { id: "grunt", label: "Grunt", maxHp: 100, speed: 0.5, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 },
          medic: {
            id: "medic", label: "Medic", maxHp: 100, speed: 0.5, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2,
            healAura: healerHasAura ? { radius: 4, healPerUnit: 6, includeSelf: false, stacks: true } : { radius: 0, healPerUnit: 0 }
          }
        },
        towers: {
          chip: { id: "chip", label: "Chip", cost: { coins: 1 }, footprintRadius: 0, range: 12, attack: { kind: "single", fireRate: 1, damagePerStack: 2, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } }
        },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0.1, startDelay: 0 }, { enemyId: "medic", count: 1, spawnInterval: 0.1, startDelay: 0.1 }] }] },
        missions: { m: mission("m", "w", ["chip"], 50) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  function finalGruntHp(withAura: boolean): number {
    const game = new TowerDefenseGame({ missionId: "m", content: content(withAura) });
    game.placeTower("chip", { q: 1, r: 0 });
    game.startNextWave();
    tick(game, 6);
    const grunt = game.getSnapshot().enemies.find((e) => e.typeId === "grunt");
    expect(grunt).toBeTruthy();
    return grunt!.hp;
  }

  it("heals a wounded nearby enemy back up faster than an identical run with no aura", () => {
    const withAura = finalGruntHp(true);
    const withoutAura = finalGruntHp(false);
    expect(withAura).toBeGreaterThan(withoutAura);
  });
});

describe("mechanic conformance: phaseSpawns", () => {
  function content() {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: {
          boss: {
            id: "boss", label: "Boss", maxHp: 100, speed: 0.4, reward: { coins: 10 }, coinReward: 10, coreDamage: 5, color: 1,
            phaseSpawns: [{ hpRatio: 0.5, enemyId: "minion", count: 2 }]
          },
          minion: { id: "minion", label: "Minion", maxHp: 5, speed: 0.6, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2 }
        },
        towers: {
          hammer: { id: "hammer", label: "Hammer", cost: { coins: 1 }, footprintRadius: 0, range: 12, attack: { kind: "single", fireRate: 2, damagePerStack: 4, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } }
        },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "boss", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: mission("m", "w", ["hammer"], 50) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  it("spawns children exactly once when the parent's hp ratio crosses the threshold", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content() });
    game.placeTower("hammer", { q: 1, r: 0 });
    game.startNextWave();
    const events = tickCollectingEvents(game, 14);

    const phaseSpawnEvents = events.filter((e): e is Extract<GameEvent, { type: "enemyPhaseSpawned" }> => e.type === "enemyPhaseSpawned");
    expect(phaseSpawnEvents).toHaveLength(1); // dedup via phaseSpawnsTriggered: must not refire
    expect(phaseSpawnEvents[0]!.enemyTypeId).toBe("minion");
    expect(phaseSpawnEvents[0]!.enemyIds).toHaveLength(2);
    // (minions are fragile and the tower keeps firing, so they may already be dead by the end of
    // the tick window — the event assertions above are the authoritative proof the phase fired.)
  });
});

describe("mechanic conformance: spawnOnDeath", () => {
  function content() {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: {
          carrier: {
            id: "carrier", label: "Carrier", maxHp: 10, speed: 0.5, reward: { coins: 2 }, coinReward: 2, coreDamage: 1, color: 1,
            spawnOnDeath: { enemyId: "spawnling", count: 2, forwardPathSteps: 0 }
          },
          spawnling: { id: "spawnling", label: "Spawnling", maxHp: 5, speed: 0.5, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2 }
        },
        towers: {
          hammer: { id: "hammer", label: "Hammer", cost: { coins: 1 }, footprintRadius: 0, range: 12, attack: { kind: "single", fireRate: 3, damagePerStack: 5, startingStacks: 1, maxStacks: 1, upgradeCost: 1 } }
        },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "carrier", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: mission("m", "w", ["hammer"], 50) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  it("spawns children when the parent dies mid-path (not on core-leak)", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content() });
    game.placeTower("hammer", { q: 1, r: 0 });
    game.startNextWave();
    const events = tickCollectingEvents(game, 8);

    const spawnEvents = events.filter((e): e is Extract<GameEvent, { type: "enemySpawnedOnDeath" }> => e.type === "enemySpawnedOnDeath");
    expect(spawnEvents).toHaveLength(1);
    expect(spawnEvents[0]!.enemyTypeId).toBe("spawnling");
    expect(spawnEvents[0]!.enemyIds).toHaveLength(2);
  });
});

describe("mechanic conformance: antiair", () => {
  function content() {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: {
          grunt: { id: "grunt", label: "Grunt", maxHp: 200, speed: 0.15, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 },
          flyer: { id: "flyer", label: "Flyer", maxHp: 10, speed: 0.15, reward: { coins: 3 }, coinReward: 3, coreDamage: 1, color: 2, targetClass: "flying" }
        },
        towers: {
          flak: {
            id: "flak", label: "Flak", cost: { coins: 1 }, footprintRadius: 0, range: 12,
            attack: { kind: "antiair", fireRate: 2, damage: 8, maxTargetsByLevel: [1, 2, 3, 4], upgradeCosts: [{ coins: 1 }, { coins: 1 }, { coins: 1 }] }
          }
        },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }, { enemyId: "flyer", count: 1, spawnInterval: 1, startDelay: 0.1 }] }] },
        missions: { m: mission("m", "w", ["flak"], 50) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  it("kills flying targets while leaving ground enemies completely untouched", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content() });
    game.placeTower("flak", { q: 1, r: 0 });
    game.startNextWave();
    tick(game, 6);

    const snapshot = game.getSnapshot();
    expect(snapshot.enemies.some((e) => e.typeId === "flyer")).toBe(false); // flyer was killed
    const grunt = snapshot.enemies.find((e) => e.typeId === "grunt");
    expect(grunt).toBeTruthy();
    expect(grunt!.hp).toBe(grunt!.maxHp); // ground enemy never targeted by an antiair tower
  });
});

describe("mechanic conformance: splash", () => {
  function content() {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: {
          swarmling: { id: "swarmling", label: "Swarmling", maxHp: 20, speed: 0.3, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 }
        },
        towers: {
          mortar: {
            id: "mortar", label: "Mortar", cost: { coins: 1 }, footprintRadius: 0, range: 12,
            attack: { kind: "splash", interval: 1, damage: 6, splashDamage: 4, armoredChipDamage: 1, splashRadius: 3, slowFactor: 0.5, slowDuration: 2 }
          }
        },
        // Four swarmlings spawned in quick succession stay clustered close together on the lane.
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "swarmling", count: 4, spawnInterval: 0.05, startDelay: 0 }] }] },
        missions: { m: mission("m", "w", ["mortar"], 50) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  it("damages more than one clustered enemy per shot and slows them", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content() });
    game.placeTower("mortar", { q: 1, r: 0 });
    game.startNextWave();
    const events = tickCollectingEvents(game, 3);

    const hitEnemyIds = new Set(
      events.filter((e): e is Extract<GameEvent, { type: "enemyHit" }> => e.type === "enemyHit").map((e) => e.enemyId)
    );
    expect(hitEnemyIds.size).toBeGreaterThan(1); // splash reached beyond the single primary target

    const slowed = game.getSnapshot().enemies.filter((e) => e.statuses?.slow && e.statuses.slow.remaining > 0);
    expect(slowed.length).toBeGreaterThan(0);
  });
});

describe("mechanic conformance: support (aura-gated placement)", () => {
  function content() {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { grunt: { id: "grunt", label: "Grunt", maxHp: 10, speed: 0.5, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: {
          beacon: {
            id: "beacon", label: "Beacon", cost: { coins: 1 }, footprintRadius: 0, range: 1,
            attack: { kind: "support", auraRadius: 2, unlocksTowerIds: ["elite"] }
          },
          elite: {
            id: "elite", label: "Elite", cost: { coins: 1 }, footprintRadius: 0, range: 12, requiresAuraFrom: "beacon",
            attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
          }
        },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: mission("m", "w", ["beacon", "elite"], 50) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  it("refuses a dependent tower with no support aura nearby, then allows it once in range", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content() });

    const beforeBeacon = game.placeTower("elite", { q: 1, r: 2 });
    expect(beforeBeacon.ok).toBe(false);
    expect(beforeBeacon.reasonKey).toBe("reason.needsAura");

    expect(game.placeTower("beacon", { q: 1, r: 0 }).ok).toBe(true); // auraRadius 2

    const inRange = game.placeTower("elite", { q: 1, r: 2 }); // hexDistance 2, within radius 2
    expect(inRange.ok).toBe(true);

    const outOfRange = game.placeTower("elite", { q: 8, r: 0 }); // hexDistance 7, outside radius 2
    expect(outOfRange.ok).toBe(false);
    expect(outOfRange.reasonKey).toBe("reason.needsAura");
  });
});

describe("mechanic conformance: support_buff (aura fire-rate boost)", () => {
  function content(placeAmp: boolean) {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { grunt: { id: "grunt", label: "Grunt", maxHp: 10000, speed: 0.2, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: {
          amp: {
            id: "amp", label: "Amp", cost: { coins: 1 }, footprintRadius: 0, range: 1,
            attack: { kind: "support_buff", auraRadius: 3, fireRateMultiplierByLevel: [3, 3, 3], affectsTowerIds: ["basic"] }
          },
          basic: {
            id: "basic", label: "Basic", cost: { coins: 1 }, footprintRadius: 0, range: 12,
            attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
          }
        },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: mission("m", "w", placeAmp ? ["amp", "basic"] : ["basic"], 50) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  function shotsFiredByBasic(placeAmp: boolean): number {
    const game = new TowerDefenseGame({ missionId: "m", content: content(placeAmp) });
    if (placeAmp) game.placeTower("amp", { q: 1, r: 0 }); // within auraRadius 3 of "basic" below
    game.placeTower("basic", { q: 1, r: 2 }); // hexDistance to {q:1,r:0} is 2, inside auraRadius 3
    game.startNextWave();
    const events = tickCollectingEvents(game, 6);
    return events.filter((e): e is Extract<GameEvent, { type: "towerFired" }> => e.type === "towerFired").length;
  }

  it("fires more shots with an amp tower in range than an identical setup without one", () => {
    const withAmp = shotsFiredByBasic(true);
    const withoutAmp = shotsFiredByBasic(false);
    expect(withAmp).toBeGreaterThan(withoutAmp);
  });
});

// ── 1.3: data-driven abilities ──────────────────────────────────────────────
// Proves the actual promise of the refactor: a BRAND NEW ability the engine has never heard of
// — not one of the path_water/strike/freeze presets — works purely from declared `effects`, with
// zero engine code. Composes damage AND status in a single ability, which the old hardcoded
// strike/freeze if-chain could never express (each was exactly one effect).
describe("mechanic conformance: custom data-driven ability (no preset, no engine code)", () => {
  function content() {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: {
          // Not "path_water"/"strike"/"freeze" — a wholly author-invented id, defined purely as
          // an effects composition: instant damage AND a lingering slow, in one ability.
          slam: {
            id: "slam", label: "Slam", cooldown: 10, duration: 0, radius: 3,
            effects: [
              { kind: "damage", amount: 15 },
              { kind: "status", status: { slow: { factor: 0.4, duration: 5 } } }
            ]
          },
          // A second custom ability proving poison (a tower-only mechanic until now) composes
          // into an ability too, via the same shared applyStatusEffect primitive.
          toxicCloud: {
            id: "toxicCloud", label: "Toxic Cloud", cooldown: 10, duration: 0, radius: 3,
            effects: [{ kind: "status", status: { poison: { dps: 4, duration: 5 } } }]
          }
        },
        enemies: { grunt: { id: "grunt", label: "Grunt", maxHp: 100, speed: 0.2, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: {},
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: mission("m", "w", [], 50, ["slam", "toxicCloud"]) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  it("applies a multi-effect custom ability (damage + slow) in one call", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content() });
    game.startNextWave();
    game.tick(1);
    const before = game.getSnapshot().enemies[0]!.hp;

    const result = game.useAbility("slam", { q: 1, r: 1 });
    expect(result.ok).toBe(true);

    const enemy = game.getSnapshot().enemies[0]!;
    expect(enemy.hp).toBe(before - 15); // the damage effect
    expect(enemy.statuses?.slow?.factor).toBe(0.4); // the status effect, same ability call
    expect(enemy.statuses?.slow?.remaining).toBeGreaterThan(0);
  });

  it("applies a custom poison-only ability via the shared status-effect primitive", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content() });
    game.startNextWave();
    game.tick(1);

    expect(game.useAbility("toxicCloud", { q: 1, r: 1 }).ok).toBe(true);
    const afterCast = game.getSnapshot().enemies[0]!;
    expect(afterCast.statuses?.poison?.dps).toBe(4);

    const hpAtCast = afterCast.hp;
    game.tick(2);
    expect(game.getSnapshot().enemies[0]!.hp).toBeLessThan(hpAtCast); // poison DoT is ticking
  });

  it("emits a generic abilityUsed event carrying the resolved effects", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content() });
    game.startNextWave();
    game.tick(1);
    game.useAbility("slam", { q: 1, r: 1 });

    const used = game.getSnapshot().lastEvents.find((e): e is Extract<GameEvent, { type: "abilityUsed" }> => e.type === "abilityUsed");
    expect(used).toBeTruthy();
    expect(used!.abilityId).toBe("slam");
    expect(used!.effects).toHaveLength(2);
    expect(used!.enemyIds).toHaveLength(1);
  });

});

// ── 1.2: composable tower delivery (chain) ──────────────────────────────────
// The first genuinely new tower capability built from the SAME reusable primitives as the
// ability effects above — a single-kind attack optionally chains hop-by-hop to nearby ground
// enemies via applyTowerDamage, so resistances/armor/statusOnHit ride along automatically.
// Additive: a single tower with no `chain` field behaves exactly as before (proven below).
describe("mechanic conformance: chain delivery (composable, additive)", () => {
  function content(chain?: { maxJumps: number; jumpRadius: number; damageFalloff: number }) {
    const input: GameContentInput = {
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { swarmling: { id: "swarmling", label: "Swarmling", maxHp: 40, speed: 0.3, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: {
          zapper: {
            id: "zapper", label: "Zapper", cost: { coins: 1 }, footprintRadius: 0, range: 12,
            attack: { kind: "single", fireRate: 1, damagePerStack: 10, startingStacks: 1, maxStacks: 1, upgradeCost: 1, chain }
          }
        },
        // Several swarmlings spawned in quick succession stay clustered on the lane.
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "swarmling", count: 4, spawnInterval: 0.05, startDelay: 0 }] }] },
        missions: { m: mission("m", "w", ["zapper"], 50) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    };
    return createGameContentRegistry(input);
  }

  function distinctEnemiesHit(chain?: { maxJumps: number; jumpRadius: number; damageFalloff: number }): number {
    const game = new TowerDefenseGame({ missionId: "m", content: content(chain) });
    game.placeTower("zapper", { q: 1, r: 0 });
    game.startNextWave();
    const events = tickCollectingEvents(game, 2);
    const hitIds = new Set(
      events.filter((e): e is Extract<GameEvent, { type: "enemyHit" }> => e.type === "enemyHit").map((e) => e.enemyId)
    );
    return hitIds.size;
  }

  it("a single tower with no chain only ever hits one enemy per shot (unchanged regression)", () => {
    expect(distinctEnemiesHit(undefined)).toBe(1);
  });

  it("a single tower with chain reaches multiple clustered enemies from one shot", () => {
    const hit = distinctEnemiesHit({ maxJumps: 2, jumpRadius: 3, damageFalloff: 0.5 });
    expect(hit).toBeGreaterThan(1);
  });

  it("each chain hop's damage falls off geometrically from the primary hit", () => {
    const game = new TowerDefenseGame({ missionId: "m", content: content({ maxJumps: 2, jumpRadius: 3, damageFalloff: 0.5 }) });
    game.placeTower("zapper", { q: 1, r: 0 });
    game.startNextWave();
    const events = tickCollectingEvents(game, 1);
    const hits = events.filter((e): e is Extract<GameEvent, { type: "enemyHit" }> => e.type === "enemyHit");
    expect(hits.length).toBeGreaterThanOrEqual(2); // primary + at least one hop
    const damages = hits.map((h) => h.damage).sort((a, b) => b - a);
    expect(damages[0]).toBe(10); // primary hit, full damage
    expect(damages[1]).toBeLessThan(damages[0]!); // first hop, falloff applied
  });

  it("determinism holds for a chain-enabled tower across two independent runs", () => {
    const run = () => {
      const game = new TowerDefenseGame({ missionId: "m", content: content({ maxJumps: 2, jumpRadius: 3, damageFalloff: 0.6 }) });
      game.placeTower("zapper", { q: 1, r: 0 });
      game.startNextWave();
      tick(game, 12);
      return game.getSnapshot();
    };
    expect(run()).toEqual(run());
  });
});

describe("mechanic conformance: custom ability error handling", () => {
  it("rejects an unknown ability id that declares no effects", () => {
    const reg = createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        constants: BASE_CONSTANTS,
        abilities: { mystery: { id: "mystery", label: "Mystery", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { grunt: { id: "grunt", label: "Grunt", maxHp: 10, speed: 0.5, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: {},
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: mission("m", "w", [], 50, ["mystery"]) }
      },
      maps: { lane: laneMap(9) },
      worldMap: worldMapFor(["m"])
    });
    const game = new TowerDefenseGame({ missionId: "m", content: reg });
    const result = game.useAbility("mystery", { q: 1, r: 1 });
    expect(result.ok).toBe(false);
    expect(result.reasonKey).toBe("reason.abilityUnavailable");
  });
});
