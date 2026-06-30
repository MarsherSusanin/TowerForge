# ADR 0002: Local Alpha Harness, Renderer Contract, and Project Format

Date: 2026-06-29

## Status

Accepted

## Context

Mycelium Kit needs to move from MVP constructor to local open-source alpha without weakening the core boundary: gameplay rules belong in `packages/engine`, while filesystem, project loading, migration, map compilation, and build output belong outside the engine.

The generated player and Studio preview also need a shared rendering boundary so visual work does not duplicate gameplay logic.

## Decision

- Add `packages/renderer` as a browser-only canvas renderer over serializable engine snapshots and map definitions.
- Keep Phaser deferred behind the renderer contract.
- Add `.tdproj` schema normalization and in-memory migrations in `packages/cli/lib`.
- Add explicit `npm run migrate -- --write` for persisted schema upgrades with backups.
- Compile `maps/src/*.tmj` to `maps/compiled/maps.json` through `packages/cli/lib/map-compiler.mjs`.
- Treat `content/visuals.json` as the local visual catalog and reject unsafe asset paths.
- Add JSON outputs and Studio JSONL traces for agent-readable validation and operations.
- Add CI and Playwright E2E smoke tests as local-alpha quality gates.

## Consequences

- Engine remains pure TypeScript and does not import renderer, Studio, Node, or filesystem modules.
- Studio and generated player share renderer behavior through `@mycelium/renderer`.
- Project format changes require migrations and tests.
- Browser and build verification become part of normal development, not manual-only QA.
