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
| Run packaged Studio shell | `npm run desktop:dev` | Prepares the bundled runtime and launches the Tauri desktop wrapper around Studio. |
| Build desktop Studio installers | `npm run desktop:build` | Produces Tauri bundles under `packages/desktop/src-tauri/target/release/bundle`. |
| E2E smoke | `npm run test:e2e` | Starts Studio against a temp project and verifies build/player interactions with Playwright. |

## Desktop Studio Navigation

The packaged Studio uses a native application menu. macOS exposes `TowerForge`, `File`, `Edit`, `View`, `Project`, `Window`, and `Help` in the system menu bar. Windows and Linux expose the equivalent menu on the application window, with Exit and About in their conventional menus.

- `File > New Project` opens the Studio project wizard and a native location picker. Templates are Classic, Maze, Idle, and Roguelike.
- `File > Open Recent` stores up to ten valid projects in `<app-data>/desktop-state.json`; missing projects are removed automatically and Clear Recent preserves the active project.
- Save, Undo, Redo, navigation, validation, simulation, map compilation, balance, theme, zoom, and help reuse the same Studio command registry as toolbar buttons, shortcuts, and the command palette.
- New/Open/Recent/Close/Quit show `Save / Discard / Cancel` when the current project is dirty. A failed save cancels the requested action.
- On macOS, closing the window keeps the app available from the Dock; Quit stops the sidecar. On Windows and Linux, closing the only window exits the app.

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
| `ANTHROPIC_BASE_URL` | no | Overrides the AI Designer Anthropic base URL, default `https://api.anthropic.com`. |
| `OPENAI_BASE_URL` | no | Overrides the AI Designer OpenAI base URL, default `https://api.openai.com/v1`. |
| `OPENROUTER_BASE_URL` | no | Overrides the AI Designer OpenRouter base URL, default `https://openrouter.ai/api/v1`. |

Packaged Studio builds set internal desktop variables such as `TOWERFORGE_DESKTOP`, `TOWERFORGE_RUNTIME_ROOT`, `TOWERFORGE_USER_DATA_DIR`, and `TOWERFORGE_SESSION_TOKEN`. These are runtime diagnostics only; normal users should not need to set them manually.

AI Designer has two authentication paths:

- **Account runtimes**: Codex uses ChatGPT OAuth through Codex App Server; Claude Code uses the official Claude Agent SDK/runtime login. Click Connect and finish the provider-owned browser flow. TowerForge never receives the OAuth token and does not read the runtime credential cache. Credentials live under the provider runtime's protected directory in `<app-data>/agent-runtimes`; Codex is configured to use the OS keyring.
- **Direct APIs**: Anthropic, OpenAI, and OpenRouter keys remain separate browser `localStorage` entries for that device and are sent only to the loopback Studio server for the selected request. The old `towerforge:anthropic-key` entry is migrated automatically.

Both paths send the user prompt and the tool results needed for the task to the selected provider. Account isolation protects credentials; it does not make inference offline. TowerForge disables local account-runtime transcript persistence, gives each runtime a private home and empty working directory, restricts Codex filesystem reads to that workspace, disables Claude built-in tools, exposes only validated TowerForge tools, and does not inherit API/cloud/proxy credentials into the runtime process. Never put provider credentials in `.tdproj` files, committed docs, traces, or support logs.

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
- AI Designer direct-provider issues: verify the selected provider has a saved browser-local key and a tool-capable model, check `/api/ai/chat`, then reproduce the same action through `validate_project`, `simulate_mission`, or `balance_report`. OpenRouter model discovery uses `/api/ai/models?provider=openrouter`; custom model IDs remain available when the live catalog is offline.
- Codex/Claude account issues: use Disconnect, restart Studio, and Connect again. The safe status endpoint is `/api/ai/runtime/status?provider=codex` or `provider=claude-code`; it never returns tokens. A packaged build must contain compatible packages under `runtime/node_modules/@openai` and `runtime/node_modules/@anthropic-ai`. `TOWERFORGE_CODEX_BIN` and `TOWERFORGE_CLAUDE_BIN` are internal test/diagnostic overrides only and must point to an absolute trusted executable path.
- Native packaging issues: inspect `<project>/mobile/README.md` or `<project>/desktop/README.md`; TowerForge only scaffolds Capacitor/Tauri projects and does not install native SDKs, sign binaries, or submit to stores.
- Desktop Studio packaging issues: run `npm run desktop:dev` first to verify the sidecar starts, then inspect `packages/desktop/src-tauri/runtime` for Studio files and production agent-runtime dependencies, and `packages/desktop/src-tauri/binaries` for the Node sidecar binary. If `/api/health` works but the app UI does not load, check the desktop session token/cookie handshake in the Tauri console.
- Desktop menu/bridge issues: confirm `packages/desktop/src-tauri/capabilities/main.json` allows only the main `http://127.0.0.1:*` WebView, then inspect the WebView console for `Desktop bridge setup failed`. Delete only `<app-data>/desktop-state.json` to reset last/recent projects without touching project data.
- E2E browser issues: install Playwright browsers with `npx playwright install chromium` if the local browser binary is missing.

