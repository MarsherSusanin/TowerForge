export const AI_TOOL_NAMES = Object.freeze([
  "describe_schema",
  "list_recipes",
  "get_recipe",
  "explain_validation",
  "get_project_summary",
  "get_progression",
  "list_theme_packs",
  "preview_theme_pack",
  "list_project_tree",
  "get_tower_script",
  "list_entities",
  "get_entity",
  "list_missions",
  "validate_project",
  "release_readiness",
  "simulate_mission",
  "playtest_report",
  "compile_maps_dry_run",
  "balance_report",
  "dry_run_balance_patch",
  "apply_validated_patch",
  "dry_run_progression_patch",
  "apply_progression_patch",
  "set_enemy_stat",
  "upsert_tower",
  "add_wave_group",
  "bind_sprite",
  "bind_mission_music",
  "import_asset",
  "upsert_entity",
  "duplicate_entity",
  "delete_entity",
  "upsert_story_comic",
  "upsert_tower_script",
  "apply_theme_pack",
  "set_battle_background",
  "write_map",
  "compile_maps"
]);
export const AI_MODES = Object.freeze(["ask", "plan", "act"]);

const AI_TOOL_NAME_SET = new Set(AI_TOOL_NAMES);

export function selectAiTools(tools = []) {
  return tools
    .filter((tool) => AI_TOOL_NAME_SET.has(tool?.name))
    .map((tool) => {
      const schema = tool.inputSchema || { type: "object", properties: {} };
      const properties = { ...(schema.properties || {}) };
      delete properties.projectDir;
      return {
        ...tool,
        inputSchema: {
          ...schema,
          properties,
          ...(Array.isArray(schema.required)
            ? { required: schema.required.filter((name) => name !== "projectDir") }
            : {})
        }
      };
    });
}

export function aiWriteToolNames(tools = []) {
  return new Set(selectAiTools(tools)
    .filter((tool) => tool.riskClass === "write_local")
    .map((tool) => tool.name));
}

export function selectAiToolsForMode(tools = [], mode = "ask") {
  const selected = selectAiTools(tools);
  if (mode === "act") return selected;
  const nonWriting = selected.filter((tool) => tool.riskClass !== "write_local");
  if (mode === "plan") return nonWriting;
  return nonWriting.filter((tool) => tool.name !== "dry_run_balance_patch");
}

export function isAiToolName(name) {
  return AI_TOOL_NAME_SET.has(name);
}
