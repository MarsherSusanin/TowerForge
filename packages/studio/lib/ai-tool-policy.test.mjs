import { describe, expect, it } from "vitest";
import { AI_TOOL_NAMES, aiWriteToolNames, isAiToolName, selectAiTools, selectAiToolsForMode } from "./ai-tool-policy.mjs";

describe("Studio AI tool policy", () => {
  const tools = [
    { name: "get_entity", riskClass: "read_only", inputSchema: { type: "object", properties: { projectDir: { type: "string" }, id: { type: "string" } }, required: ["projectDir", "id"] } },
    { name: "upsert_entity", riskClass: "write_local" },
    { name: "write_map", riskClass: "write_local" },
    { name: "list_theme_packs", riskClass: "read_only" },
    { name: "preview_theme_pack", riskClass: "compute_only" },
    { name: "apply_theme_pack", riskClass: "write_local" },
    { name: "build_project", riskClass: "write_local" },
    { name: "package_desktop", riskClass: "write_local" }
  ];

  it("exposes authoring tools but keeps build and packaging outside chat", () => {
    expect(selectAiTools(tools).map((tool) => tool.name)).toEqual(["get_entity", "upsert_entity", "write_map", "list_theme_packs", "preview_theme_pack", "apply_theme_pack"]);
    expect(selectAiTools(tools)[0].inputSchema.properties).not.toHaveProperty("projectDir");
    expect(selectAiTools(tools)[0].inputSchema.required).toEqual(["id"]);
    expect(AI_TOOL_NAMES).toContain("compile_maps");
    expect(AI_TOOL_NAMES).toContain("bind_mission_music");
    expect(AI_TOOL_NAMES).toContain("upsert_story_comic");
    expect(AI_TOOL_NAMES).toContain("list_theme_packs");
    expect(AI_TOOL_NAMES).toContain("preview_theme_pack");
    expect(AI_TOOL_NAMES).toContain("apply_theme_pack");
    expect(AI_TOOL_NAMES).toContain("apply_progression_patch");
    expect(AI_TOOL_NAMES).toContain("dry_run_progression_patch");
    expect(AI_TOOL_NAMES).toContain("get_progression");
    expect(isAiToolName("build_project")).toBe(false);
    expect(isAiToolName("package_desktop")).toBe(false);
  });

  it("derives write detection from MCP risk metadata", () => {
    expect([...aiWriteToolNames(tools)].sort()).toEqual(["apply_theme_pack", "upsert_entity", "write_map"]);
  });

  it("enforces Ask, Plan, and Act capability levels", () => {
    const modeTools = [
      { name: "get_entity", riskClass: "read_only", inputSchema: { type: "object", properties: {} } },
      { name: "balance_report", riskClass: "compute_only", inputSchema: { type: "object", properties: {} } },
      { name: "dry_run_balance_patch", riskClass: "compute_only", inputSchema: { type: "object", properties: {} } },
      { name: "upsert_entity", riskClass: "write_local", inputSchema: { type: "object", properties: {} } }
    ];
    expect(selectAiToolsForMode(modeTools, "ask").map((tool) => tool.name)).toEqual(["get_entity", "balance_report"]);
    expect(selectAiToolsForMode(modeTools, "plan").map((tool) => tool.name)).toEqual(["get_entity", "balance_report", "dry_run_balance_patch"]);
    expect(selectAiToolsForMode(modeTools, "act").map((tool) => tool.name)).toEqual(["get_entity", "balance_report", "dry_run_balance_patch", "upsert_entity"]);
  });
});
