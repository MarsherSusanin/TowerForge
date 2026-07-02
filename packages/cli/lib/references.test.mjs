import { describe, expect, it } from "vitest";
import { findEntityReferences } from "./references.mjs";

function files(overrides = {}) {
  return {
    balance: {
      defaultMissionId: "m1",
      enemies: {
        grunt: { id: "grunt" },
        boss: { id: "boss", spawnOnDeath: { enemyId: "grunt" }, phaseSpawns: [{ hpRatio: 0.5, enemyId: "grunt" }] }
      },
      towers: {
        beacon: { id: "beacon", attack: { kind: "support", unlocksTowerIds: ["elite"] } },
        elite: { id: "elite", requiresAuraFrom: "beacon", attack: { kind: "single" } },
        amp: { id: "amp", attack: { kind: "support_buff", affectsTowerIds: ["elite"] } }
      },
      waveSets: { w1: [{ id: "wave1", label: "Wave 1", groups: [{ enemyId: "grunt", count: 1 }] }] },
      abilities: { strike: { id: "strike" } },
      missions: {
        m1: { id: "m1", label: "M1", waveSetId: "w1", buildTowerIds: ["elite"], abilityIds: ["strike"], startingResources: { coins: 10 } }
      },
      constants: { startingResources: { coins: 100 }, moveTowerCost: { coins: 1 } }
    },
    worldMap: {
      missionNodes: [{ missionId: "m1", unlockRequiresMissionIds: [] }, { missionId: "m2", unlockRequiresMissionIds: ["m1"] }]
    },
    ...overrides
  };
}

describe("findEntityReferences", () => {
  it("throws on an unknown kind", () => {
    expect(() => findEntityReferences(files(), "bogus", "x")).toThrow(/unknown kind/);
  });

  it("finds enemy references: wave groups, spawn-on-death, phase-spawns", () => {
    const refs = findEntityReferences(files(), "enemy", "grunt");
    expect(refs.some((r) => r.includes("wave"))).toBe(true);
    expect(refs.some((r) => r.includes("spawn-on-death"))).toBe(true);
    expect(refs.some((r) => r.includes("phase-spawn"))).toBe(true);
  });

  it("returns empty for an unreferenced enemy", () => {
    const f = files();
    f.balance.enemies.orphan = { id: "orphan" };
    expect(findEntityReferences(f, "enemy", "orphan")).toEqual([]);
  });

  it("finds tower references: mission buildTowerIds, requiresAuraFrom, unlocksTowerIds, affectsTowerIds", () => {
    const refs = findEntityReferences(files(), "tower", "elite");
    expect(refs.some((r) => r.includes("mission"))).toBe(true);
    const beaconRefs = findEntityReferences(files(), "tower", "beacon");
    expect(beaconRefs.some((r) => r.includes("requires aura"))).toBe(true);
    expect(beaconRefs.some((r) => r.includes("unlocks"))).toBe(false); // beacon itself unlocks elite, not referenced BY beacon
  });

  it("finds mission references: defaultMissionId and world-map nodes/unlock requirements", () => {
    const refs = findEntityReferences(files(), "mission", "m1");
    expect(refs).toContain("the default mission");
    expect(refs.some((r) => r.includes("world-map node"))).toBe(true);
    expect(refs.some((r) => r.includes("unlock requirement"))).toBe(true);
  });

  it("finds waveSet references via mission.waveSetId", () => {
    const refs = findEntityReferences(files(), "waveSet", "w1");
    expect(refs.some((r) => r.includes("mission"))).toBe(true);
    expect(findEntityReferences(files(), "waveSet", "unused")).toEqual([]);
  });

  it("finds ability references via mission.abilityIds", () => {
    const refs = findEntityReferences(files(), "ability", "strike");
    expect(refs.some((r) => r.includes("mission"))).toBe(true);
    expect(findEntityReferences(files(), "ability", "unused")).toEqual([]);
  });

  it("finds currency references across constants/tower cost/upgrade costs/enemy reward/mission resources", () => {
    const f = files();
    f.balance.towers.elite.cost = { gems: 5 };
    f.balance.towers.elite.attack.upgradeCosts = [{ gems: 1 }];
    f.balance.enemies.grunt.reward = { gems: 2 };
    const refs = findEntityReferences(f, "currency", "gems");
    expect(refs.some((r) => r.includes("tower \"elite\" cost"))).toBe(true);
    expect(refs.some((r) => r.includes("upgradeCosts[0]"))).toBe(true);
    expect(refs.some((r) => r.includes("enemy \"grunt\" reward"))).toBe(true);
    const coinsRefs = findEntityReferences(f, "currency", "coins");
    expect(coinsRefs.some((r) => r.includes("constants.startingResources"))).toBe(true);
    expect(coinsRefs.some((r) => r.includes("constants.moveTowerCost"))).toBe(true);
    expect(coinsRefs.some((r) => r.includes("startingResources"))).toBe(true); // mission
  });
});
