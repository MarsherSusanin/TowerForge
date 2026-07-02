# TowerForge — Engine Review & Feature Roadmap

_Review date: 2026-07-01 · Updated: 2026-07-02 after the first implementation pass · Method: a six-dimension read of the codebase (mechanics depth, architecture/extensibility, AI-agent ergonomics, human-author UX, content-model completeness, distribution/production value) plus a completeness-critic pass. Every item below is grounded in a specific file/function._

This document answers three questions: **what to add or improve**, **how to make the constructor friendlier for both human creators and AI agents**, and **which mechanics are missing for full game development** — organized as a prioritized roadmap.

---

## Executive summary

TowerForge is already a genuinely capable, deterministic, content-id-agnostic TD constructor: 7 tower attack kinds, damage types + resistances, status effects, boss patterns, arbitrary currencies, campaign unlocks, a balance sweep with an advisor, two renderers, mobile/desktop packaging, an AI co-designer, and a sprite pipeline. The foundations are strong.

The single most important finding is structural, not a missing feature:

> **The engine's expressive ceiling is a set of _closed unions_.** `TowerAttackKind` is 7 hard-coded kinds ([types.ts:4](../packages/engine/src/simulation/types.ts:4)) and (as of this pass) `MissionAbilityId` is now `string` — abilities are no longer closed. Every genuinely new tower behaviour still mostly requires an engine PR, but the ceiling has one real crack in it: `single`-kind towers can now `chain` (see 1.2 below), and any player ability is content, not code (1.3, fully shipped). Two games built on TowerForge today will still feel mechanically similar for towers because they draw from the same fixed 7-kind vocabulary — abilities no longer have that limit.

