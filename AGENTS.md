# AGENTS.md

## Purpose

TowerForge is a local-first constructor for 2D hex tower-defense games. Agents work on a pure TypeScript simulation and TowerScript runtime, Node CLI, browser Studio, Tauri desktop shell, MCP/AI authoring surface, `.tdproj` format, renderers, and generated web players.

## Tooling

Run the relevant checks before declaring work complete:

- `npm run typecheck` for engine type safety.
- `npm run build:engine` after engine or project-loader changes.
- `npm run validate` after content/schema/loader changes.
- `npm run sim tutorial_01 60` after simulation, balance, map, or content changes.
- `npm run balance -- --project examples/starter.tdproj` after balance-strategy, advisor, economy, template, or MCP balance-tool changes.
- `npm run maps:compile -- --project examples/starter.tdproj` after source map compiler or map source changes.
- `npm run build` after CLI build, target, engine export, or player changes.
- `node packages/cli/package.mjs --project examples/starter.tdproj --kind mobile` and `node packages/cli/package.mjs --project examples/starter.tdproj --kind desktop` after native packaging changes.
- `npm run test` after shared logic, CLI library, engine, MCP, renderer, or migration changes.
- `npm run test:e2e` after Studio, renderer, generated player, or browser interaction changes.
- `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` after Tauri menu, bridge, lifecycle, or desktop-state changes.
- `npm run desktop:build:mac` plus `hdiutil verify <dmg>` before publishing a macOS desktop artifact.

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
- MUST keep `packages/mcp/tools.mjs` transport-agnostic and reuse existing CLI/loader/validation functions instead of bypassing project contracts.
- MUST expose local write tools with narrow schemas, `riskClass`/`sideEffect` metadata, validation before write, backups, and rollback or an explicit dry-run/commit split.
- MUST prefer granular or dry-run MCP tools (`dry_run_balance_patch`, `dry_run_progression_patch`, `compile_maps_dry_run`, `upsert_tower_script`, entity CRUD, `write_map`, theme preview/assets) before broad section replacement.
- MUST update engine schema descriptors and the shared `packages/mcp/agent-instructions.mjs` when a new authoring mechanism changes how agents should discover or select capabilities.
- MUST keep project-authored behavior in versioned TowerScript JSON. MUST NOT add `eval`, `Function`, arbitrary JavaScript/Lua execution, package imports, or raw host bridges; add typed deterministic events/actions instead.
- MUST keep generic project-tree writes confined to `scripts/**/*.tower.json`; content, maps, and assets use their validation-aware editors/tools.
- MUST update `ARCHITECTURE.md` or an ADR when changing package boundaries, project format, build outputs, or validation semantics.

## Security / Secrets

- MUST NOT commit secrets, tokens, private keys, credentials, or user-local paths as required project inputs.
- MUST keep AI provider keys out of project files, traces, and committed docs; direct API keys live in browser `localStorage` only, while official Codex/Claude runtimes exclusively own account credentials.
- MUST bind local Studio/dev servers to loopback only unless a documented runbook change explains otherwise.
- MUST treat imported project files as untrusted data and validate before simulation or build.
- MUST reject absolute paths, external URLs, `..` traversal, symlink escapes, and writes outside the active project.
- MUST keep account runtimes in a private home/empty working directory with no inherited API or cloud credentials, no arbitrary shell/filesystem tools, and an allowlist of validated TowerForge tools.

## Release Safety

- MUST tag the exact source commit used to build every published desktop artifact.
- MUST mark macOS releases as `Unsigned build` and GitHub pre-releases until Developer ID signing and notarization are configured.
- MUST attach both the installer and `SHA256SUMS`, and MUST repeat each SHA-256 value in the release notes.
- MUST link the release to its git tag and tagged source tree.
- MUST NOT recommend `xattr -d`, disabling Gatekeeper, or lowering system security. Direct macOS users only to System Settings > Privacy & Security > Open Anyway.
- MUST follow `docs/releasing.md` for asset names, verification, publication, rollback, and incident handling.

## Definition of Done

- Relevant checks pass.
- User-facing Studio/CLI/player behavior is verified when touched.
- Generated build output is not treated as source unless explicitly requested.
- Documentation is updated for changed commands, project shape, or runtime behavior.

## Canonical Documentation

- `ARCHITECTURE.md`
- `docs/td-constructor-architecture.md`
- `docs/runbook.md`
- `docs/releasing.md`
- `docs/adr/`
- `docs/examples/`
