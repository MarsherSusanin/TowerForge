# TowerForge

**TowerForge by Lindforge Studios — build your own tower defense game.**

TowerForge is an open-source, content-agnostic constructor for 2D hex tower-defense games. It provides a deterministic TypeScript simulation engine, a local browser editor for `.tdproj` projects, a CLI for validation, headless simulation, and balance analysis, and a static web build target that produces a playable browser bundle (canvas or Phaser). Any creator can build their own game — no engine code required.

## Product surface

| Product | What it is | Where |
| --- | --- | --- |
| **TowerForge Editor** | Map, content & balance editor (the Studio) | `packages/studio` |
| **TowerForge AI** | AI assistant / MCP agent — drives the author → simulate → balance → patch loop | `packages/mcp` |
| **TowerForge Runtime** | Deterministic engine + renderers that run the built game | `packages/engine`, `packages/renderer` |
| **TowerForge Market** | Templates, assets, maps (planned — see `docs/ROADMAP.md`) | — |
| **TowerForge Academy** | Learning to build games (planned) | — |

## Quick Start

```bash
npm install
npm run studio
```

Studio opens at `http://localhost:5174` and edits `examples/starter.tdproj` by default.

## Common Commands

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Run Studio | `npm run studio` |
| Run MCP server | `npm run mcp -- --project examples/starter.tdproj` |
| Validate project | `npm run validate` |
| Validate as JSON | `npm run validate -- --json` |
| Simulate starter mission | `npm run sim tutorial_01 60` |
| Simulate as JSON | `npm run sim tutorial_01 60 -- --json` |
| Run balance sweep | `npm run balance -- --project examples/starter.tdproj` |
| Compile map sources | `npm run maps:compile -- --project examples/starter.tdproj` |
| Write schema migrations | `npm run migrate -- --project examples/starter.tdproj --write` |
| Typecheck engine | `npm run typecheck` |
| Compile engine runtime | `npm run build:engine` |
| Build playable web bundle | `npm run build` |
| Package mobile scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind mobile` |
| Package desktop scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind desktop` |
| Unit and integration tests | `npm run test` |
| Browser smoke test | `npm run test:e2e` |

The build command writes `examples/starter.tdproj/dist` for the starter project. Preview it with a static server:

```bash
python3 -m http.server 5175 --bind 127.0.0.1 --directory examples/starter.tdproj/dist
```

Then open `http://127.0.0.1:5175`.

## Project Format

A `.tdproj` directory is the source of a game:

- `project.json` stores project metadata.
- `content/balance.json` stores constants, abilities, enemies, towers, waves, and missions.
- `content/world-map.json` stores regions and mission nodes.
- `content/visuals.json` stores the local visual catalog, asset bindings, atlas refs, and sprite refs.
- `maps/src/*.tmj` stores editable hex map sources.
- `maps/compiled/maps.json` stores runtime map definitions generated from source maps.
- `build-targets.json` stores output targets.
- `.towerforge/` stores local editor state and backups and MUST NOT be committed.

## Architecture

Canonical module boundaries and invariants live in [ARCHITECTURE.md](ARCHITECTURE.md). Product architecture and roadmap details live in [docs/td-constructor-architecture.md](docs/td-constructor-architecture.md).

## Simulation And Balance Reports

`npm run sim ... -- --json` and the MCP `simulate_mission` tool return an agent-readable smoke report: outcome, aggregate event counts, event timeline, resource timeline, milestone snapshots, the deterministic strategy used, and next valid actions. `npm run balance` and MCP `balance_report` run a deterministic multi-strategy sweep with per-mission win rate, surviving core HP, tower usage, strategy metadata, and advisor flags.

## Agent Harness

Agent policy lives in [AGENTS.md](AGENTS.md). Operations are in [docs/runbook.md](docs/runbook.md), architecture decisions are in [docs/adr/](docs/adr/), and reference examples are in [docs/examples/](docs/examples/).

The Studio **AI Designer** and external MCP clients share the same `packages/mcp/tools.mjs` tool registry. Tools advertise `riskClass` and `sideEffect`, return structured results, and prefer dry-run/validated writes (`dry_run_balance_patch`, `apply_validated_patch`, `set_enemy_stat`, `upsert_tower`, `add_wave_group`, `bind_sprite`) over broad section replacement. The Studio AI key is stored only in the browser's `localStorage` and is sent to the local Studio server per request.

## License

MIT. See [LICENSE](LICENSE).
