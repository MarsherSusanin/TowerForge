# ADR 0009: Per-Map Grid And Autotile Platform

## Status

Accepted, implemented.

## Context

TowerForge originally treated every map, range, footprint, route, and renderer cell as an odd-r hex. That made square tower-defense projects impossible and left terrain visuals as flat colors or one sprite per terrain. Tile authoring also lacked a validated import contract that Studio users and agents could share.

## Decision

- Project schema v2 gives each map either `{kind:"hex",layout:"odd-r"}` or `{kind:"square",adjacency:"cardinal"}`. Coordinates remain `{q,r}`. Legacy maps migrate to hex/odd-r.
- The pure engine owns a topology registry with neighbors, distance, line, direction, footprint size, and tiles-within operations. Square topology uses four neighbors and Manhattan distance. Route diagonals are invalid.
- `balance.terrainTypes` owns typed buildability, walkability, ground speed, and tags. Runtime placement and ground movement consume this registry.
- TowerScript v2 adds terrain bindings, tile events, and controlled runtime terrain mutation. Mutations are deterministic, run-only, budgeted to 64 changes per transaction and 512 active overrides, and cannot make an active route non-walkable.
- `visuals.tileSets` owns atlas slicing, topology, rule kind, terrain materials, connection groups, signatures, weighted variants, and transforms. Binding priority is map, grid, legacy tile binding, then color fallback.
- `packages/renderer/src/autotile.mjs` is the single resolver for Canvas and Phaser. Roads derive connections from actual `pathRoutes`; area terrain connects by material group. Variant selection uses a stable content hash.
- Supported rules are random variants, square edge/corner/blob, Tiled mixed Wang order, square four-sector composition, hex edge, and hex six-sector composition.
- Studio imports PNG spritesheets with Tiled TSJ/TSX metadata following the [Tiled JSON format](https://doc.mapeditor.org/en/stable/reference/json-map-format/) and [Terrain/Wang Sets](https://doc.mapeditor.org/en/stable/manual/terrain/) contracts. Only the documented TowerForge property allowlist is accepted.
- Draft preview may use fallback colors. Production build and `release_readiness` fail when a reachable map cell resolves to a missing signature.
- MCP exposes progressive `maps`, `terrain`, and `tiles` schemas plus narrow inspect, preview, import, terrain, binding, and render-preview tools.

## Security And Persistence

- Descriptors are limited to 2 MB and 4096 tiles; PNG uploads are limited to 10 MB and bounded dimensions.
- External URLs, absolute paths, traversal, symlinks, unsupported properties/images, malformed PNG headers, XML DTD/entities, and mismatched image geometry are rejected.
- Studio preview is read-only. Commit requires the preview revision, performs confined atomic writes, backs up existing files, validates the complete project, and rolls back catalogs and image together on failure.
- Runtime terrain changes never write to `.tdproj` and expose no filesystem, network, clock, randomness, or host API.

## Consequences

- One project may mix square and hex maps without renderer or simulation forks.
- Authors can ship coherent connected terrain rather than flat-color cells, while agents receive structured coverage instead of guessing masks.
- Canvas and Phaser must remain conformant with the shared resolver and local terrain invalidation behavior.
- Full Tiled maps, object layers, arbitrary executable tile code, isometric topology, diagonal square movement, and dynamic pathfinding remain outside this decision.

## Verification

- Unit tests cover both topologies, route validation, terrain runtime budgets, Wang order, blob normalization, deterministic weighted variants, TSJ/TSX parsing, and import security.
- Integration tests cover browser PNG import, revision guards, atomic commit/rollback, MCP draft binding, and release-readiness blocking.
- The conformance contract is `4 templates x 2 grids x 2 renderers`, with browser checks for nonblank tiles and pointer/keyboard placement.
