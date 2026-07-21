# Quality Gap Tracker

Last reviewed: 2026-07-20

## Local Alpha Gates

- CI runs Node 22 typecheck, unit/integration tests, validation, sim, map compile, build, and Playwright browser smoke.
- Project schemas reject unsafe paths and unsupported future schema versions.
- Migrations are explicit and can be written only with `--write`.
- Studio map, asset, sim, save, and build actions write JSONL traces under `.towerforge/runs/`.
- CLI/MCP simulation reports expose aggregate events, timelines, milestone snapshots, resources, strategy inputs, and next valid actions.
- MCP write tools expose risk metadata and use dry-run/validated writes, revision guards, backups, and rollback for gameplay, maps, scripts, assets, and narrative.
- TowerScript runs through one deterministic, budgeted engine runtime in headless sim, Studio Playtest, Canvas, and Phaser; project-tree writes remain confined to scripts.
- The conformance matrix builds Classic, Maze, Idle, and Roguelike on hex and square grids through Canvas and Phaser: 16 outputs with difficulty/meta, tile rendering, pointer picking, and keyboard-placement checks.
- Per-map topology, typed terrain, Wang/autotile resolution, TSJ/TSX import, deterministic variants, sector composition, reachable-mask release blocking, and guarded tile MCP tools are shipped.
- Tauri unit tests cover desktop state/menu/close behavior; unsigned installers are built on macOS, Windows, and Ubuntu in the release workflow.

## Known Gaps After Local Alpha

- Phaser has tile atlas/transform/sector parity with Canvas, but tower/enemy rendering remains shape-first; renderer performance still needs repeatable swarm-scale budgets, geometry/index profiling, and bounded effect pools.
- Bundled themes provide original backgrounds and coordinated palettes, but not complete tower/enemy sprite families, batch binding, or opt-in generation/import hooks.
- TowerScript v1/v2 has no language server, contextual completion, breakpoints, or step debugger. Shields, marks, and splits still require new typed engine actions/events; terrain entry/change and controlled runtime mutation are shipped.
- Map authoring covers hex and square terrain layers, markers, routes, overrides, topology validation, and tileset workbench import, but not complete Tiled multi-layer/object-layer workflows.
- Persistent progression has one app-scoped profile. Named save slots, loadouts, profile export/import, and explicit user-facing migration controls remain open.
- Agent safety has unit coverage, but malformed-project, concurrent-writer, prompt-policy, provider-protocol-drift, and adversarial balance fixtures need broader regression suites.
- Game publish/remix, cloud projects, hosted analytics, store submission, and signing automation are not implemented. Production macOS/Windows distribution remains blocked on external signing credentials.
