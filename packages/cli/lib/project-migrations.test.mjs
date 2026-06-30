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

    expect(files.manifest.schemaVersion).toBe(1);
    expect(files.visuals.atlases.creatures.src).toBe("assets/creatures.png");
    expect(files.balance.missions.tutorial.availability).toBe("playable");
    expect(files.balance.missions.tutorial.sunlight).toEqual({ intensity: 0.5 });
    expect(files.buildTargets.targets.web.webDir).toBe("public");
    expect(migrations.map((migration) => migration.id)).toContain("project-schema-v1");
    expect(migrations.map((migration) => migration.id)).toContain("visual-catalog-v1");
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
});
