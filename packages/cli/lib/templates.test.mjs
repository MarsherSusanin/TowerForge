import { describe, expect, it } from "vitest";
import { getTemplate, TEMPLATE_NAMES } from "./templates.mjs";
import { createGameContentRegistry, runBalanceSweep, validateGameContentRegistry } from "../../engine/dist/index.js";

describe("genre templates", () => {
  it("exposes the expected template names", () => {
    expect(TEMPLATE_NAMES).toEqual(["classic", "maze", "idle", "roguelike"]);
  });

  for (const name of TEMPLATE_NAMES) {
    it(`${name}: validates, ships playable maps, and is winnable but not trivial`, () => {
      const t = getTemplate(name);

      // Compiled maps must carry defaultTerrain — builds embed them directly (no recompile), so
      // without it the built game would have no buildable tiles. Regression guard.
      for (const map of Object.values(t.maps)) expect(map.defaultTerrain, `${name} map needs defaultTerrain`).toBeTruthy();

      const reg = createGameContentRegistry({ balance: t.balance, maps: t.maps, worldMap: t.worldMap });
      const result = validateGameContentRegistry(reg);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);

      const sweep = runBalanceSweep(reg, { simSeconds: 600 });
      expect(sweep.missions.length).toBeGreaterThan(0);
      for (const m of sweep.missions) {
        expect(m.winRate, `${name}/${m.missionId} should be winnable`).toBeGreaterThan(0);
        expect(m.avgCoreHpRemaining, `${name}/${m.missionId} should not be trivial`).toBeLessThan(1);
      }
    });
  }
});
