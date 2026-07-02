import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
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
          startingResources: { coins: 50 },
          prepTimeUnits: 5,
          moveTowerCost: { coins: 1 },
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
          single: {
            id: "single",
            label: "Single",
            cost: { coins: 1 },
            footprintRadius: 0,
            range: 3,
            attack: {
              kind: "single",
              fireRate: 1,
              damagePerStack: 1,
              startingStacks: 1,
              maxStacks: 3,
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
            startingResources: { coins: 50 },
            prepTimeUnits: 5,
            mapId: "map_01",
            waveSetId: "waves",
            buildTowerIds: ["single"],
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

  it("flags resource bags that reference an undeclared currency", () => {
    const mk = (currencies: { id: string; label: string }[]) => createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies,
        constants: { timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: { path_water: { id: "path_water", label: "Path Water", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { mob: { id: "mob", label: "Mob", maxHp: 5, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: { t: { id: "t", label: "T", cost: { coins: 1, gems: 5 }, footprintRadius: 0, range: 3, attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 2, upgradeCost: 1 } } },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "mob", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, mapId: "map", waveSetId: "w", buildTowerIds: ["t"], abilityIds: [] } }
      },
      maps: { map: { id: "map", width: 3, height: 1, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 2, r: 0 }, pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], pathRoutes: [], terrainOverrides: [] } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });

    const result = validateGameContentRegistry(mk([{ id: "coins", label: "Coins" }]));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.fieldPath === "cost.gems" && i.message.includes("Unknown currency"))).toBe(true);

    // Declaring the currency clears the error.
    const ok = validateGameContentRegistry(mk([{ id: "coins", label: "Coins" }, { id: "gems", label: "Gems" }]));
    expect(ok.issues.some((i) => i.fieldPath === "cost.gems")).toBe(false);
  });

  it("flags a campaign with no reachable starting mission (unlock cycle)", () => {
    const mk = (reqs1: string[], reqs2: string[]) => createGameContentRegistry({
      balance: {
        defaultMissionId: "m1",
        currencies: [{ id: "coins", label: "Coins" }],
        constants: { timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { mob: { id: "mob", label: "Mob", maxHp: 5, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: { t: { id: "t", label: "T", cost: { coins: 1 }, footprintRadius: 0, range: 3, attack: { kind: "single", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 2, upgradeCost: 1 } } },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "mob", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: {
          m1: { id: "m1", label: "M1", description: "", startingCoreHp: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, mapId: "map", waveSetId: "w", buildTowerIds: ["t"], abilityIds: [] },
          m2: { id: "m2", label: "M2", description: "", startingCoreHp: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, mapId: "map", waveSetId: "w", buildTowerIds: ["t"], abilityIds: [] }
        }
      },
      maps: { map: { id: "map", width: 3, height: 1, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 2, r: 0 }, pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], pathRoutes: [], terrainOverrides: [] } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [
        { missionId: "m1", regionId: "r", x: 1, y: 1, difficulty: 1 as const, unlockRequiresMissionIds: reqs1 },
        { missionId: "m2", regionId: "r", x: 2, y: 2, difficulty: 1 as const, unlockRequiresMissionIds: reqs2 }
      ] }
    });

    // Cycle: m1 requires m2 and m2 requires m1 → neither can ever be unlocked.
    const cyclic = validateGameContentRegistry(mk(["m2"], ["m1"]));
    expect(cyclic.ok).toBe(false);
    expect(cyclic.issues.some((i) => /can never be unlocked/.test(i.message))).toBe(true);

    // Valid chain: m1 is a root, m2 requires m1 → both reachable.
    const chain = validateGameContentRegistry(mk([], ["m1"]));
    expect(chain.issues.some((i) => /can never be unlocked/.test(i.message))).toBe(false);
  });

  it("flags an invalid damageType and non-finite resistance", () => {
    const content = createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies: [{ id: "coins", label: "Coins" }],
        constants: { timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
        enemies: { mob: { id: "mob", label: "Mob", maxHp: 5, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1, resistances: { fire: "lots" as unknown as number } } },
        towers: { t: { id: "t", label: "T", cost: { coins: 1 }, footprintRadius: 0, range: 3, attack: { kind: "single", damageType: "", fireRate: 1, damagePerStack: 1, startingStacks: 1, maxStacks: 2, upgradeCost: 1 } } },
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "mob", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, mapId: "map", waveSetId: "w", buildTowerIds: ["t"], abilityIds: [] } }
      },
      maps: { map: { id: "map", width: 3, height: 1, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 2, r: 0 }, pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], pathRoutes: [], terrainOverrides: [] } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
    const result = validateGameContentRegistry(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.fieldPath === "resistances.fire")).toBe(true);
    expect(result.issues.some((i) => i.fieldPath === "attack.damageType")).toBe(true);
  });

  // 1.3: MissionAbilityId is now open — a custom (non-preset) id is valid IFF it declares `effects`.
  function abilityValidationContent(abilities: Record<string, unknown>) {
    return createGameContentRegistry({
      balance: {
        defaultMissionId: "m",
        currencies: [{ id: "coins", label: "Coins" }],
        constants: { timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5 },
        abilities: abilities as GameContentInput["balance"]["abilities"],
        enemies: { mob: { id: "mob", label: "Mob", maxHp: 5, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
        towers: {},
        waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "mob", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
        missions: { m: { id: "m", label: "M", description: "", startingCoreHp: 10, startingResources: { coins: 10 }, prepTimeUnits: 0, mapId: "map", waveSetId: "w", buildTowerIds: [], abilityIds: Object.keys(abilities) } }
      },
      maps: { map: { id: "map", width: 3, height: 1, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 2, r: 0 }, pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], pathRoutes: [], terrainOverrides: [] } },
      worldMap: { width: 10, height: 10, regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }], missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }] }
    });
  }

  it("accepts a custom ability id that declares a valid effects composition", () => {
    const content = abilityValidationContent({
      slam: { id: "slam", label: "Slam", cooldown: 5, duration: 0, radius: 2, effects: [{ kind: "damage", amount: 10 }, { kind: "status", status: { slow: { factor: 0.5, duration: 3 } } }] }
    });
    const result = validateGameContentRegistry(content);
    expect(result.issues.filter((i) => i.entityKind === "ability")).toEqual([]);
  });

  it("rejects a custom ability id with no effects and no preset match", () => {
    const content = abilityValidationContent({
      mystery: { id: "mystery", label: "Mystery", cooldown: 5, duration: 1, radius: 2 }
    });
    const result = validateGameContentRegistry(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.entityId === "mystery" && i.fieldPath === "id")).toBe(true);
  });

  it("rejects a malformed effect (unknown kind, non-finite damage, slow.factor >= 1)", () => {
    const content = abilityValidationContent({
      bad: {
        id: "bad", label: "Bad", cooldown: 5, duration: 1, radius: 2,
        effects: [
          { kind: "damage", amount: "lots" as unknown as number },
          { kind: "status", status: { slow: { factor: 1.5, duration: 3 } } },
          { kind: "teleport" as "damage" }
        ]
      }
    });
    const result = validateGameContentRegistry(content);
    expect(result.ok).toBe(false);
    const badIssues = result.issues.filter((i) => i.entityId === "bad");
    expect(badIssues.some((i) => i.fieldPath === "effects[0].amount")).toBe(true);
    expect(badIssues.some((i) => i.fieldPath === "effects[1].status.slow.factor")).toBe(true);
    expect(badIssues.some((i) => i.fieldPath === "effects[2].kind")).toBe(true);
  });

  it("still requires the preset-specific field when a preset id declares no effects", () => {
    const content = abilityValidationContent({
      strike: { id: "strike", label: "Strike", cooldown: 5, duration: 0, radius: 2 } // missing `damage`
    });
    const result = validateGameContentRegistry(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.entityId === "strike" && i.fieldPath === "damage")).toBe(true);
  });

  // 2.6: structured, coded validation errors
  it("gives every issue a stable, machine-branchable code derived from entityKind+fieldPath", () => {
    const content = abilityValidationContent({
      strike: { id: "strike", label: "Strike", cooldown: 5, duration: 0, radius: 2 } // missing `damage`
    });
    const result = validateGameContentRegistry(content);
    const issue = result.issues.find((i) => i.entityId === "strike" && i.fieldPath === "damage");
    expect(issue?.code).toBe("ABILITY_DAMAGE");
    expect(issue?.expected).toBe("finite number"); // damage is entirely missing here, not just <= 0
  });

  it("flags a tower with an unknown attack.kind, with a curated code and hint", () => {
    const content = abilityValidationContent({}); // no abilities needed for this one
    // Sneak an invalid attack kind past the TS types via a same-shape unsafe cast, mirroring how
    // a real project.json (untyped JSON) could contain a typo'd kind.
    (content.towers ??= {}).typo = { id: "typo", label: "Typo", cost: {}, footprintRadius: 0, range: 1, attack: { kind: "sinlge" } } as unknown as GameContentInput["balance"]["towers"][string];
    const result = validateGameContentRegistry(content);
    const issue = result.issues.find((i) => i.entityId === "typo" && i.fieldPath === "attack.kind");
    expect(issue).toBeTruthy();
    expect(issue?.code).toBe("TOWER_ATTACK_KIND");
    expect(issue?.hint).toMatch(/describe_schema/);
  });

  it("attaches a curated hint to the slowFactor<1 constraint (splash and statusOnHit.slow both)", () => {
    const content = abilityValidationContent({});
    (content.towers ??= {}).mortar = {
      id: "mortar", label: "Mortar", cost: {}, footprintRadius: 0, range: 3,
      attack: { kind: "splash", interval: 1, damage: 1, splashDamage: 1, armoredChipDamage: 0, splashRadius: 1, slowFactor: 1.5, slowDuration: 1 }
    } as unknown as GameContentInput["balance"]["towers"][string];
    const result = validateGameContentRegistry(content);
    const issue = result.issues.find((i) => i.entityId === "mortar" && i.fieldPath === "attack.slowFactor");
    expect(issue?.hint).toMatch(/strictly less than 1/);
    expect(issue?.expected).toBe("0 < slowFactor < 1");
    expect(issue?.got).toBe("1.5");
  });

  // Regression: agent-authored JSON that omits `attack` entirely (or sets it to null/an array) used
  // to crash validateGameContentRegistry (TS declares TowerType.attack required, but this is exactly
  // the untyped-data boundary the validator exists to check) instead of reporting a clean issue.
  it.each([
    ["missing entirely", undefined],
    ["explicit null", null],
    ["an array instead of an object", ["not", "an", "object"]]
  ])("reports a clean 'attack' issue instead of crashing when attack is %s", (_label, badAttack) => {
    const content = abilityValidationContent({});
    (content.towers ??= {}).broken = {
      id: "broken", label: "Broken", cost: {}, footprintRadius: 0, range: 1, attack: badAttack
    } as unknown as GameContentInput["balance"]["towers"][string];
    expect(() => validateGameContentRegistry(content)).not.toThrow();
    const result = validateGameContentRegistry(content);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.entityId === "broken" && i.fieldPath === "attack");
    expect(issue).toBeTruthy();
    expect(issue?.code).toBe("TOWER_ATTACK");
    // No attack.kind/attack.slowFactor/etc issues should follow — validation should `continue` past
    // the whole attack-dependent block rather than accessing fields on the missing object.
    expect(result.issues.some((i) => i.entityId === "broken" && i.fieldPath !== "attack")).toBe(false);
  });
});
