# ADR 0007: Effects, Progression, Themes, and Renderer Conformance

Date: 2026-07-20

## Status

Accepted.

## Context

TowerForge had deterministic legacy tower kinds, campaign unlocks, project-local asset catalogs, and two generated-player renderers. Extending those areas independently would make authors and agents learn renderer-specific behavior, duplicate missions for difficulty, or write broad visual catalogs to apply a theme. There was also no executable guarantee that all four templates still worked through both renderers.

## Decision

- Add `attack.kind: "pipeline"` as the preferred tower composition contract. Targeting chooses primary enemies, delivery expands the set (`single`, `multi`, `area`, `chain`, `aura`), and ordered effects apply damage, status, or resources. Legacy kinds remain supported without semantic changes.
- Keep composition in the pure deterministic engine. Studio edits the data contract; CLI/MCP validate it; renderers only consume snapshots.
- Add optional difficulty definitions and meta progression to `content/balance.json` without a schema-version break. Missing fields normalize to a single `normal` difficulty and an empty meta profile.
- Pass `difficultyId` and `metaUpgradeLevels` explicitly into `TowerDefenseGame`. The engine never reads or writes persistence.
- Store generated-player progress as an app-scoped version-2 local profile containing cleared missions, stars, selected difficulty, meta resources, and upgrade levels. Legacy progress is normalized on read.
- Route mouse clicks and keyboard Enter through the same coordinate action in Canvas, Phaser, and Studio Playtest. Arrow keys move a visible renderer focus cursor; Escape cancels the armed action.
- Store built-in packs under `packages/cli/theme-packs` with explicit manifests and generated-original asset provenance. A shared CLI library derives all destination paths, confines copies, previews changes, checks revisions, creates backups, validates the complete project, and rolls back every changed file on failure.
- Expose theme packs through Studio, CLI, and narrow MCP tools. Studio requires a clean editor state and preview confirmation. The WebView and agent never choose an arbitrary destination path.
- Treat the 4 templates x 2 renderers as a conformance matrix. Unit/integration tests build all eight outputs; Playwright verifies browser boot, difficulty/meta controls, and keyboard placement for each output.

## Consequences

- Authors can express new tower behavior without adding a new engine union member for each delivery/effect combination.
- Existing projects and legacy tower kinds retain deterministic behavior.
- Difficulty does not fork mission data, while progression remains renderer-agnostic and testable because persistence stays outside the engine.
- Themes are local, auditable, and reversible. Applying a pack can update multiple project files, so it is intentionally a guarded project-wide operation rather than a raw asset import.
- The generated player owns a browser-local save profile. Multi-device sync, cloud saves, named slots, and profile export are separate future capabilities.
- Phaser remains shape-first for bound tower/enemy sprites, but it is now held to the same boot, interaction, progression, background, and palette contract as Canvas.

## Verification

- Engine pipeline/difficulty/meta regression tests.
- Theme preview, conflict, commit, traversal, and rollback tests.
- `template-renderer-conformance.test.mjs` for all eight builds.
- `template-renderer-matrix.spec.mjs` for all eight browser outputs.
