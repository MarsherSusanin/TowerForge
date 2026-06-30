# AGENTS.md

## Purpose

Mycelium Kit is a local-first constructor for 2D hex tower-defense games. Agents work on a TypeScript simulation engine, Node CLI, browser Studio, `.tdproj` project format, and generated static web player.

## Tooling

Run the relevant checks before declaring work complete:

- `npm run typecheck` for engine type safety.
- `npm run build:engine` after engine or project-loader changes.
- `npm run validate` after content/schema/loader changes.
- `npm run sim tutorial_01 60` after simulation, balance, map, or content changes.
- `npm run maps:compile -- --project examples/starter.tdproj` after source map compiler or map source changes.
- `npm run build` after CLI build, target, engine export, or player changes.
- `npm run test:e2e` after Studio, renderer, generated player, or browser interaction changes.

## Work Cycle

1. Inspect project files and current docs before editing.
2. Keep simulation rules in `packages/engine`; keep Node filesystem/server code outside the engine.
3. Implement with focused verification.
4. Run checks and read full output.
5. Update docs when commands, boundaries, project format, or operations change.

## Architectural Boundaries

- MUST keep `packages/engine` pure TypeScript with no DOM, Node, filesystem, Phaser, browser storage, or Studio imports.
- MUST keep `.tdproj` loading, normalization, migrations, map compilation, filesystem writes, asset copying, and engine compilation in Node-side packages such as `packages/cli` and `packages/studio`.
- MUST use `createGameContentRegistry` and `validateGameContentRegistry` as the canonical content contract.
- MUST keep Studio as an editor over project data; it MUST NOT duplicate gameplay rules that belong in the engine.
- MUST keep `packages/renderer` as a browser rendering adapter over snapshots/map definitions; it MUST NOT own gameplay rules or import Node/filesystem code.
- MUST update `ARCHITECTURE.md` or an ADR when changing package boundaries, project format, build outputs, or validation semantics.

## Security / Secrets

- MUST NOT commit secrets, tokens, private keys, credentials, or user-local paths as required project inputs.
- MUST bind local Studio/dev servers to loopback only unless a documented runbook change explains otherwise.
- MUST treat imported project files as untrusted data and validate before simulation or build.
- MUST reject absolute paths, external URLs, and `..` traversal in project asset paths.

## Definition of Done

- Relevant checks pass.
- User-facing Studio/CLI/player behavior is verified when touched.
- Generated build output is not treated as source unless explicitly requested.
- Documentation is updated for changed commands, project shape, or runtime behavior.

## Canonical Documentation

- `ARCHITECTURE.md`
- `docs/td-constructor-architecture.md`
- `docs/runbook.md`
- `docs/adr/`
- `docs/examples/`
