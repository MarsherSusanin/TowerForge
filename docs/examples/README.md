# Reference Examples

Reference examples show expected project and code patterns.

## Current Examples

| Pattern | Location | Notes |
| --- | --- | --- |
| Starter project | `examples/starter.tdproj` | Canonical `.tdproj` with balance, world map, maps, visuals, a starter TowerScript, and build targets. |
| TowerScript example | `examples/starter.tdproj/scripts/gameplay/starter-gameplay.tower.json` | Minimal lifecycle/state script that runs unchanged in Studio, headless simulation, Canvas, and Phaser. |
| Script runtime | `packages/engine/src/scripting` | Canonical safe expressions, schema validation, events/actions, and deterministic limits. |
| Project tree and script files | `packages/cli/lib/project-tree.mjs`, `packages/cli/lib/project-scripts.mjs` | Filtered reads plus confined, revision-guarded, atomic script writes and backups. |
| Project loader | `packages/cli/lib/project-loader.mjs` | Canonical Node-side project loading, normalization, engine build, validation, and sim integration. |
| Map compiler | `packages/cli/lib/map-compiler.mjs` | Canonical source map to runtime map conversion. |
| Schema migrations | `packages/cli/lib/project-migrations.mjs` | Canonical in-memory `.tdproj` migration layer plus explicit write path. |
| Engine validation | `packages/engine/src/content/validate.ts` | Canonical cross-reference and numeric guard implementation. |
| Headless smoke sim | `packages/cli/sim.mjs` | CLI wrapper for engine-backed mission smoke runs. |
| Static web build | `packages/cli/build.mjs` | Generates the playable web bundle from project data, compiled engine modules, renderer, and safe assets. |
| Native packaging | `packages/cli/lib/packaging.mjs` | Canonical Capacitor/Tauri scaffold generation around a built web bundle. |
| MCP tool registry | `packages/mcp/tools.mjs` | Canonical agent tool contracts, risk metadata, dry-run/validated writes, and rollback paths. |
| Canvas renderer | `packages/renderer/src/index.mjs` | Shared browser renderer for Studio map/playtest preview and generated canvas player, including sprite and atlas-frame drawing. |
| Phaser player target | `packages/cli/build.mjs` | Canonical optional vendored Phaser build target; stays outside the engine boundary. |
| Studio editor shell | `packages/studio/public/app.js` | Browser UI pattern for data editors, validation, sim, balance, right-side AI Chat, save, and build actions. |
| Unsigned release notes | `docs/examples/unsigned-release-notes.md` | Canonical warning, checksum, tag/source links, and supported Gatekeeper guidance for pre-signing desktop releases. |

## Add Examples For

- A focused engine unit test when adding new mechanics.
- A `.tdproj` migration when changing schema shape.
- Additional invalid `.tdproj` fixtures for migration, asset path, and map route regressions.
- Balance fixtures for misleading placement strategies, boss-heavy waves, flying-heavy waves, idle economy, roguelike variants, and multi-currency projects.
- MCP fixtures for malformed input, invalid-write rollback, stale revisions, concurrent writers, permission denial, provider protocol drift, and agent-authored maps/scripts.
- Renderer fixtures that prove sprite/atlas parity and enforce swarm-scale performance budgets.
- TowerScript examples for typed custom signals, per-object state, diagnostics, and future shield/terrain actions as those capabilities ship.