The highest-leverage work is to **turn those closed unions into a composable, data-driven effect system** — after which chain/beam attacks, new debuffs, and new abilities all become _content_, not code. This is also the change that most benefits the AI agent: an agent can compose novel mechanics from primitives it can reason about, instead of picking one of seven opaque enums. Player abilities (1.3) and the first tower delivery modifier (1.2's `chain`) now work exactly this way; the full tower-kind dispatch does not yet.

The second theme is the **AI authoring surface**, and every item on it is now shipped except broader eval fixtures: MCP has dry-run map/balance tools with a leaf-level diff preview, validation-gated writes with optimistic-concurrency revision tokens (no more silent clobber of a concurrent Studio edit), generic reference-aware `upsert_entity`/`delete_entity` CRUD across every balance collection, `write_map` (author a playfield from scratch — the last hard empty-project blocker), narrower shortcuts (`set_enemy_stat` / `upsert_tower` / `add_wave_group`, `bind_sprite`), schema introspection (`describe_schema`), structured/coded validation errors with `explain_validation`, risk metadata, backups, and rollback — and the local AI loop's drive-by-localhost hole is closed. Verified end-to-end, repeatedly: an agent can build a mission on a brand-new map entirely through tool calls with a working reference-integrity guard on delete, preview a diff before committing, detect and safely reject a stale concurrent write, and turn a raw validation failure into a runnable fix. The remaining agent gap is narrow: a generic non-balance `validate_patch`, Studio UI surfacing the same diff/conflict affordances, and broader eval fixtures.

## Implemented since the review

- Headless ability actions now delegate to `game.useAbility(...)`, so `path_water`, `strike`, and `freeze` share the runtime implementation.
- `simulate_mission` / `npm run sim -- --json` now report aggregate event counts, event timeline, resource timeline, milestone snapshots, strategy inputs, and next valid actions instead of only final-tick events.
- Balance sweep now runs a wider deterministic strategy set with explicit placement strategy metadata.
- MCP writes now have `dry_run_balance_patch`, `apply_validated_patch`, rollback-on-invalid behavior, granular balance edits, `bind_sprite`, and `compile_maps_dry_run`.
- **Wave A part 1 (2026-07-02):** the studio server's Origin/Host guard closes the drive-by-localhost hole (2.1); a golden-snapshot determinism test plus 7 new per-mechanic conformance fixtures cover every previously-untested mechanic (1.4); `project-migrations.mjs` is now an ordered, documented migration registry (1.5); and a new `schema-descriptor.ts` is the source of truth for attack-kind/ability required fields, consumed by `validate.ts` and exposed to AI agents via the new MCP `describe_schema` tool, kept honest by a 29-case contract test (1.1, partial — CLI/Studio validators don't consume it yet).
- **Wave A part 2 (2026-07-02):** data-driven abilities shipped in full (1.3) — `MissionAbilityId` is open, `useAbility()` is a generic effect-runner, `applyStatusEffect` is now shared between tower `statusOnHit` and ability `status` effects, and a brand-new multi-effect custom ability (never hardcoded) works purely from a content patch. Composable tower delivery (1.2) shipped its first concrete slice, additively: `single`-kind `chain` (hop-by-hop propagation reusing `applyTowerDamage`), proving the exact mechanism the roadmap describes without touching the other 6 kinds' dispatch. 121/121 tests green (12 new), typecheck clean, verified live in Studio (chain editor round-trips through save/disk/reload).
- **Wave B (2026-07-02):** generic entity CRUD (2.3) — `upsert_entity`/`delete_entity` across towers/enemies/missions/abilities/waveSets/currencies, backed by a new reference-aware delete guard ([references.mjs](../packages/cli/lib/references.mjs)) extending Studio's enemy/tower/mission reference rules to waveSets/abilities/currencies too. `write_map` (2.5) authors a brand-new playfield from scratch — the hardest remaining "agent can't build anything without a human-authored map" blocker — and `upsert_entity(waveSets)` covers wave-set authoring generically, so no bespoke `edit_wave_set` tool was needed. 141/141 tests green (20 new), verified end-to-end with a real scratch project: write a new map → create a mission referencing it → validate clean → attempt to delete a still-referenced tower (correctly refused, naming both referencing missions) → add/remove a currency.
- **Theme 2 completion (2026-07-02):** the last three AI-authoring items shipped together — (2.4) every dry-run/write tool now returns a leaf-level `diff` ({path,before,after}, capped+truncation-flagged); (2.8) `get_project_summary`/`validate_project` return `revisions:{balance,visuals}`, every write tool accepts `ifRevision` and rejects a stale write with `{conflict:true}` and zero file touches (`bind_sprite` guards the `visuals` revision independently); (2.6) every `ValidationIssue` (engine + CLI, kept consistent by mirroring the same code-derivation function) now carries a stable `code` plus `expected`/`got`, a curated `hint` on the highest-value cases, and closed a real pre-existing gap along the way — `attack.kind` itself was never validated against the known set, so a typo'd kind silently produced zero errors; new MCP `explain_validation` turns a code into a runnable example. 157/157 tests green (16 new), verified end-to-end: diff-preview → concurrent-write rejection (first writer's value survives) → an unknown-attack-kind error explained with a working example.
- **Theme 2 hardening (2026-07-02):** an adversarial multi-agent review of the 2.4/2.6/2.8 pass (independent reviewers per dimension, each finding re-verified against the actual code by a separate skeptic agent) confirmed 12 real defects, all now fixed: a TOCTOU race where `applyValidatedBalancePatch` re-read-and-re-merged the patch right before writing (reopening the exact race the revision check exists to close) — now reuses the already-validated dry-run candidate and adds an unconditional fresh pre-write revision check; a successful write's reported `revision` could be stale (computed before the final validation's await point) — now a fresh post-write read; `computeDiff`'s size cap could report a false `truncated` (or miss array-element-level diffing, or coerce an absent field to `null` losing the absent-vs-null distinction) — rewritten to always walk the full tree and cap only the output; a tower with a missing/null/array `attack` field crashed the validator instead of reporting a clean issue — now a guarded early `continue`; `explain_validation` resolved inherited `Object.prototype` members (`code:"constructor"`) as false-positive curated hits, and a non-string `code` produced a confusing error — both now guarded; the `TOWER_ATTACK_SLOWFACTOR` curated example was missing 5 of the 7 fields `splash` actually requires — fixed to a runnable example. One review claim (a `bind_sprite` race) was independently refuted — that function has zero `await` points, so it cannot race. All 12 fixes are locked in by new regression tests. 174/174 tests green (21 new since the review), typecheck clean.

The rest is depth and polish: the remaining Wave-A ceiling item — **the full 7-kind dispatch → one generic `{targeting, delivery, effects[]}` pipeline** — is now de-risked by the golden tests + schema descriptor + a working proof-of-concept (chain), but is still its own dedicated, carefully-staged effort. Then **game rules as data** (win/lose objectives, economy models, difficulty), **author time-to-good-game** (a "why did I lose" debugger, passive balance nudges, preset libraries), **shippable production value** (VFX, music, pause, accessibility), and **portability** (a one-file bundle, a single-file HTML build).

---

## Organizing themes

