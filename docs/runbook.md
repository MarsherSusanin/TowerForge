# Runbook

## Local Development

| Task | Command | Notes |
| --- | --- | --- |
| Install | `npm install` | Uses npm workspaces. |
| Run Studio | `npm run studio` | Opens `http://localhost:5174`, default project `examples/starter.tdproj`. |
| Run Studio for another project | `node packages/studio/server.mjs --project /path/to/game.tdproj` | Set `PORT=<n>` when `5174` is busy. |
| Run MCP server | `npm run mcp -- --project examples/starter.tdproj` | JSON-RPC over stdio for MCP-capable agents. |
| Validate | `npm run validate` | Uses engine validation through the Node project loader. |
| Validate JSON | `npm run validate -- --json` | Machine-readable validation for CI and agents. |
| Simulate | `npm run sim tutorial_01 60` | Runs an engine-backed headless smoke simulation. |
| Simulate JSON | `npm run sim tutorial_01 60 -- --json` | Machine-readable smoke simulation with aggregate events, timelines, milestones, strategy, and next actions. |
| Balance sweep | `npm run balance -- --project examples/starter.tdproj` | Multi-strategy deterministic balance report with advisor flags. |
| Compile map sources | `npm run maps:compile -- --project examples/starter.tdproj` | Writes `maps/compiled/maps.json` from `maps/src/*.tmj`. |
| Migrate project schema | `npm run migrate -- --project examples/starter.tdproj --write` | Writes migrated files after creating `.towerforge/migration-backups`. |
| Typecheck | `npm run typecheck` | Engine only. |
| Compile engine runtime | `npm run build:engine` | Writes `packages/engine/dist`. |
| Build web player | `npm run build` | Writes `examples/starter.tdproj/dist`, including engine, renderer, project data, and safe project assets. |
| Package mobile scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind mobile` | Builds the web bundle into a Capacitor project under `<project>/mobile`. |
| Package desktop scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind desktop` | Builds the web bundle into a Tauri v2 project under `<project>/desktop`. |
| E2E smoke | `npm run test:e2e` | Starts Studio against a temp project and verifies build/player interactions with Playwright. |

## Preview Built Player

```bash
npm run build
python3 -m http.server 5175 --bind 127.0.0.1 --directory examples/starter.tdproj/dist
```

Open `http://127.0.0.1:5175`.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `PROJECT_DIR` | no | Overrides the default `.tdproj` project for Studio/CLI. |
| `PORT` | no | Overrides Studio port, default `5174`. |
| `ANTHROPIC_BASE_URL` | no | Overrides the Studio AI Designer Anthropic-compatible base URL, default `https://api.anthropic.com`. |

No secrets are required for local development. Studio AI Designer asks for an Anthropic API key in the browser UI, stores it in `localStorage` for that browser only, and sends it to the loopback Studio server per request. Do not store provider keys in `.tdproj` files, committed docs, or traces.

## Debugging

- Studio load failures: run `npm run validate`, then restart `npm run studio`.
- Engine compile failures: run `npm run typecheck`, then `npm run build:engine`.
- Build failures: inspect validation output first; build stops on validation errors.
- Project write conflicts: Studio returns a conflict when files changed on disk after load; reload before saving again.
- Browser player issues: serve the `dist` directory over HTTP because ES modules do not reliably run from `file://`.
- Map compile issues: run `npm run maps:compile -- --project <project> --json` and inspect source map issues.
- Studio action traces: inspect `.towerforge/runs/*.jsonl` inside the active `.tdproj`.
- MCP balance edits: prefer `dry_run_balance_patch`, `apply_validated_patch`, or granular tools such as `set_enemy_stat` and `add_wave_group`; they validate before writing and keep backups under `.towerforge/mcp-backups`.
- MCP tool discovery: run `npm run mcp -- --project <project>` and issue `tools/list`; tools include `riskClass` and `sideEffect` metadata for permission decisions.
- AI Designer issues: verify the Studio tab has a saved browser-local API key, check the Studio terminal for `/api/ai/chat` errors, then reproduce the same action through `validate_project`, `simulate_mission`, or `balance_report`.
- Native packaging issues: inspect `<project>/mobile/README.md` or `<project>/desktop/README.md`; TowerForge only scaffolds Capacitor/Tauri projects and does not install native SDKs, sign binaries, or submit to stores.
- E2E browser issues: install Playwright browsers with `npx playwright install chromium` if the local browser binary is missing.

## Deploy

The deployable artifact is the static web bundle created by `npm run build`. CI is configured in `.github/workflows/ci.yml` for local-alpha quality gates.

## Rollback

For local project edits:

1. Stop Studio.
2. Inspect `.towerforge/*.bak`, `.towerforge/migration-backups/*.bak`, and `.towerforge/mcp-backups/*.bak` in the affected `.tdproj`.
3. Restore the relevant JSON file manually.
4. Run `npm run validate`.

For generated builds, delete the project `dist` directory and rerun `npm run build`.

For generated native scaffolds, delete `<project>/mobile` or `<project>/desktop` and rerun the matching `node packages/cli/package.mjs` command.

## Incidents

1. Capture the command, project path, changed files, and full error output.
2. Run `npm run validate`, `npm run typecheck`, and `npm run sim tutorial_01 60` when applicable.
3. Reproduce in Studio or the built player.
4. Add a focused validation guard, test, or runbook note so the same failure is cheaper to diagnose next time.
