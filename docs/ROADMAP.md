# TowerForge — Competitive Roadmap

The defensible wedge: **the AI-native, simulation-balanced tower-defense studio that ships a playable web game instantly and keeps the data in the author's hands.** No general engine offers AI-authoring + automatic balance-by-simulation for a genre; no AI-game-gen tool offers deterministic balancing + local-first ownership.

## Shipped

- **Tier 0 — production value floor.** Synthesized SFX (`packages/renderer/src/audio.mjs`, zero-dep WebAudio, driven by engine events), juice in the canvas renderer (floating damage numbers, death sparks, muzzle flashes, screen shake, victory/defeat overlay), and a sprite pipeline (`visuals.bindings` → image with shape fallback, served via the studio `/project-file/` route or relative in builds). Two renderers (canvas default, vendored Phaser).
- **Tier 1 — the wedge.** Deterministic multi-strategy **balance sweep** (`packages/engine/src/simulation/balance.ts`): per-mission win-rate, surviving core HP, tower usage, and an advisor that flags `unwinnable` / `trivial` / `dominant-tower` / `weak-tower` with concrete suggestions. Exposed via `towerforge balance`, the `balance_report` MCP tool, and a Studio **Balance** tab.
- **Tier 1 next — live AI co-designer (shipped).** Studio **AI Designer** tab: a chat panel that runs the **author → simulate → diagnose → patch → re-simulate** loop. The user's Anthropic API key is stored locally (`localStorage`, never committed) and passed per-request; `packages/studio/server.mjs` `/api/ai/chat` runs a zero-dep agentic loop that reuses the MCP `callTool` surface (`packages/mcp/tools.mjs`), with `projectDir` forced to the server's project, a fetch timeout + client-disconnect abort, and step cap. It streams reasoning + tool calls/results as NDJSON; after validated write tools such as `apply_validated_patch`, `set_enemy_stat`, `upsert_tower`, `add_wave_group`, or `bind_sprite`, the editor reloads from disk. External agents (Claude Code via MCP) can still drive the same loop.
- **Tier 3 (partial) — genre templates (shipped).** `towerforge create --template classic|maze|idle|roguelike` (`packages/cli/lib/templates.mjs`) scaffolds a distinct, winnable, non-trivial starter game (verified by `templates.test.mjs` via the balance sweep) instead of a blank project. `idle` showcases a second currency.
- **Tier 3 (partial) — arbitrary currencies (shipped).** Projects declare any number of currencies (`balance.currencies`); engine/validation/studio/migration are all generic over the set (`coins` primary).

## Tier 2 — distribution & flywheel (the market)

Distribution is the moat (Roblox/Construct's strength). Build output is already a self-contained static PWA, so the groundwork is in place.

- **One-click publish.** `build-targets.json` already carries `market` / `storeChannel`. Add a `publish` step that uploads `dist/` to a host and returns a share URL. Extension point: a `publish_target` CLI/MCP command alongside `build`.
- **Gallery + remix.** Projects are git-friendly JSON → forkable. A portal listing community TDs with "remix" (clone the `.tdproj`) creates a content flywheel and network effects.
- **Mobile + desktop packaging (shipped).** `towerforge package --kind mobile|desktop` (`packages/cli/lib/packaging.mjs`, also `package_mobile`/`package_desktop` MCP tools and Studio Build Targets buttons) wraps the built web bundle into a self-contained native project — **Capacitor** (Android/iOS) under `<project>/mobile` or **Tauri v2** (Windows/macOS/Linux) under `<project>/desktop` — with the platform config, the built game, and a README covering the exact local build + signing + store steps. No publish/upload — the author runs the native build locally.
- **Creator monetization.** Ads/IAP hooks on engine lifecycle events, or a template/asset marketplace.

## Tier 3 — content depth (more distinct games, no code)

The engine is content-id-agnostic, so most depth is data-model expansion (no engine forks).

- **More mechanics as data.** _Shipped:_ (a) data-driven on-hit status effects — `attack.statusOnHit` = `{ stun?, slow?, poison? }` (stun=freeze / slow / poison=DoT); (b) **elemental damage types + resistances** — `attack.damageType` (author-defined string) × `enemy.resistances { type: multiplier }` scales incoming damage; (c) **boss attack patterns** — `enemy.towerDisrupt { interval, radius, duration }` (periodically silence towers in range) and `enemy.towerAttack { interval, damage, range }` (damage the nearest tower; a tower with `maxHp` is destroyed at 0 HP, freeing its tile — with a renderer health bar); (d) **more player abilities** — the ability union grew to `path_water | strike | freeze` (`strike` = instant AoE damage, `freeze` = AoE stun), engine-implemented via `game.useAbility(id, coord)`, with an **ability bar** wired into both built-game players (canvas + Phaser) and the Studio playtest (arm → click the map). _Still open:_ still more abilities, more boss patterns (e.g. summon shields), persistent cross-mission currencies/upgrades. Each new `attack.kind` / capability flag widens the design space.
- **Meta-progression (partly shipped).** The built-game player now persists cleared missions (`localStorage`, keyed per app), gates the mission-select by `unlockRequiresMissionIds` (✓ cleared / 🔒 locked), marks a mission cleared on victory (unlocking dependents), and has a "Reset progress" button — a **campaign** across a set of missions. _Still open:_ persistent currencies/upgrades across missions, richer save systems.
- **Genre templates.** `towerforge create` starter variants: classic TD, maze TD, idle TD, roguelike TD — start from something fun, not a blank project.
- **Asset pipeline (partly shipped).** _Shipped:_ **sprite-sheet frame picking** — a `visuals.sprites` entry is either a standalone image `{ src }` or a sub-rectangle of an atlas `{ atlas, frame: {x,y,w,h} }`. The renderer draws the sub-rect via 9-arg `drawImage` (with a defensive guard so a negative/degenerate frame draws nothing rather than crashing); validation requires the referenced atlas to exist and the frame to be finite (`x,y ≥ 0`, `w,h > 0`) and rejects a sprite that sets both `src` and `atlas`/`frame`; the Studio **Assets** tab has an atlas frame editor with a live canvas crop preview. _Still open:_ AI-generated sprite atlases / themed art packs (needs an external image service — out of the local-first scope for now).

## Guardrails (keep the wedge sharp)

- Engine stays deterministic, browser-safe, Node-free, and content-id-agnostic (see `ARCHITECTURE.md` invariants) — this is what makes simulation-balancing and AI-driving possible.
- New tools/capabilities should be reachable from the MCP surface so any AI agent can use them, not just the Studio UI.
- Keep builds offline-capable (vendor, don't CDN) and projects local-first JSON.
