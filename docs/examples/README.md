# Reference Examples

Reference examples show expected project and code patterns.

## Current Examples

| Pattern | Location | Notes |
| --- | --- | --- |
| Starter project | `examples/starter.tdproj` | Canonical minimal `.tdproj` with balance, world map, source map, compiled map, visuals catalog, and build target. |
| Project loader | `packages/cli/lib/project-loader.mjs` | Canonical Node-side project loading, normalization, engine build, validation, and sim integration. |
| Map compiler | `packages/cli/lib/map-compiler.mjs` | Canonical source map to runtime map conversion. |
| Schema migrations | `packages/cli/lib/project-migrations.mjs` | Canonical in-memory `.tdproj` migration layer plus explicit write path. |
| Engine validation | `packages/engine/src/content/validate.ts` | Canonical cross-reference and numeric guard implementation. |
| Headless smoke sim | `packages/cli/sim.mjs` | CLI wrapper for engine-backed mission smoke runs. |
| Static web build | `packages/cli/build.mjs` | Generates the playable web bundle from project data, compiled engine modules, renderer, and safe assets. |
| Canvas renderer | `packages/renderer/src/index.mjs` | Shared browser renderer for Studio map preview and generated player. |
| Studio editor shell | `packages/studio/public/app.js` | Browser UI pattern for data editors, validation, sim, save, and build actions. |

## Add Examples For

- A focused engine unit test when adding new mechanics.
- A `.tdproj` migration when changing schema shape.
- Additional invalid `.tdproj` fixtures for migration, asset path, and map route regressions.
- A Phaser renderer example if a future renderer package is added behind the renderer contract.
