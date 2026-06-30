# Runbook

## Local Development

| Task | Command | Notes |
| --- | --- | --- |
| Install | `npm install` | Uses npm workspaces. |
| Run Studio | `npm run studio` | Opens `http://localhost:5174`, default project `examples/starter.tdproj`. |
| Run Studio for another project | `node packages/studio/server.mjs --project /path/to/game.tdproj` | Set `PORT=<n>` when `5174` is busy. |
| Validate | `npm run validate` | Uses engine validation through the Node project loader. |
| Validate JSON | `npm run validate -- --json` | Machine-readable validation for CI and agents. |
| Simulate | `npm run sim tutorial_01 60` | Runs an engine-backed headless smoke simulation. |
| Simulate JSON | `npm run sim tutorial_01 60 -- --json` | Machine-readable smoke simulation. |
| Compile map sources | `npm run maps:compile -- --project examples/starter.tdproj` | Writes `maps/compiled/maps.json` from `maps/src/*.tmj`. |
| Migrate project schema | `npm run migrate -- --project examples/starter.tdproj --write` | Writes migrated files after creating `.mycelium/migration-backups`. |
| Typecheck | `npm run typecheck` | Engine only. |
| Compile engine runtime | `npm run build:engine` | Writes `packages/engine/dist`. |
| Build web player | `npm run build` | Writes `examples/starter.tdproj/dist`, including engine, renderer, project data, and safe project assets. |
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

No secrets are required for local development.

## Debugging

- Studio load failures: run `npm run validate`, then restart `npm run studio`.
- Engine compile failures: run `npm run typecheck`, then `npm run build:engine`.
- Build failures: inspect validation output first; build stops on validation errors.
- Project write conflicts: Studio returns a conflict when files changed on disk after load; reload before saving again.
- Browser player issues: serve the `dist` directory over HTTP because ES modules do not reliably run from `file://`.
- Map compile issues: run `npm run maps:compile -- --project <project> --json` and inspect source map issues.
- Studio action traces: inspect `.mycelium/runs/*.jsonl` inside the active `.tdproj`.
- E2E browser issues: install Playwright browsers with `npx playwright install chromium` if the local browser binary is missing.

## Deploy

The deployable artifact is the static web bundle created by `npm run build`. CI is configured in `.github/workflows/ci.yml` for local-alpha quality gates.

## Rollback

For local project edits:

1. Stop Studio.
2. Inspect `.mycelium/*.bak` in the affected `.tdproj`.
3. Restore the relevant JSON file manually.
4. Run `npm run validate`.

For generated builds, delete the project `dist` directory and rerun `npm run build`.

## Incidents

1. Capture the command, project path, changed files, and full error output.
2. Run `npm run validate`, `npm run typecheck`, and `npm run sim tutorial_01 60` when applicable.
3. Reproduce in Studio or the built player.
4. Add a focused validation guard, test, or runbook note so the same failure is cheaper to diagnose next time.
