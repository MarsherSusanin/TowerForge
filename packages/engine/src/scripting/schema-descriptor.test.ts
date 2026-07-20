import { describe, expect, it } from "vitest";
import {
  TOWER_SCRIPT_ACTION_SCHEMA,
  TOWER_SCRIPT_EVENTS,
  TOWER_SCRIPT_LIMITS,
  TOWER_SCRIPT_SCHEMA,
  TOWER_SCRIPT_SCOPES
} from "./schema-descriptor.js";
import { validateTowerScriptDefinitions } from "./validate.js";

describe("TowerScript schema descriptor", () => {
  it("is accepted by the runtime validator for every advertised event", () => {
    const handlers = Object.fromEntries(TOWER_SCRIPT_EVENTS.map((event) => [
      event,
      [{ actions: [{ action: "incrementState", key: "count" }] }]
    ]));
    const issues = validateTowerScriptDefinitions({
      descriptor_contract: {
        schemaVersion: 1,
        id: "descriptor_contract",
        bindings: [{ scope: "global" }],
        handlers
      }
    });
    expect(issues).toEqual([]);
  });

  it("publishes actionable shapes, contexts, examples, and runtime limits", () => {
    expect(TOWER_SCRIPT_SCOPES).toContain("ability");
    expect(TOWER_SCRIPT_ACTION_SCHEMA.spawnEnemy.optional?.count).toContain("32");
    expect(TOWER_SCRIPT_SCHEMA.eventFields.enemyKilled).toContain("enemyTypeId");
    expect(TOWER_SCRIPT_SCHEMA.expression.gameFields).toContain("difficultyId");
    expect(TOWER_SCRIPT_SCHEMA.example.handlers.enemyKilled).toHaveLength(1);
    expect(TOWER_SCRIPT_LIMITS.actionsPerTransaction).toBe(512);
  });
});
