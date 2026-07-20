---
description: Author a TowerForge tower-defense project through the safe MCP authoring loop
argument-hint: [what to build or change, and the project path]
---

Work on the TowerForge tower-defense project through the `towerforge-ai` MCP tools (not by
hand-editing content JSON). Every write tool accepts a `projectDir` argument — pass the absolute
path of the `.tdproj` you're working on (ask the user if it's ambiguous). To scaffold a new
project first: `npx towerforge create <name> --template classic` (or `maze`, `idle`, `roguelike`).

Choose the narrowest mechanism: use the universal tower pipeline for new combat combinations, TowerScript for custom lifecycle/object behavior, difficulty/meta progression for campaign variants, and theme/asset tools for visual direction. Legacy attack kinds remain for compatibility; never invent executable project scripts or host capabilities.

The safe authoring loop:
1. Use `describe_schema` with `combat`, `missions`, `progression`, `scripts`, or `assets`, plus `list_recipes`, for the relevant vocabulary.
2. Read compact state with `get_project_summary`, `get_progression`, `list_entities`/`get_entity`, or `list_project_tree`/`get_tower_script`; capture returned revision tokens.
3. Preview risky changes with `dry_run_balance_patch`, `dry_run_progression_patch`, `compile_maps_dry_run`, `preview_theme_pack`, `upsert_tower_script` in dry-run mode, or narrative dry-runs.
4. Write with the narrowest tool: `apply_progression_patch`, granular entity CRUD, `write_map`, `upsert_tower_script`, `apply_theme_pack`, asset binding/import, or narrative tools. Pass `ifRevision` where supported; `{conflict:true}` means reload rather than overwrite a concurrent Studio edit.
5. If validation fails, call `explain_validation` with the structured issue. Do not bypass the contract with raw filesystem or shell edits.
6. Run `validate_project`, then `simulate_mission` or `playtest_report`; use `balance_report` for balance-affecting changes.

Task: $ARGUMENTS
