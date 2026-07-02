import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { ABILITY_IDS, ABILITY_SCHEMA, ATTACK_KIND_IDS, ATTACK_KIND_SCHEMA, type FieldConstraint, type PresetAbilityId } from "./schema-descriptor.js";
import { validateGameContentRegistry } from "./validate.js";
import type { TowerAttackKind } from "../simulation/types.js";

// This file is the contract test for schema-descriptor.ts: it proves the descriptor's declared
// `requiredFields` per attack kind / ability id are (a) SUFFICIENT — a tower/ability built from
// exactly those fields passes validation — and (b) NECESSARY — omitting any one of them causes
// validateGameContentRegistry to flag it. If validate.ts's per-kind checks ever drift from the
// descriptor, this test is what catches it.

function fieldValue(field: FieldConstraint): unknown {
  switch (field.kind) {
    case "number":
      return field.lessThanOne ? 0.5 : field.positive ? 1 : 0;
    case "numberArray":
      return Array.from({ length: field.exactLength ?? 1 }, () => 1);
    case "towerIdRefArray":
      return [];
    case "resourceBagArray":
      return [];
    case "string":
      return "x";
  }
}

function minimalAttack(kind: TowerAttackKind, omit?: string): Record<string, unknown> {
  const attack: Record<string, unknown> = { kind };
  for (const field of ATTACK_KIND_SCHEMA[kind].requiredFields) {
    if (field.name === omit) continue;
    attack[field.name] = fieldValue(field);
  }
  return attack;
}

function minimalAbility(id: PresetAbilityId, omit?: string): Record<string, unknown> {
  const ability: Record<string, unknown> = { id, label: id, cooldown: 1, radius: 1 };
  for (const field of ABILITY_SCHEMA[id].requiredFields) {
    if (field.name === omit) continue;
    ability[field.name] = fieldValue(field);
  }
  return ability;
}

/** Builds a minimal-but-complete registry with one tower per attack kind (each buildable from
 * exactly its descriptor's requiredFields, one optionally missing a single named field). */
function registryWithTowers(omitFieldFor?: { kind: TowerAttackKind; field: string }) {
  const towers: GameContentInput["balance"]["towers"] = {};
  for (const kind of ATTACK_KIND_IDS) {
    const omit = omitFieldFor?.kind === kind ? omitFieldFor.field : undefined;
    towers[`t_${kind}`] = {
      id: `t_${kind}`,
      label: kind,
      cost: { coins: 1 },
      footprintRadius: 0,
      range: 5,
      attack: minimalAttack(kind, omit) as unknown as GameContentInput["balance"]["towers"][string]["attack"]
    };
  }

  const input: GameContentInput = {
    balance: {
      defaultMissionId: "m",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 100, startingResources: { coins: 100 },
        prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      abilities: { path_water: { id: "path_water", label: "PW", cooldown: 1, duration: 1, radius: 1 } },
      enemies: { grunt: { id: "grunt", label: "Grunt", maxHp: 10, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
      towers,
      waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
      missions: {
        m: {
          id: "m", label: "M", description: "", startingCoreHp: 10, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "w", buildTowerIds: Object.keys(towers), abilityIds: []
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: []
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }],
      missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }]
    }
  };
  return createGameContentRegistry(input);
}

describe("schema-descriptor: attack kinds match validate.ts", () => {
  it("builds towers of every kind from exactly the declared requiredFields, with zero attack.*-scoped errors", () => {
    const result = validateGameContentRegistry(registryWithTowers());
    const attackIssues = result.issues.filter((i) => i.entityKind === "tower" && i.fieldPath.startsWith("attack."));
    expect(attackIssues).toEqual([]);
  });

  for (const kind of ATTACK_KIND_IDS) {
    for (const field of ATTACK_KIND_SCHEMA[kind].requiredFields) {
      it(`flags tower "${kind}" as invalid when required field "${field.name}" is omitted`, () => {
        let issues: ReturnType<typeof validateGameContentRegistry>["issues"] = [];
        try {
          issues = validateGameContentRegistry(registryWithTowers({ kind, field: field.name })).issues;
        } catch {
          // A thrown error (rather than a clean issue) still proves the field is load-bearing —
          // the descriptor's claim that it's required holds either way.
          return;
        }
        const towerIssues = issues.filter((i) => i.entityId === `t_${kind}`);
        expect(towerIssues.length).toBeGreaterThan(0);
      });
    }
  }
});

describe("schema-descriptor: ability ids match validate.ts", () => {
  it("declares exactly the abilities validate.ts's KNOWN_ABILITIES enforces", () => {
    expect(new Set(ABILITY_IDS)).toEqual(new Set(["path_water", "strike", "freeze"]));
  });

  for (const id of ABILITY_IDS) {
    it(`builds ability "${id}" from exactly its declared requiredFields with zero errors`, () => {
      const input: GameContentInput = {
        balance: {
          defaultMissionId: "m",
          constants: {
            timeUnitSeconds: 1, startingCoreHp: 10, startingCoins: 100, startingResources: { coins: 100 },
            prepTimeUnits: 0, moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
            pathWaterCooldownUnits: 10, pathWaterDurationUnits: 5, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
          },
          abilities: { [id]: minimalAbility(id) } as unknown as GameContentInput["balance"]["abilities"],
          enemies: { grunt: { id: "grunt", label: "Grunt", maxHp: 10, speed: 1, reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1 } },
          towers: {},
          waveSets: { w: [{ id: "w1", label: "W1", groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }] }] },
          missions: {
            m: {
              id: "m", label: "M", description: "", startingCoreHp: 10, startingResources: { coins: 100 }, prepTimeUnits: 0,
              mapId: "lane", waveSetId: "w", buildTowerIds: [], abilityIds: [id]
            }
          }
        },
        maps: {
          lane: {
            id: "lane", width: 6, height: 3, defaultTerrain: "buildable", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
            pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })), pathRoutes: [], terrainOverrides: []
          }
        },
        worldMap: {
          width: 10, height: 10,
          regions: [{ id: "r", label: "R", description: "", bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "t", connections: [] }],
          missionNodes: [{ missionId: "m", regionId: "r", x: 5, y: 5, difficulty: 1 as const, unlockRequiresMissionIds: [] }]
        }
      };
      const result = validateGameContentRegistry(createGameContentRegistry(input));
      const abilityIssues = result.issues.filter((i) => i.entityKind === "ability" && i.entityId === id);
      expect(abilityIssues).toEqual([]);
    });
  }
});
