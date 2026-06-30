# Mycelium Kit — Competitive Roadmap

The defensible wedge: **the AI-native, simulation-balanced tower-defense studio that ships a playable web game instantly and keeps the data in the author's hands.** No general engine offers AI-authoring + automatic balance-by-simulation for a genre; no AI-game-gen tool offers deterministic balancing + local-first ownership.

## Shipped

- **Tier 0 — production value floor.** Synthesized SFX (`packages/renderer/src/audio.mjs`, zero-dep WebAudio, driven by engine events), juice in the canvas renderer (floating damage numbers, death sparks, muzzle flashes, screen shake, victory/defeat overlay), and a sprite pipeline (`visuals.bindings` → image with shape fallback, served via the studio `/project-file/` route or relative in builds). Two renderers (canvas default, vendored Phaser).
- **Tier 1 — the wedge.** Deterministic multi-strategy **balance sweep** (`packages/engine/src/simulation/balance.ts`): per-mission win-rate, surviving core HP, tower usage, and an advisor that flags `unwinnable` / `trivial` / `dominant-tower` / `weak-tower` with concrete suggestions. Exposed via `mycelium balance`, the `balance_report` MCP tool, and a Studio **Balance** tab.

## Tier 1 — next iteration: live AI co-designer

The primitives an LLM loop needs already exist (`balance_report` → diagnose, `apply_balance_patch` → edit, `simulate_mission`/`validate_project` → verify). Remaining work is a thin **chat panel in Studio** that:

1. takes the user's Anthropic API key (stored locally, never committed),
2. function-calls the same tool surface the MCP exposes,
3. runs the **author → simulate → diagnose → patch → re-simulate** loop until a target win-rate is hit, streaming its reasoning.

External agents (Claude Code via MCP) can already drive this loop today; the panel makes it first-class for non-CLI users. Extension point: reuse `packages/mcp/tools.mjs` `callTool` as the in-Studio dispatch so the surface stays identical.

## Tier 2 — distribution & flywheel (the market)

Distribution is the moat (Roblox/Construct's strength). Build output is already a self-contained static PWA, so the groundwork is in place.

- **One-click publish.** `build-targets.json` already carries `market` / `storeChannel`. Add a `publish` step that uploads `dist/` to a host and returns a share URL. Extension point: a `publish_target` CLI/MCP command alongside `build`.
- **Gallery + remix.** Projects are git-friendly JSON → forkable. A portal listing community TDs with "remix" (clone the `.tdproj`) creates a content flywheel and network effects.
- **Mobile/store packaging.** Wrap `dist/` with Capacitor/Tauri for Android/iOS/desktop. The `platform` field (`web`/`android`/`ios`) and `appId`/`appVersion`/`storeChannel` are already modeled per target.
- **Creator monetization.** Ads/IAP hooks on engine lifecycle events, or a template/asset marketplace.

## Tier 3 — content depth (more distinct games, no code)

The engine is content-id-agnostic, so most depth is data-model expansion (no engine forks).

- **More mechanics as data.** Status effects beyond slow, elemental damage types, boss attack patterns, varied economies, more abilities (the ability system currently implements only `path_water`). Each new `attack.kind` / capability flag widens the design space.
- **Meta-progression.** Campaigns (the world-map exists), unlocks, persistent currencies, save systems — what turns a set of missions into a *game*.
- **Genre templates.** `mycelium create` starter variants: classic TD, maze TD, idle TD, roguelike TD — start from something fun, not a blank project.
- **Asset pipeline.** Sprite-sheet frame picking in the visuals catalog; AI-generated sprite atlases / themed art packs so a creator without an artist still ships something that looks good.

## Guardrails (keep the wedge sharp)

- Engine stays deterministic, browser-safe, Node-free, and content-id-agnostic (see `ARCHITECTURE.md` invariants) — this is what makes simulation-balancing and AI-driving possible.
- New tools/capabilities should be reachable from the MCP surface so any AI agent can use them, not just the Studio UI.
- Keep builds offline-capable (vendor, don't CDN) and projects local-first JSON.
