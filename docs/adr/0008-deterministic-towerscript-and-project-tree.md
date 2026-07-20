# ADR 0008: Deterministic TowerScript and Project Tree

Date: 2026-07-20

## Status

Accepted.

## Context

Genre data and reusable effect pipelines cover common tower-defense mechanics, but a game constructor also needs project-specific rules: object reactions, mission-wide systems, timed logic, and communication with custom UI. Running arbitrary JavaScript in the engine would break deterministic simulation, make browser and headless results diverge, and give imported projects access to the host environment.

Authors and agents also need to understand the complete `.tdproj` layout. That does not imply that a WebView or model should receive unrestricted filesystem writes or access to credentials and editor internals.

## Decision

- Introduce TowerScript as a versioned JSON event/expression/action language stored in `scripts/**/*.tower.json`.
- Load scripts into `GameContentRegistry` and execute them inside `TowerDefenseGame`, so Studio Playtest, headless simulation, Canvas, and Phaser use the same deterministic runtime.
- Bind scripts to `global`, `mission`, `map`, `wave`, `tower`, `enemy`, and `ability` scopes. An omitted `ids` list means every object in that scope.
- Provide lifecycle events, per-binding state, safe context reads through `$get`, deterministic expressions through `$op`, reusable gameplay actions, and author-defined `signal` events. Host integrations may call `emitScriptSignal` with a JSON payload.
- Expose only serializable public views of engine objects. Scripts cannot import modules, evaluate JavaScript, access the DOM, network, filesystem, clock, randomness, process environment, or renderer internals.
- Enforce static and runtime budgets for file size, script/handler/action counts, expression depth/evaluations, events per transaction, signal recursion, spawns, and state/payload size. Runtime failures produce `scriptDiagnostic` events and do not crash the game.
- Let Studio display the complete non-sensitive project tree. Text files outside `scripts/` are read-only in the generic tree because maps, assets, and content already have validation-aware editors.
- Confine generic create, rename, delete, and source editing to entries below `scripts/`. Reject traversal, absolute paths, symlinks, sensitive files, invalid suffixes, stale revisions, and oversized files.
- Make script writes atomic, back them up, validate the candidate script and full project before commit, and restore the previous file when post-write validation fails.
- Expose `list_project_tree`, `get_tower_script`, and dry-run/guarded `upsert_tower_script` through the shared MCP registry. Agents do not receive raw filesystem or shell tools.

## Consequences

- Authors can implement deterministic custom mechanics without forking the engine, and the same project remains balance-testable and portable.
- TowerScript is deliberately not general-purpose JavaScript or Lua. New host capabilities must be added as typed, validated actions or event payloads with engine tests.
- A script can coordinate otherwise separate rules through signals and private state, but cannot bypass content validation or mutate arbitrary engine fields.
- The project tree improves orientation while preserving specialized editors and security boundaries.
- Trusted native plugins, an opt-in sandboxed general-purpose language, breakpoints, and a richer language-service editor remain separate future decisions.

## Verification

- Engine tests cover global/object/wave bindings, state, signals, actions, deterministic outcomes, and validation failures.
- CLI tests cover nested script loading, revisions, traversal, malformed source, tree filtering, confined rename/delete, project packs, and template/renderer builds.
- MCP tests cover discovery, reads, dry-run, guarded commit, validation, and stale-revision rejection.
- Studio E2E covers tree navigation, editing, saving, validation feedback, and generated-player inclusion.