The roadmap is grouped into seven themes (from the review's cross-cutting synthesis):

1. **Break the extensibility ceiling** — composable effect/ability systems on one shared schema.
2. **AI-agent authoring surface** — fine-grained, introspectable, safe write tools; secure the loop.
3. **Author-configurable game rules** — objectives, economy, difficulty, meta-progression as data.
4. **More combat mechanics** — the depth that composable effects unlocks.
5. **Human-author time-to-good-game** — diagnosis, nudges, presets, guidance.
6. **Shippable production value of built games** — VFX, audio, pause, a11y, performance, narrative.
7. **Distribution & portability** — bundles, single-file builds, opt-in sharing.
   Plus a cross-cutting **engineering-rigor** track that de-risks the refactors.

Priorities: **P0** = foundational / highest-leverage, **P1** = strong, **P2** = nice-to-have. Effort: **S / M / L / XL**.

---

## Theme 1 — Break the extensibility ceiling (foundational)

This is the load-bearing theme; most of Themes 3–4 become cheap once it lands.

| # | Feature | Priority | Effort | What & why |
|---|---------|----------|--------|-----------|
| 1.1 | **Single source of truth for the content schema** | P0 | L | **Partly shipped.** [schema-descriptor.ts](../packages/engine/src/content/schema-descriptor.ts) is now the source of truth for the two closed sets — every attack kind's/ability's required fields and numeric constraints — with `validate.ts` importing `ABILITY_IDS` from it instead of a second hardcoded copy, kept honest by [schema-descriptor.test.ts](../packages/engine/src/content/schema-descriptor.test.ts) (a per-kind/per-ability minimal-fixture contract test: 29 cases proving the descriptor is both sufficient and necessary against the real validator). Exposed externally via the new MCP `describe_schema` tool (closes 2.2). Still needed: CLI `project-schema.mjs` (maps/visuals) and Studio's `validateClient()` do not yet consume this descriptor — that drift is unchanged. |
| 1.2 | **Composable effect/trigger system for attacks** | P0 | XL | **Partly shipped, additively.** Given the risk of rewriting all 7 kinds' cooldown/targeting loops in one pass, shipped the concrete proof instead: `single`-kind towers gained an optional `chain?: {maxJumps, jumpRadius, damageFalloff}` ([types.ts](../packages/engine/src/simulation/types.ts)) — the shot jumps hop-by-hop to the nearest not-yet-hit ground enemy, reusing `applyTowerDamage` so resistances/armor/statusOnHit ride along on every hop with zero new code in those systems. A `single` tower with no `chain` is behaviorally unchanged (proven by a dedicated regression test). Chain lightning was explicitly called out as "inexpressible" before this — now it's a content patch. Studio got a matching enable-checkbox editor. **Still open:** the full "replace the 7-kind dispatch with one generic `{targeting, delivery, effects[]}` pipeline" — that remains its own dedicated, carefully-staged effort; beam/bounce and chain on other kinds are natural next slices of the same pattern. |
| 1.3 | **Data-driven player abilities** | P0 | L | **Shipped.** `MissionAbilityId` is now `string` (open) instead of a 3-value union ([types.ts](../packages/engine/src/simulation/types.ts)). `path_water`/`strike`/`freeze` remain zero-config presets; ANY other id is valid the moment it declares `effects: AbilityEffect[]` (`{kind:"damage", amount}` \| `{kind:"status", status: StatusEffectSpec}`) — no engine code. `useAbility()` is now one generic effect-runner; `applyStatusEffect` is extracted and shared between a tower's `statusOnHit` and an ability's `status` effect (one status vocabulary, one code path). `validate.ts` accepts a custom id iff it declares `effects`; still requires preset-specific fields when a preset id has none. Proven via a two-run determinism check (byte-identical to the old hardcoded strike/freeze) plus new tests for a genuinely novel multi-effect ability (damage+slow in one call) and a poison-only custom ability — capabilities the old hardcoded if-chain could never express. Exposed via the MCP `describe_schema` tool's new `abilityEffects` field. |
| 1.4 | **Golden-snapshot determinism + mechanic-conformance tests** | P1 | M | **Shipped.** [golden.test.ts](../packages/engine/src/simulation/golden.test.ts): a two-run determinism check (byte-identical `GameSnapshot`) plus a committed golden snapshot, and 7 new per-mechanic fixtures for the mechanics that had zero prior coverage — `healAura`, `phaseSpawns`, `spawnOnDeath`, `antiair`, `splash`, `support` (aura-gated placement), `support_buff` (aura fire-rate boost). This is the prerequisite safety net 1.2/1.3 still need before that refactor. |
| 1.5 | **Version-gated, per-step migrations** | P1 | M | **Shipped (registry structure; gating semantics unchanged by design).** [project-migrations.mjs](../packages/cli/lib/project-migrations.mjs) is now an ordered `MIGRATIONS` array of named `{id, from, to, description, apply(files): boolean}` steps instead of ad-hoc inline logic — a contributor appends one step instead of editing a monolith. Existing steps stay content-probed (not strictly version-gated) because `project-migrations.test.mjs` requires several of them to keep firing on already-`schemaVersion:1` input (they predate individual version bumps); the `from`/`to` fields are real infrastructure a genuinely new migration can use for a true version-gated cutoff once `PROJECT_SCHEMA_VERSION` is next bumped. |
| 1.6 | **Discriminate `MissionAbilityDefinition` per kind** | P2 | S | Interim stepping-stone to 1.3: make abilities a discriminated union like `TowerType.attack` already is, so required fields are type-enforced rather than runtime id-checks. Superseded if 1.3 lands first. |

---

## Theme 2 — AI-agent authoring surface

Goal: an agent can go **empty project → shipped game** through MCP alone, token-efficiently and without clobbering a human's concurrent edits.

| # | Feature | Priority | Effort | What & why |
|---|---------|----------|--------|-----------|
| 2.1 | **Secure the local AI-designer loop** ⚠️ | P0 | S–M | **Shipped.** [server.mjs](../packages/studio/server.mjs) now rejects any request whose `Host` doesn't name this exact server, and whose `Origin` (when a browser sends one) doesn't match `http://localhost:<port>`/`http://127.0.0.1:<port>` — closing the drive-by-localhost / DNS-rebinding vector without any legitimate same-origin fetch needing an exception. The wildcard `Access-Control-Allow-Origin: *` is gone from all three response paths (`jsonResp`, `runAiChat`, the top-level handler); no CORS header is issued at all since no cross-origin caller is legitimate. Covered by [server.test.mjs](../packages/studio/server.test.mjs) (5 regression tests, including a raw-socket DNS-rebinding simulation). Tool-result sanitization / a model allow-list from the original finding remain open. |
| 2.2 | **`describe_schema` / `get_content_schema` tool** | P0 | M | **Shipped.** The MCP `describe_schema` tool (needs no `projectDir` — pure metadata) returns `ATTACK_KIND_SCHEMA`/`ABILITY_SCHEMA`/`CURRENCY_RULES` straight from the 1.1 descriptor. The Studio AI co-designer's system prompt now instructs the agent to call it before authoring a new tower/enemy/ability. |
| 2.3 | **Fine-grained entity CRUD** (`upsert_entity` / `patch_entity` / `delete_entity`) | P0 | M | **Shipped.** Generic `upsert_entity({collection, id, value, merge?})` and `delete_entity({collection, id, force?})` cover all 5 map-shaped balance collections (towers/enemies/missions/abilities/waveSets) plus the array-shaped `currencies`, reusing the existing backup → validate → write → rollback path (`applyValidatedBalancePatch`). `delete_entity` is reference-aware: a new [references.mjs](../packages/cli/lib/references.mjs) module (ported and extended from Studio's `findReferences`, now covering waveSet/ability/currency too, not just enemy/tower/mission) refuses the delete and returns the reference list unless `force:true`; `"coins"` (the required primary currency) can never be deleted. `patch_entity` (single-field-path patch) was not added — `upsert_entity` with `merge:true` covers the common case. Narrow tools (`set_enemy_stat`, `upsert_tower`, `add_wave_group`, `bind_sprite`) are kept as lower-friction shortcuts alongside the generic pair. |
| 2.4 | **`validate_patch` dry-run + diff** | P0 | M | **Shipped.** `dry_run_balance_patch` (and, by extension, every write tool that funnels through `applyValidatedBalancePatch`) now returns a leaf-level `diff: {changes:[{path,before,after}], changeCount, truncated}` computed by a generic recursive `diffValues` — an agent sees exactly which fields would change, capped at 200 entries with an honest `truncated` flag rather than a silent drop. Still open: a generic non-balance `validate_patch` (visuals/maps aren't balance-patch-shaped) and Studio UI that previews the diff before commit. |
| 2.5 | **Map + wave authoring tools** (`write_map`, `edit_wave_set`) | P0 | L | **Shipped.** `write_map({mapId, width, height, spawnCoord, coreCoord, pathCenterline, pathRoutes?, terrainOverrides?})` authors a `maps/src/<mapId>.tmj` source (via the existing `writeMapSource`/`compileMapSource`) and compiles it — the first MCP path to author a playfield from scratch, closing the hardest empty-project blocker. Validates the map shape (via `compileMapSource`) BEFORE writing anything. Wave-set editing didn't need a bespoke tool: `upsert_entity({collection:"waveSets", id, value: WaveDefinition[]})` creates/replaces a whole wave set in one call (complementing the narrower `add_wave_group` for single-group appends), covering the "edit_wave_set" ask via the generic CRUD tool from 2.3. Verified end-to-end: `write_map` → `upsert_entity` (new mission referencing the new map) → `validate_project` clean → `delete_entity` on a still-referenced tower correctly refused with both referencing missions named. |
| 2.6 | **Structured, fixable validation errors** (+ `explain_validation`) | P1 | M | **Shipped.** Every `ValidationIssue` (engine [validate.ts](../packages/engine/src/content/validate.ts) and CLI [project-schema.mjs](../packages/cli/lib/project-schema.mjs), kept consistent by mirroring the same `deriveValidationCode(entityKind, fieldPath)`) now carries a stable, auto-derived `code` (e.g. `TOWER_ATTACK_SLOWFACTOR`) plus `expected`/`got` populated for free by `requireFinite`. A handful of the highest-value cases got hand-curated `hint`s (unknown ability id, unknown `attack.kind` — a previously-**unvalidated** gap this pass also closed: an invalid attack kind silently produced zero errors before, now checked against `ATTACK_KIND_IDS`; `slowFactor`/`slow.factor` ≥ 1). New MCP tool `explain_validation({code} \| {issue})` returns the constraint plus a runnable example for curated codes, falling back to the issue's own fields otherwise. |
| 2.7 | **`import_asset` / `bind_sprite` tools** | P1 | M | **Partly shipped.** `bind_sprite` can attach an existing sprite id to a tower, enemy, tile, or UI binding with validation and rollback. Still needed: safe asset import through MCP, sound binding, and theme-pack application. |
| 2.8 | **Optimistic-concurrency revision tokens** | P1 | S | **Shipped.** `get_project_summary`/`validate_project` return `revisions: {balance, visuals}` (a stable content hash, independent of on-disk formatting). Every write tool (`apply_balance_patch`, `apply_validated_patch`, `set_enemy_stat`, `upsert_tower`, `add_wave_group`, `bind_sprite`, `upsert_entity`, `delete_entity`) accepts an optional `ifRevision`; a mismatch returns a structured `{conflict:true, expectedRevision, actualRevision}` with **zero file writes** instead of silently clobbering a concurrent edit. `bind_sprite` checks the `visuals` revision independently of `balance`, since it writes a different file. Verified end-to-end: a "concurrent" write lands first, a stale-revision write is rejected, and the file still holds the first writer's value. |
| 2.9 | **Fix headless `applySimulationAction` ability drift** | P1 | S | **Shipped.** Headless scripted ability actions now delegate to `game.useAbility`, so `path_water`, `strike`, and `freeze` stay aligned with the runtime. Keep regression coverage for every ability added before the data-driven ability model lands. |
| 2.10 | **Recipe/example retrieval** (`get_recipe`) | P2 | M | The four genre templates ([templates.mjs](../packages/cli/lib/templates.mjs)) are vetted, validation-passing entities reachable only at `create` time. Expose curated snippets (splash tower, boss with `phaseSpawns`, multi-route wave) so an agent copy-adapts instead of synthesizing from scratch. |

---

## Theme 3 — Author-configurable game rules (data, not code)

High distinctness for low effort — mostly additive optional fields that default to today's behaviour, so nothing migrates.

| # | Feature | Priority | Effort | What & why |
|---|---------|----------|--------|-----------|
| 3.1 | **Data-driven win/lose objectives** | P0 | M–L | Every mission is the same mode: clear all waves without the core dying (both hard-coded in [TowerDefenseGame.ts](../packages/engine/src/simulation/TowerDefenseGame.ts)). Add `MissionDefinition.objectives` as a tagged union — `surviveSeconds`, `accumulateResource`, `killCount`, `maxLeaks`, `timeLimit`, plus star ratings — evaluated against existing deterministic counters. Unlocks survival/timed/escort/economy modes. |
| 3.2 | **Non-linear economy** (interest, per-wave income, early-start & leak bounties) | P0 | M | Money is purely reward-on-kill today. Add an `income` block (`perWaveClear`, `interestRate` + cap, `earlyStartBonusPerUnit`, `passivePerTimeUnit`). Unlocks the save-vs-spend / rush-vs-bank decision layer that gives TD its replayability; a principled dial for the balance advisor to auto-tune. |
| 3.3 | **Tower selling / refund** | P0 | M | The only way a tower leaves play is enemy destruction — a mis-placement is permanent. Add `sellTower` (mirror `destroyTower`'s tile-freeing) crediting an author-tunable `sellRefundRatio` of cumulative spend; emit a `towerSold` event; guard support-tower dependents. |
| 3.4 | **Runtime difficulty modes** | P1 | M | Difficulty is a build-time bake today ([templates.mjs](../packages/cli/lib/templates.mjs) `applyDifficulty`). Add a `difficulties[]` of load-time multipliers + a start-screen picker. One authoring pass ships Easy/Normal/Hard. |
| 3.5 | **Persistent meta-progression** (research tree / cross-mission upgrades) | P1 | L | Progression is binary (mission cleared or not). Add a `meta` section — meta-currencies awarded on first clear + `MetaUpgrade[]` whose effects resolve to per-mission stat multipliers/unlocks at load. Turns a level list into a campaign with permanent growth (the retention hook). |
| 3.6 | **Endless / deterministically-scaling waves** | P2 | L | Waves are fully enumerated; the game ends the instant the finite list is exhausted. Add `endless { seed, hpScalePerWave, … }` generating wave N from a **pure, snapshot-reproducible** integer function (seeded determinism is _not_ RNG — it stays within the invariant). Natural pairing with 3.1's survive objective. |

---

## Theme 4 — More combat mechanics (unlocked by Theme 1)

Most of these are effect components once 1.2 lands; several ship standalone too.

| # | Feature | Priority | Effort | What & why |
|---|---------|----------|--------|-----------|
| 4.1 | **Per-tower targeting modes for _all_ towers** | P1 | M | `TowerTargetMode` has 2 values and `setTowerTargetMode` hard-rejects any non-sniper — every other tower is locked to furthest-along. Generalize to `first/last/closest/furthest/strongest/weakest` via one `selectTargets(...)` sort (keys already computed; tie-break by id for determinism). |
| 4.2 | **Chain / beam / bounce delivery** | P1 | L | Signature TD fantasies (Tesla/laser/railgun) are inexpressible — no hit propagates. Add `chain {maxJumps, jumpRadius, falloff}` and `beam {pierce}` deliveries (bounded, deterministically ordered). Falls out of 1.2. |
| 4.3 | **More debuffs + enemy defenses** | P1 | L | `StatusEffectSpec` is only stun/slow/poison; enemy defense is only `pierce_only` + flat resistances. Add `armorShred` / `vulnerable` (mark) statuses and enemy `shield` / `splitOnHit` / evasion — enabling shred→burst synergies and enemies that _demand_ a specific counter. |
| 4.4 | **Let crowd-control affect flying** | P1 | S | Slow/poison/splash are ground-only by three hard-coded `=== "ground"` guards, not author choice — flyers are immune-by-construction. Replace with an author `affectsClass` flag (default `["ground"]` keeps current behaviour). Small change, broadens every debuff tower. |
| 4.5 | **Tower-to-tower synergy hooks** | P2 | M | The only inter-tower interaction is fire-rate aura. Generalize `support_buff` to a `{ fireRateMult, rangeMult, damageMult }` stat set + a `consumesStatus` combo hook (bonus vs slowed/marked enemies). Enables real build synergies. |
| 4.6 | **Authorable tile / terrain effect zones** | P2 | L | Terrain is nearly inert (only water slows). Add map `tileEffects` — `enemySlow`/`enemyDamage`/`towerBuff` (high-ground +range)/`teleport` — authored via the existing Tiled pipeline. Makes each map play differently. |

---

## Theme 5 — Human-author time-to-good-game

Turn "I lost / it's unbalanced" from a dead-end into a next step, and teach the mechanic vocabulary the engine already supports.

| # | Feature | Priority | Effort | What & why |
|---|---------|----------|--------|-----------|
| 5.1 | **"Why did I lose?" playtest debugger + telemetry** | P0 | M–L | **Partly shipped.** Sim smoke reports now preserve aggregate event counts, event timeline, resources, milestones, strategy inputs, and next valid actions. Still needed: per-wave/leak heatmaps, per-tower DPS, plain-language **Diagnosis** ("Wave 4: 6 fliers reached the core — no buildable tower can target flying"), jump-to-entity links, and a dedicated `playtest_report` MCP tool. |
| 5.2 | **Surface balance-advisor flags passively** | P0 | M | The advisor already produces excellent flags ([balance.ts](../packages/engine/src/simulation/balance.ts) `diagnose()`: unwinnable/trivial/dominant/weak + suggestions) — but only behind a tab the creator may never open. Run a debounced background sweep and badge the Missions list / Balance tab so a broken mission lights up while it's being edited. |
| 5.3 | **Preset content libraries in the "Add" flow** | P0 | M | `Add tower/enemy/mission` inserts a single blank `single`-attack stub — a non-programmer never discovers that antiair/splash/support or boss `phaseSpawns` exist. Turn each into an archetype picker seeded from vetted presets. Fastest path from blank project to a game using the full mechanic set. |
| 5.4 | **Contextual "Ask AI to fix this"** | P1 | M | The AI co-designer is gated behind a tab, a key-paste, and knowing the prompt. Add pre-filled entry points at the failure moments — an "Ask AI to fix" button on the validation overlay and on a flagged balance card (seeded with the exact errors / mission id + target win-rate). |
| 5.5 | **In-Studio "Play the built game" preview** | P1 | M | The Author→Playtest→Tune→**Ship** loop dead-ends in a `python3 -m http.server` terminal command a non-programmer won't run. Serve the built `dist/` under a confined `/preview/<targetId>/` route and add an "Open preview" button after build — the local-first equivalent of a share link. |
| 5.6 | **Interactive first-run tour** | P1 | M | Replace the static 4-card welcome modal with a dismissible step tour that _drives_ the loop (tweak a tower → playtest → read the curve → build), re-runnable from Help / the command palette. |
| 5.7 | **Theme / palette presets** | P1 | L | Since bring-your-own-sprites is a high bar and AI-art is out of scope, coherent colour + typography is the realistic path to a good-looking game. Add built-in palettes (data-only) + "Apply palette" across the roster; let towers override their kind-locked colour. |
| 5.8 | **Duplicate for enemies / towers / missions** | P2 | S | Waves already have Duplicate; the others force full re-authoring of each variant. Add a deep-clone-with-new-id button (mirror the wave logic) + a command-palette entry. |

---

## Theme 6 — Shippable production value of built games

The difference between "a simulation" and "a game" in the moment-to-moment feel.

| # | Feature | Priority | Effort | What & why |
|---|---------|----------|--------|-----------|
| 6.1 | **Finish the narrative pipeline** | P1 | M | `content/story-comics.json` and `content/battle-backgrounds.json` are already read + normalized in [project-loader.mjs:51](../packages/cli/lib/project-loader.mjs:51) — but `build.mjs` never emits them into `project-data.js`, so **no built game can show a mission-intro comic or a battle background**. Define the `StoryScene` schema, emit + render it, add a Studio tab. It's finishing a half-built feature, not greenfield. |
| 6.2 | **Music / ambient audio layer** | P1 | M | Audio is SFX-only ([audio.mjs](../packages/renderer/src/audio.mjs)) — no looping bed, no per-mission music, no music/SFX mixer. A TD with no music floor feels unfinished. Add a `musicTracks` section + a HUD mixer + 1–2 offline loops. |
| 6.3 | **Pause + player-facing difficulty selector** | P1 | S–M | The player has only a 0–4× speed slider (speed 0 is a soft-pause with no state/overlay) and no way to pick 3.4's difficulty. Add explicit Pause/Resume (+ spacebar) and a start-screen difficulty picker. |
| 6.4 | **Richer renderer VFX** | P1 | M | Combat reads flat — shots are an instantaneous flash, statuses are invisible, every attack kind looks identical. Add travelling projectiles/beams, per-status enemy tints (slow/stun/poison), and maxHp-scaled death bursts, all keyed off event type / attack kind (content-id-agnostic). |
| 6.5 | **Accessibility floor for built games** | P1 | M | The shipped game has none (the Studio does): no `prefers-reduced-motion`, keyboard-only unplayable, unlabeled HUD. Add a reduced-motion opt-out, a keyboard tile-cursor placement path, and `aria-live` on the HUD/outcome. |
| 6.6 | **Performance at scale** | P1 | M | Draw/event handling is O(enemies × towers) per frame with unbounded effect growth (`.find` by id in hot loops, `Math.max` over all tiles each draw). Index by id once per frame, cache tile geometry, cap live effects — so late-game swarms (exactly the crowd-pleasing content) stay smooth. |
| 6.7 | **Curated CC0 SFX + sprite starter pack** | P1 | L | Non-artists get identical synth SFX or one-file-at-a-time imports. Vendor a small license-clean pack + a one-click "apply theme" (CLI + MCP + Studio) matching the genre templates. The highest-leverage production-value lever that respects the AI-art guardrail. |
| 6.8 | **Error-recovery UX + save-format versioning** | P2 | S–M | Player templates assume a well-formed `project-data.js` and white-screen on any decode/missing-mission error; the localStorage progress blob is an unversioned raw Set that silently breaks when mission ids are renamed. Add a boot try/catch fallback + a versioned, migratable save blob. |

---

## Theme 7 — Distribution & portability

Sharing rungs that keep data in the author's hands.

| # | Feature | Priority | Effort | What & why |
|---|---------|----------|--------|-----------|
| 7.1 | **`.tdpack` export/import bundle** | P0 | M | A `.tdproj` is a loose directory; sharing means zipping by hand and hoping the layout + schemaVersions match. Add `towerforge export/import` producing one self-describing archive (content + assets + versions) that import runs through the existing migrator/validator. The substrate for remix and for agent-to-agent hand-off. |
| 7.2 | **Single-file, `file://`-runnable HTML build** | P0 | M | The build emits an 8-file ES-module bundle that only runs from an HTTP origin. Add `--single-file` that inlines engine/renderer/data + assets (data: URIs) into one double-click-able `.html` — the tangible "ship instantly, send one file" payoff, fully offline. |
| 7.3 | **`package_web` kind** (zip + one-command server) | P2 | S | Fills the rung between "a directory you must serve" and "install a native SDK": zip `dist/` + a tiny zero-dep `node serve.mjs`. A third package target needing no native toolchain. |
| 7.4 | **Build-output conformance test** | P1 | M | Nothing asserts the emitted `project-data.js` contains everything the player reads — exactly the gap that lets 6.1's narrative silently drop. Build each template × both renderers, assert emitted keys + a zero-console-error headless boot. |
| 7.5 | **Opt-in, no-lock-in publish/remix design** | P2 | XL | The roadmap's flywheel is unstarted and a central gallery would break local-first. Design (behind a flag) a decentralized path: `publish` pushes a signed `.tdpack` to an author-chosen static host/git; a gallery is a self-hostable JSON index; "remix" is `import <url>`. Mostly a spec effort. |
| 7.6 | **Runtime content-swap / moddability** | P2 | L | Built games inline + content-hash-precache all content, so every tweak needs a full rebuild + redeploy. Optionally emit content as a separately-fetched versioned JSON so a game can load a swapped/mod pack — squares with the "rapid iteration" selling point. |

---

## Recommended sequencing

The dependencies point to a clear order. Do the foundations first; they make the rest cheap and safe.

**Wave A — Foundations & safety net (do first).**
`1.4` golden/determinism tests → `1.1` schema source-of-truth → `1.2` composable effects → `1.3` data-driven abilities. In parallel: `2.1` secure the AI loop (independent, urgent) and `1.5` version-gated migrations.

**Wave B — Rules & agent surface (highest distinctness-per-effort).**
`3.1` objectives, `3.2` economy, `3.3` selling - each huge design leverage for ~M effort. Alongside the agent tools that 1.1 unblocks: `2.2` describe_schema, generic `2.3` entity CRUD/delete, full `2.4` validate_patch+diff, and `2.5` map/source authoring tools.

**Wave C — Author experience.**
`5.1` why-did-I-lose, `5.2` passive advisor, `5.3` preset libraries, `5.4` contextual Ask-AI, `5.5` in-Studio preview. These convert the engine's power into a beginner's success.

**Wave D — Depth & production value.**
Combat depth `4.1`/`4.2`/`4.4` (mostly free after 1.2); built-game polish `6.1`–`6.6`; portability `7.1`/`7.2`.

**Wave E — Ecosystem & long-tail.**
`3.5`/`3.6` meta & endless, `4.5`/`4.6` synergies & terrain, `6.7` asset pack, `7.5` publish/remix design.

---

## Guardrails (unchanged — every item above respects these)

- Engine stays **deterministic** (no `Math.random`/`Date.now`; _seeded_ pure functions are allowed and reproducible), **browser-safe**, **Node-free**, and **content-id-agnostic** (never branch on literal tower/enemy ids).
- Builds stay **offline-capable** (vendor, don't CDN); projects stay **local-first JSON**.
- New capabilities should be reachable from the **MCP surface**, not just the Studio UI.
- **AI-generated art remains out of scope** (needs an external image service); the production-value path is curated packs + palettes.
- New fields are **additive and default to today's behaviour** so existing projects never break; schema changes ship with a migration.

---

## Notes on method

This roadmap was produced by a multi-agent review that read the actual codebase across six dimensions plus a completeness-critic pass (50 findings + 8 blind spots). Overlapping proposals were merged (e.g. the effect-system appeared independently in the mechanics and architecture reviews; the objectives schema in mechanics and content-model). Two claims were spot-verified against source before inclusion: the studio server's `Access-Control-Allow-Origin: *` with no Origin check ([server.mjs:146](../packages/studio/server.mjs:146)), and the narrative files being loaded but never emitted into the build. Line references reflect the repo at review time and should be re-confirmed at implementation.
