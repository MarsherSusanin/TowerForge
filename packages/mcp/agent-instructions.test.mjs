import { describe, expect, it } from "vitest";
import { TOWERFORGE_AGENT_GUIDE_VERSION, TOWERFORGE_AGENT_INSTRUCTIONS } from "./agent-instructions.mjs";

describe("TowerForge shared agent instructions", () => {
  it("routes every shipped authoring layer through the safe workflow", () => {
    expect(TOWERFORGE_AGENT_GUIDE_VERSION).toBe(4);
    for (const phrase of ["universal pipeline", "TowerScript", "metaProgression", "list_theme_packs", "preview_tile_binding", "revision tokens", "validate_project"]) {
      expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain(phrase);
    }
    expect(TOWERFORGE_AGENT_INSTRUCTIONS).toContain("Never request or invent JavaScript");
  });
});
