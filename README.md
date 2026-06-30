# Mycelium Kit

Mycelium Kit is an open-source constructor for 2D hex tower-defense games. It provides a deterministic TypeScript simulation engine, a local browser Studio for editing `.tdproj` projects, a CLI for validation and headless simulation, and a static web build target that produces a playable browser bundle.

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
| Validate project | `npm run validate` |
| Validate as JSON | `npm run validate -- --json` |
| Simulate starter mission | `npm run sim tutorial_01 60` |
| Simulate as JSON | `npm run sim tutorial_01 60 -- --json` |
| Compile map sources | `npm run maps:compile -- --project examples/starter.tdproj` |
| Write schema migrations | `npm run migrate -- --project examples/starter.tdproj --write` |
| Typecheck engine | `npm run typecheck` |
| Compile engine runtime | `npm run build:engine` |
| Build playable web bundle | `npm run build` |
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
- `.mycelium/` stores local editor state and backups and MUST NOT be committed.

## Architecture

Canonical module boundaries and invariants live in [ARCHITECTURE.md](ARCHITECTURE.md). Product architecture and roadmap details live in [docs/td-constructor-architecture.md](docs/td-constructor-architecture.md).

## Agent Harness

Agent policy lives in [AGENTS.md](AGENTS.md). Operations are in [docs/runbook.md](docs/runbook.md), architecture decisions are in [docs/adr/](docs/adr/), and reference examples are in [docs/examples/](docs/examples/).

## License

MIT. See [LICENSE](LICENSE).
