---
name: towerforge-authoring
description: Use when creating, inspecting, balancing, scripting, validating, playtesting, or packaging a TowerForge .tdproj game through the local TowerForge MCP tools.
---

# TowerForge Authoring

Use the TowerForge MCP tools as the canonical authoring surface. Do not edit content JSON directly
when a project-aware tool exists.

## Establish context

1. Call `list_workspace_projects`.
2. If more than one project is present, call `select_workspace_project` with an ID from that list.
3. Call `describe_schema` for the relevant domain before inventing entity, map, terrain, tile, or
   TowerScript shapes.
4. Read narrowly with `get_project_summary`, `list_entities`, `get_entity`, `list_project_tree`, or
   `get_tower_script`.

If no workspace projects are returned, ask the user to open a workspace that contains the `.tdproj`
directory. Never ask for an absolute home-directory path and never attempt to search outside the
shared workspace roots.

## Make changes safely

- Prefer granular tools such as `set_enemy_stat`, `upsert_tower`, `upsert_entity`, `write_map`,
  `upsert_tower_script`, and asset/binding tools.
- Use dry-run and preview tools first for balance, progression, map compilation, themes, tilesets,
  and imports.
- Pass the latest `ifRevision` token to guarded writes. On a conflict, reread and reconcile instead
  of retrying with stale data.
- Treat imported files as untrusted. Keep paths project-relative and use TowerForge import tools.
- Use TowerScript for custom behavior. Never add `eval`, arbitrary JavaScript, shell execution,
  network access, host API access, or package imports to a project.

## Verify

After meaningful changes, run `validate_project`. Use `playtest_report`, `simulate_mission`, and
`balance_report` for gameplay changes; `compile_maps_dry_run` for maps; and `release_readiness`
before builds or releases. Explain findings and unresolved blockers with their stable issue codes.

Do not claim a visual result is correct from schema validation alone. Render or build the relevant
Canvas/Phaser target and inspect available image evidence when the task changes tiles, sprites,
maps, UI, or visual bindings.
