# Contributing

TowerForge is a local-first constructor for 2D hex tower-defense games.

## Development

Install dependencies with `npm install`, then use the root scripts:

- `npm run typecheck`
- `npm run build:engine`
- `npm run studio`
- `npm run validate`
- `npm run sim tutorial_01 60`
- `npm run balance -- --project examples/starter.tdproj`
- `npm run maps:compile -- --project examples/starter.tdproj`
- `npm run build`
- `npm run test`
- `npm run test:e2e`

CI uses Node 22 and `npm ci`. Run only the checks relevant to a focused change locally; `AGENTS.md` maps affected areas to required gates.

## Boundaries

- Keep `packages/engine` pure TypeScript with no DOM, Node, filesystem, Studio, or renderer imports.
- Keep `.tdproj` loading, migration, source map compilation, asset copying, and build output in Node-side packages.
- Use engine validation and simulation APIs instead of duplicating gameplay rules in Studio.
- Extend custom gameplay through typed TowerScript events/actions with deterministic tests. Never execute project-authored JavaScript or expose filesystem, network, clock, randomness, modules, or host objects to scripts.
- Keep generic project-tree writes under `scripts/**/*.tower.json`; use the existing validation-aware APIs for content, maps, assets, and narrative.
- Reuse `packages/mcp/tools.mjs` for Studio AI and external MCP behavior. New write tools need narrow schemas, risk metadata, revision guards where applicable, validation, backups, and rollback or dry-run/commit semantics.
- Update architecture docs or ADRs when package boundaries, project format, validation, or build output changes.

## Pull Requests

Before opening a PR, run the relevant checks listed in `.github/pull_request_template.md`. For project format changes, include a migration and fixture or regression test. For Studio/player changes, include browser coverage; for Tauri shell changes, run `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` and the applicable desktop build.
