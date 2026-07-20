# TowerForge — Competitive Roadmap

Last reviewed: 2026-07-20

The defensible wedge: **the AI-native, simulation-balanced tower-defense studio that ships a playable web game instantly and keeps the data in the author's hands.** No general engine offers AI-authoring + automatic balance-by-simulation for a genre; no AI-game-gen tool offers deterministic balancing + local-first ownership.

## Shipped

- **Tier 0 — production value floor.** Event SFX plus imported custom sounds, looping per-mission music with separate SFX/music mixing, canvas combat feedback, story panels, mission backdrops, Pause/Resume, reduced-motion handling, recovery UI, and a sprite/atlas pipeline. Two offline renderers remain available (Canvas default, vendored Phaser).
- **Tier 1 — the wedge.** Deterministic multi-strategy **balance sweep** (`packages/engine/src/simulation/balance.ts`): per-mission win-rate, surviving core HP, tower usage, and an advisor that flags `unwinnable` / `trivial` / `dominant-tower` / `weak-tower` with concrete suggestions. Exposed via `towerforge balance`, the `balance_report` MCP tool, and a Studio **Balance** tab.
- **Tier 1 next — live AI co-designer (shipped).** Studio **AI Chat** is a right-side workspace that runs the **author → simulate → diagnose → preview → patch → review → re-simulate** loop. Connections and defaults live in Settings: ChatGPT OAuth through Codex App Server, Claude account auth through the bundled Claude Agent SDK/runtime, or direct Anthropic/OpenAI/OpenRouter keys. Ask/Plan/Act modes are enforced from MCP `riskClass`; model/reasoning catalogs, images, and locally sampled video frames are supported. AI-applied writes reload into an explicit diff with Keep/Revert. External MCP agents use the same compact reads, recipes, diagnosis, granular content/map/asset/narrative writes, revision guards, backups, validation, and rollback.
- **Tier 1 — author feedback loop (shipped).** Project Home/Release Doctor, Problems/Activity, passive balance badges, Balance Lab, contextual Ask AI actions, Playtest Pause/Step/Inspect/timeline, and `playtest_report` turn validation or a loss into evidence and a next action.
- **Tier 3 (partial) — genre templates (shipped).** `towerforge create --template classic|maze|idle|roguelike` (`packages/cli/lib/templates.mjs`) scaffolds a distinct, winnable, non-trivial starter game (verified by `templates.test.mjs` via the balance sweep) instead of a blank project. `idle` showcases a second currency.
- **Tier 3 (partial) — arbitrary currencies (shipped).** Projects declare any number of currencies (`balance.currencies`); engine/validation/studio/migration are all generic over the set (`coins` primary).
- **Tier 3 — universal tower pipeline (shipped).** New towers can declare targeting, delivery (`single`, `multi`, `area`, `chain`, `aura`), and ordered damage/status/resource effects. Legacy tower kinds remain deterministic and backward-compatible.
- **Tier 3 — difficulty and meta progression (shipped).** Difficulty variants modify run inputs without cloning missions. Generated players persist app-scoped meta currencies, upgrades, rewards, cleared missions, and stars in a versioned local profile; Studio exposes authoring and live difficulty playtest.
- **Tier 0 — keyboard placement and renderer conformance (shipped).** Canvas, Phaser, and Studio Playtest share tile actions with a visible focus cursor. CI builds and browser-smokes the four templates through both renderers.
- **Tier 3 — themed packs (shipped).** Verdant Frontier and Frostbound Citadel bundle generated original backgrounds plus coordinated UI/renderer palettes. Studio previews before apply; CLI/MCP use revision guards, confined copies, backups, validation, and rollback.
- **Tier 3 — deterministic custom scripting (shipped).** TowerScript files under `scripts/` bind event-driven rules to global, mission, map, wave, tower, enemy, and ability contexts. They share one engine runtime across Studio/headless/Canvas/Phaser, support safe expressions, state, actions, and custom signals, and are editable through a filtered project tree plus guarded MCP tools.

