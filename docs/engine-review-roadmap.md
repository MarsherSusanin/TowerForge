# TowerForge Engine Review And Production Roadmap

Last reviewed: 2026-07-20

This document summarizes the current engine review. The original July review was implementation input; its closed-union, missing-difficulty, missing-keyboard, missing-theme, and incomplete conformance findings have since been resolved. Current priorities are tracked here, with product sequencing in [ROADMAP.md](ROADMAP.md) and release gaps in [quality-gaps.md](quality-gaps.md).

## Current State

TowerForge now has a strong production-oriented foundation:

- a deterministic, browser-safe, Node-free, content-id-agnostic simulation engine;
- a universal tower pipeline with targeting, delivery, and ordered effects, while legacy attack kinds remain compatible;
- data-driven abilities, objectives, economy, arbitrary currencies, difficulty variants, rewards, and persistent meta progression;
- a deterministic TowerScript runtime for global, mission, map, wave, tower, enemy, and ability behavior;
- one runtime contract across headless simulation, Studio Playtest, Canvas, and Phaser;
- a four-template by two-renderer conformance matrix with keyboard placement coverage;
- schema discovery, recipes, project-tree/script reads, deterministic diagnosis, revision-guarded granular MCP writes, backups, validation, and rollback;
- a local-first Studio, Tauri desktop shell, static/single-file/PWA builds, `.tdpack` handoff, and native game scaffolds.

The expressive ceiling is no longer the old attack-kind union. It is now the finite set of validated effects, TowerScript events/actions, renderer presentations, and authoring affordances. That is the correct boundary: extend it with typed deterministic capabilities instead of arbitrary executable project code.

## Priority Gaps

| Priority | Area | Current gap | Next increment |
| --- | --- | --- | --- |
| P1 | Script authoring | TowerScript is safe and capable but JSON-heavy, with no completion, symbol navigation, breakpoint/step debugging, or inline event context. | Generate editor assistance from the script schema; add event/action documentation, handler tracing, breakpoints, and deterministic replay without adding host execution. |
| P1 | Script mechanics | Shields, marks/vulnerability, split behaviors, terrain reactions, and richer tower-to-tower buffs are not first-class typed actions/effects. | Add narrowly typed engine effects/events with validation, snapshots, reports, renderer cues, Studio forms, MCP schema exposure, and deterministic tests. |
| P1 | Renderer parity | Phaser remains shape-first and trails Canvas sprite/atlas presentation; neither renderer has enforced swarm-scale budgets. | Define visual conformance fixtures, close sprite parity, profile large waves, cache geometry/indexes, cap DPR/effects, and fail CI on agreed budgets. |
| P1 | Asset pipeline | Theme packs ship backgrounds and palettes, not complete tower/enemy families. Binding remains object-by-object. | Add licensed or generated-original sprite families, pack manifests, batch preview/binding, provenance/license metadata, and renderer-matrix tests. |
| P2 | Progression profiles | The player persists one versioned app-scoped profile. | Add named slots/loadouts, explicit migration UX, and validated profile export/import without moving ownership to a cloud service. |
| P2 | Maps and terrain | Core tile-layer/path authoring ships, but terrain has limited gameplay meaning and full Tiled object/layer workflows are absent. | Add typed terrain effect zones and preserve/import richer Tiled layers through the compiler and Studio. |
| P2 | Agent evaluation | Tool contracts are narrow and guarded, but coverage is stronger for happy paths than adversarial multi-agent use. | Add malformed project packs, stale revisions, concurrent writers, oversized inputs, protocol drift, misleading balance strategies, and policy-denial fixtures. |
| P3 | Distribution | Local builds and handoff ship; publish/remix and store automation do not. | Design an opt-in static-host/git publish contract around signed/checksummed project artifacts, keeping cloud services optional. |

## Engineering Invariants

- Engine behavior MUST stay deterministic: no wall clock, ambient randomness, filesystem, network, DOM, or Node dependencies.
- New mechanics SHOULD enter through data, universal effects, or typed TowerScript events/actions before introducing new bespoke runtime branches.
- Studio, CLI, MCP, generated players, Canvas, and Phaser MUST consume the same engine contracts.
- Project writes MUST remain local, confined, revision-aware, validated, backed up, and reversible.
- AI tools MUST expose application concepts, not raw shell or filesystem access.
- Project format changes MUST be additive where possible and ship with migrations, fixtures, and documentation.

## Completion Evidence

Use the command-to-change mapping in [../AGENTS.md](../AGENTS.md). Mechanics are not complete until engine tests, schema validation, headless reporting, Studio/MCP authoring, both generated renderers, and relevant docs agree on the same behavior. Avoid embedding test counts in roadmap prose; CI and the test runner are the live source of truth.