## Deploy

The deployable web-game artifact is the static web bundle created by `npm run build`. The installable TowerForge Studio artifacts come from `npm run desktop:build`:

- Windows: `packages/desktop/src-tauri/target/release/bundle/nsis/*.exe` and `packages/desktop/src-tauri/target/release/bundle/msi/*.msi`
- macOS: `packages/desktop/src-tauri/target/release/bundle/dmg/*.dmg`
- Linux: `packages/desktop/src-tauri/target/release/bundle/appimage/*.AppImage`, `packages/desktop/src-tauri/target/release/bundle/deb/*.deb`, and `packages/desktop/src-tauri/target/release/bundle/rpm/*.rpm`

CI is configured in `.github/workflows/ci.yml` for local-alpha quality gates. `.github/workflows/desktop-release.yml` builds unsigned desktop artifacts on Windows, macOS, and Ubuntu. Production macOS distribution requires Developer ID signing plus notarization; production Windows distribution requires a code-signing certificate.

Public desktop releases follow [the desktop release policy](releasing.md). Until signing is configured, publish them as GitHub pre-releases with `Unsigned build` in the title. After building from the committed source and writing the final hash into both `SHA256SUMS` and the release notes, publish with:

```bash
gh release create <tag> \
  <installer-path> \
  <sha256sums-path> \
  --repo MarsherSusanin/TowerForge \
  --prerelease \
  --title "TowerForge <tag> - Unsigned build" \
  --notes-file <release-notes-path>
```

The release operator must then download both GitHub-hosted assets, recalculate the installer checksum, and verify the tag and source links. GitHub Actions artifacts are not a substitute for a GitHub Release.

## Rollback

For local project edits:

1. Stop Studio.
2. Inspect `.towerforge/*.bak`, `.towerforge/migration-backups/*.bak`, and `.towerforge/mcp-backups/*.bak` in the affected `.tdproj`.
3. Restore the relevant JSON file manually.
4. Run `npm run validate`.

For generated builds, delete the project `dist` directory and rerun `npm run build`.

For generated native scaffolds, delete `<project>/mobile` or `<project>/desktop` and rerun the matching `node packages/cli/package.mjs` command.

For desktop Studio runtime preparation, delete `packages/desktop/src-tauri/runtime` and `packages/desktop/src-tauri/binaries`, then rerun `npm run desktop:dev` or `npm run desktop:build`.

For a public desktop release with a wrong asset, checksum, or source link, remove public access immediately and follow `docs/releasing.md`. Never replace an installer silently under an existing version; issue a corrected patch release.

## Incidents

1. Capture the command, project path, changed files, and full error output.
2. Run `npm run validate`, `npm run typecheck`, and `npm run sim tutorial_01 60` when applicable.
3. Reproduce in Studio or the built player.
4. Add a focused validation guard, test, or runbook note so the same failure is cheaper to diagnose next time.
