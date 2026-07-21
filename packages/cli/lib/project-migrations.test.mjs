import { describe, expect, it } from "vitest";
import { migrateProjectFiles } from "./project-migrations.mjs";

describe("project migrations", () => {
  it("applies v1 migrations in memory without changing package boundaries", () => {
    const { files, migrations } = migrateProjectFiles({
      manifest: { name: "Legacy" },
      visuals: { atlases: { creatures: { src: "/assets/creatures.png" } } },
      balance: {
        missions: {
          tutorial: {
            availability: "available",
            sunlightModifier: { intensity: 0.5 }
          }
        }
      },
      buildTargets: { targets: { web: { platform: "web", outputDir: "public" } } }
    });

    expect(files.manifest.schemaVersion).toBe(2);
    expect(files.visuals.schemaVersion).toBe(2);
    expect(files.balance.terrainTypes.water.walkable).toBe(true);
    expect(files.visuals.atlases.creatures.src).toBe("assets/creatures.png");
    expect(files.balance.missions.tutorial.availability).toBe("playable");
    expect(files.balance.missions.tutorial.sunlight).toEqual({ intensity: 0.5 });
    expect(files.buildTargets.targets.web.webDir).toBe("public");
    expect(migrations.map((migration) => migration.id)).toContain("project-schema-v1");
    expect(migrations.map((migration) => migration.id)).toContain("visual-catalog-v1");
  });

  it("maps legacy mushroom-themed attack kinds, fields, and armor to generic names", () => {
    const { files, migrations } = migrateProjectFiles({
      manifest: { schemaVersion: 1 },
      balance: {
        towers: {
          arrow: { attack: { kind: "honey", damagePerMushroom: 1, startingMushrooms: 3, maxMushrooms: 8 } },
          fungus: { attack: { kind: "chaga", sporeDamagePerUnit: 2, sporeDuration: 30 } },
          sniper: { attack: { kind: "oak_bolete", interval: 2 } },
          flak: { attack: { kind: "chanterelle", damage: 4 } },
          mortar: { attack: { kind: "slippery_jack", splashDamage: 2 } }
        },
        enemies: {
          brute: { id: "brute", maxHp: 80, armor: { kind: "oak_bolete_only" } }
        }
      }
    });

    expect(files.balance.towers.arrow.attack).toEqual({
      kind: "single",
      damagePerStack: 1,
      startingStacks: 3,
      maxStacks: 8
    });
    expect(files.balance.towers.fungus.attack).toEqual({
      kind: "pulse",
      dotDamagePerUnit: 2,
      dotDuration: 30
    });
    expect(files.balance.towers.sniper.attack.kind).toBe("sniper");
    expect(files.balance.towers.flak.attack.kind).toBe("antiair");
    expect(files.balance.towers.mortar.attack.kind).toBe("splash");
    expect(files.balance.enemies.brute.armor.kind).toBe("pierce_only");

    const ids = migrations.map((migration) => migration.id);
    expect(ids).toContain("attack-kind-taxonomy");
    expect(ids).toContain("attack-field-taxonomy");
    expect(ids).toContain("armor-kind-taxonomy");
  });

  it("declares a currency registry for legacy projects that only implied currencies via bags", () => {
    const { files, migrations } = migrateProjectFiles({
      manifest: { schemaVersion: 1 },
      balance: {
        constants: { startingResources: { coins: 100, oakRoots: 5 }, moveTowerCost: { coins: 1 } },
        towers: { t: { attack: { kind: "single" }, cost: { coins: 50, oakRoots: 1 } } },
        enemies: { e: { reward: { coins: 5, oakRoots: 1 } } },
        missions: { m: { startingResources: { coins: 100, oakRoots: 5 } } }
      }
    });

    expect(files.balance.currencies).toEqual([
      { id: "coins", label: "Coins" },
      { id: "oakRoots", label: "Oak Roots" }
    ]);
    expect(migrations.map((m) => m.id)).toContain("currency-registry");

    // Idempotent: a project that already declares its currencies is left untouched.
    const again = migrateProjectFiles(files);
    expect(again.files.balance.currencies).toEqual(files.balance.currencies);
    expect(again.migrations.map((m) => m.id)).not.toContain("currency-registry");
  });

  it("tags legacy oak_stump enemies as path blockers", () => {
    const { files, migrations } = migrateProjectFiles({
      manifest: { schemaVersion: 1 },
      balance: {
        enemies: {
          oak_stump: { id: "oak_stump", maxHp: 100 },
          oak_stump_boss: { id: "oak_stump_boss", maxHp: 500 },
          crawler: { id: "crawler", maxHp: 10 }
        }
      }
    });

    expect(files.balance.enemies.oak_stump.isPathBlocker).toBe(true);
    expect(files.balance.enemies.oak_stump_boss.isPathBlocker).toBe(true);
    expect(files.balance.enemies.crawler.isPathBlocker).toBeUndefined();
    expect(migrations.map((migration) => migration.id)).toContain("enemy-path-blocker");
  });

  // Regression: `migrate --write` must persist migration DELTAS only, never the constants-inherited
  // mission defaults that normalizeBalance() injects for the simulator. A mission that omits
  // startingResources/prepTimeUnits (inheriting them from constants) must stay that way after
  // migration, so raising the constant later still cascades to every inheriting mission.
  it("does not freeze constants-inherited mission defaults into the migrated balance", () => {
    const { files } = migrateProjectFiles({
      manifest: { schemaVersion: 1 },
      balance: {
        constants: { startingResources: { coins: 150 }, startingCoreHp: 20, prepTimeUnits: 5 },
        currencies: [{ id: "coins", label: "Coins" }],
        missions: { m: { id: "m", mapId: "x", waveSetId: "w" } } // omits startingResources/prepTimeUnits on purpose
      }
    });
    expect(files.balance.missions.m.startingResources).toBeUndefined();
    expect(files.balance.missions.m.prepTimeUnits).toBeUndefined();
    expect(files.balance.missions.m.startingCoreHp).toBeUndefined();
  });
});
