# Quality Gap Tracker

Last reviewed: 2026-07-02

## Local Alpha Gates

- CI runs typecheck, unit tests, validation, sim, map compile, build, and E2E browser smoke.
- Project schemas reject unsafe paths and unsupported future schema versions.
- Migrations are explicit and can be written only with `--write`.
- Studio map, asset, sim, save, and build actions write JSONL traces under `.towerforge/runs/`.
- CLI/MCP simulation reports expose aggregate events, timelines, milestone snapshots, resources, strategy inputs, and next valid actions.
- MCP write tools expose risk metadata and use dry-run/validated writes, backups, and rollback for balance and visual changes.

## Known Gaps After Local Alpha

- Canvas and vendored Phaser players both ship, but new mechanics must be kept visually aligned across both targets.
- Sprite-sheet frame picking exists; remaining asset gaps are stronger binding workflows, themed asset-pack import, and richer in-Studio previews.
- Map editor supports core hex authoring, but not a full Tiled-style layer UI.
- Capacitor/Tauri scaffold export exists; store signing/submission automation, cloud projects, accounts, and analytics remain out of scope.
- Agent-facing tools now include validation-gated patch paths and several granular edits; remaining gaps are schema introspection, generic entity CRUD/delete, source map authoring, optimistic revision tokens, broader eval fixtures, and the larger trigger/effect authoring model.