## Tier 2 — distribution & flywheel (the market)

Distribution is the moat (Roblox/Construct's strength). Build output is already a self-contained static PWA, so the groundwork is in place.

- **One-click publish.** `build-targets.json` already carries `market` / `storeChannel`. Add a `publish` step that uploads `dist/` to a host and returns a share URL. Extension point: a `publish_target` CLI/MCP command alongside `build`.
- **Gallery + remix.** Projects are git-friendly JSON → forkable. A portal listing community TDs with "remix" (clone the `.tdproj`) creates a content flywheel and network effects.
- **Mobile + desktop packaging (shipped).** `towerforge package --kind mobile|desktop` (`packages/cli/lib/packaging.mjs`, also `package_mobile`/`package_desktop` MCP tools and Studio Build Targets buttons) wraps the built web bundle into a self-contained native project — **Capacitor** (Android/iOS) under `<project>/mobile` or **Tauri v2** (Windows/macOS/Linux) under `<project>/desktop` — with the platform config, the built game, and a README covering the exact local build + signing + store steps. No publish/upload — the author runs the native build locally.
- **Portable handoff and web delivery (shipped).** `.tdpack` export/import provides deterministic checksummed project handoff. `build --single-file` emits a double-clickable `file://` game. `package --kind web` adds the normal PWA, single-file fallback, loopback-only launcher, and deterministic ZIP without a native SDK.
- **Creator monetization.** Ads/IAP hooks on engine lifecycle events, or a template/asset marketplace.

## Tier 3 — content depth (more distinct games, no code)

The engine is content-id-agnostic, so most depth is data-model expansion (no engine forks).

- **More mechanics as data.** _Shipped:_ custom multi-effect abilities; universal tower targeting/delivery/effects; on-hit stun/slow/poison; elemental damage/resistances; flying-aware crowd control; boss disruption/tower attacks/phases/spawn-on-death; chained shots; deterministic targeting modes; difficulty variants; authored victory/failure/star objectives; wave/passive/interest/early-start economy; tower selling; arbitrary currencies; deterministic custom lifecycle scripts and signals. _Still open:_ additional typed TowerScript actions for shields/marks/splits and terrain reactions.
- **Meta-progression (shipped baseline).** The built player persists cleared missions, stars, meta currencies, and upgrade levels in a versioned app-scoped profile, awards first/repeat/star rewards, gates missions, and passes the selected upgrades into the pure engine. Richer save slots/loadouts and profile exchange remain open.
- **Genre templates.** `towerforge create` starter variants: classic TD, maze TD, idle TD, roguelike TD — start from something fun, not a blank project.
- **Asset and narrative pipeline (partly shipped).** Standalone/atlas-frame sprites, safe project-local import, sound-event binding, mission music, story comics, battle backgrounds, and two generated-original themed background/palette packs are validated and available through Studio/build/MCP. _Still open:_ complete tower/enemy sprite families, batch binding, and opt-in generation hooks.

## Next production priorities

1. Expand TowerScript actions, contextual autocomplete, diagnostics, and debugging without weakening deterministic simulation.
2. Expand meta profiles with loadouts, explicit migration/export, and save-slot UX.
3. Profile swarm-scale renderer hot paths and add repeatable performance budgets.
4. Expand themed packs into coherent tower/enemy sprite families with batch binding.
5. Design opt-in publish/remix without weakening local ownership or exposing broad remote-write tools.

## Guardrails (keep the wedge sharp)

- Engine stays deterministic, browser-safe, Node-free, and content-id-agnostic (see `ARCHITECTURE.md` invariants) — this is what makes simulation-balancing and AI-driving possible.
- New tools/capabilities should be reachable from the MCP surface so any AI agent can use them, not just the Studio UI.
- Keep builds offline-capable (vendor, don't CDN) and projects local-first JSON.
