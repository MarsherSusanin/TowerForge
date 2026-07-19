---
description: Author a TowerForge tower-defense project through the safe MCP authoring loop
argument-hint: [what to build or change, and the project path]
---

Work on the TowerForge tower-defense project through the `towerforge-ai` MCP tools (not by
hand-editing content JSON). Every write tool accepts a `projectDir` argument — pass the absolute
path of the `.tdproj` you're working on (ask the user if it's ambiguous). To scaffold a new
project first: `npx towerforge create <name> --template classic|maze|idle|roguelike`.

The safe authoring loop:
1. `describe_schema` first — attack kinds, ability effects, and currency rules, so shapes are right on the first try.
2. `get_project_summary` / `validate_project` — current state plus `revisions` tokens.
3. Preview risky balance changes with `dry_run_balance_patch` (returns a leaf-level `diff`).
4. Write with the narrow tools (`set_enemy_stat`, `upsert_tower`, `upsert_entity`, `add_wave_group`, `write_map`, `bind_sprite`, `delete_entity`) passing `ifRevision` from step 2 — a stale revision returns `{conflict:true}` instead of clobbering concurrent edits (e.g. Studio open in parallel).
5. If validation fails, call `explain_validation` with the issue to get the constraint and a runnable example.
6. Check results with `simulate_mission` and `balance_report` before calling the work done.

Task: $ARGUMENTS
