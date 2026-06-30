# Quality Gap Tracker

Last reviewed: 2026-06-29

## Local Alpha Gates

- CI runs typecheck, unit tests, validation, sim, map compile, build, and E2E browser smoke.
- Project schemas reject unsafe paths and unsupported future schema versions.
- Migrations are explicit and can be written only with `--write`.
- Studio map, asset, sim, save, and build actions write JSONL traces under `.mycelium/runs/`.

## Known Gaps After Local Alpha

- Phaser renderer remains deferred behind the renderer contract.
- Asset previews are catalog-level and do not yet provide full sprite-sheet frame picking.
- Map editor supports core hex authoring, but not a full Tiled-style layer UI.
- Desktop/Tauri, native mobile, cloud projects, accounts, and analytics remain out of scope.
