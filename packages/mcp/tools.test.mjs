import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOOLS, callTool } from "./tools.mjs";

const STARTER = path.resolve("examples/starter.tdproj");

describe("mcp tool registry", () => {
  it("advertises well-formed tool definitions", () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema?.type).toBe("object");
    }
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("validate_project");
    expect(names).toContain("simulate_mission");
    expect(names).toContain("build_project");
  });

  it("rejects unknown tools", async () => {
    await expect(callTool("nope", {}, { defaultProjectDir: STARTER })).rejects.toThrow(/Unknown tool/);
  });

  it("summarizes a project via the default project dir", async () => {
    const result = await callTool("get_project_summary", {}, { defaultProjectDir: STARTER });
    expect(result.counts.missions).toBeGreaterThan(0);
    expect(result.counts.towers).toBeGreaterThan(0);
    expect(result.defaultMissionId).toBe("tutorial_01");
  });

  it("validates the starter project cleanly", async () => {
    const result = await callTool("validate_project", { projectDir: STARTER }, {});
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("lists missions", async () => {
    const result = await callTool("list_missions", {}, { defaultProjectDir: STARTER });
    expect(result.missions.some((m) => m.id === "tutorial_01")).toBe(true);
  });
});

describe("mcp balance patch", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "mycelium-mcp-"));
    fs.mkdirSync(path.join(projectDir, "content"), { recursive: true });
    fs.cpSync(STARTER, projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("merges recognized balance sections and re-validates", async () => {
    const balanceBefore = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    const towers = { ...balanceBefore.towers };
    towers.arrow_tower = { ...towers.arrow_tower, cost: { coins: 999 } };

    const result = await callTool("apply_balance_patch", { projectDir, patch: { towers } }, {});

    expect(result.applied).toEqual(["towers"]);
    expect(result.validation.ok).toBe(true);
    const balanceAfter = JSON.parse(fs.readFileSync(path.join(projectDir, "content", "balance.json"), "utf8"));
    expect(balanceAfter.towers.arrow_tower.cost.coins).toBe(999);
    expect(fs.existsSync(path.join(projectDir, ".mycelium", "mcp-backups"))).toBe(true);
  });

  it("rejects patches with no recognized keys", async () => {
    await expect(callTool("apply_balance_patch", { projectDir, patch: { nonsense: 1 } }, {})).rejects.toThrow(/recognized balance keys/);
  });
});
