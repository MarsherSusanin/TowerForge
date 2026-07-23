# Runbook

## Local Development

| Task | Command | Notes |
| --- | --- | --- |
| Install | `npm install` | Uses npm workspaces. |
| Run Studio | `npm run studio` | Opens `http://localhost:5174`, default project `examples/starter.tdproj`. |
| Run Studio for another project | `node packages/studio/server.mjs --project /path/to/game.tdproj` | Set `PORT=<n>` when `5174` is busy. |
| Run MCP server | `npm run mcp -- --project examples/starter.tdproj` | JSON-RPC over stdio for MCP-capable agents. |
| Build Codex plugin | `npm run plugin:build` | Regenerates the self-contained runtime and brand assets under `plugins/towerforge`. |
| Validate Codex plugin | `npm run plugin:validate` | Checks manifest, marketplace, component paths, and bundled runtime. |
| Smoke Codex plugin | `npm run plugin:smoke` | Exercises initialize, workspace roots, project discovery, path rejection, and bundled validation. |
| Validate | `npm run validate` | Uses engine validation through the Node project loader. |
| Validate JSON | `npm run validate -- --json` | Machine-readable validation for CI and agents. |
| Simulate | `npm run sim tutorial_01 60` | Runs an engine-backed headless smoke simulation. |
| Simulate JSON | `npm run sim tutorial_01 60 -- --json` | Machine-readable smoke simulation with aggregate events, timelines, milestones, strategy, and next actions. |
| Balance sweep | `npm run balance -- --project examples/starter.tdproj` | Multi-strategy deterministic balance report with advisor flags. |
| Compile map sources | `npm run maps:compile -- --project examples/starter.tdproj` | Writes `maps/compiled/maps.json` from `maps/src/*.tmj`. |
| Migrate project schema | `npm run migrate -- --project examples/starter.tdproj --write` | Writes migrated files after creating `.towerforge/migration-backups`. |
| Typecheck | `npm run typecheck` | Engine only. |
| Compile engine runtime | `npm run build:engine` | Writes `packages/engine/dist`. |
| Unit/integration tests | `npm run test` | Engine, CLI, MCP, renderer contracts, templates, packs, and shared logic. |
| Build web player | `npm run build` | Writes `examples/starter.tdproj/dist`, including engine, renderer, project data, and safe project assets. |
| Build single-file player | `npm run build -- --single-file` | Also emits `index.single.html`, runnable directly from `file://`. |
| Package portable web archive | `npm run package:web -- --project examples/starter.tdproj` | Writes a PWA, single-file fallback, loopback launcher, and deterministic ZIP under `<project>/web`. |
| Export project handoff | `npm run project:export -- --project examples/starter.tdproj --out game.tdpack` | Writes a deterministic checksummed archive after validation. |
| Import project handoff | `npm run project:import -- game.tdpack --dir ./projects` | Confines extraction, validates, and refuses an existing destination. |
| List bundled themes | `npm run themes:list` | Lists local packs without reading or changing a project. |
| Preview a theme | `npm run themes:apply -- verdant-frontier --project examples/starter.tdproj --dry-run` | Reports affected files/missions and the revision without writing. |
| Apply a theme | `npm run themes:apply -- verdant-frontier --project examples/starter.tdproj` | Copies only bundled assets, backs up catalogs, validates, and rolls back on failure. |
| Regenerate bundled tile sheets | `npm run tiles:build-presets` | Deterministically writes square/hex sheets for Verdant Frontier and Frostbound Citadel. |
| Package mobile scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind mobile` | Builds the web bundle into a Capacitor project under `<project>/mobile`. |
| Package desktop scaffold | `node packages/cli/package.mjs --project examples/starter.tdproj --kind desktop` | Builds the web bundle into a Tauri v2 project under `<project>/desktop`. |
| Run packaged Studio shell | `npm run desktop:dev` | Prepares the bundled runtime and launches the Tauri desktop wrapper around Studio. |
| Build desktop Studio installers | `npm run desktop:build` | Produces Tauri bundles under `packages/desktop/src-tauri/target/release/bundle`. |
| Test desktop shell | `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` | Native menu/state/close lifecycle tests. |
| E2E smoke | `npm run test:e2e` | Starts Studio against a temp project and verifies build/player interactions with Playwright. |

Russian is the default Studio language. Switch between Russian and English under **Settings > Appearance > Language**; the choice is stored only on the current device as `towerforge:language`. In desktop builds the same setting also rebuilds the native menu. Project content is never translated or modified by this preference.

The template/grid/renderer conformance gate is part of `npm run test` and `npm run test:e2e`: Classic, Maze, Idle, and Roguelike are built on hex and square grids with Canvas and Phaser. The 16-output matrix must boot, render nonblank tile pixels, expose difficulty/meta UI, and place a tower through exact pointer picking and keyboard focus plus Enter.

## Codex Marketplace Plugin

The canonical source and development marketplace live in this repository. Public installation uses
the generated mirror `Lindforge-Studios/towerforge-codex-plugin`. In Codex
**Add plugin marketplace**, use:

- Source: `Lindforge-Studios/towerforge-codex-plugin`
- Git ref: `main` during development, or a release tag that contains the plugin
- Sparse paths: leave empty

Then install `towerforge@towerforge`. The equivalent CLI flow is:

```bash
codex plugin marketplace add Lindforge-Studios/towerforge-codex-plugin --ref main
codex plugin add towerforge@towerforge
```

Start a new Codex task after installation or update. Open a workspace that contains the target
`.tdproj`. One discovered project is selected automatically; for several, use
`list_workspace_projects` and `select_workspace_project`.

The plugin requires Node.js 22+ as `node`, but does not run `npm install`, download dependencies,
or require TowerForge credentials. Its MCP process is local. Codex still sends user prompts and
the tool results needed for the task to the selected OpenAI service; do not describe the overall
agent session as offline. The server itself has no network integration, accepts projects only from
filesystem roots shared by the current workspace, rejects absolute `projectDir` arguments, skips
symlinks, bounds discovery depth/count, and redacts local paths in tool results.

After changing MCP, CLI, engine dist, renderer, or bundled themes, run:

```bash
npm run build:engine
npm run plugin:build
npm run plugin:validate
npm run plugin:smoke
```

Commit the regenerated `plugins/towerforge/runtime` and `plugins/towerforge/assets`. CI rebuilds
them and fails on any diff, preventing a stale marketplace bundle. A source tag or manual
`Build Codex Plugin Export` workflow produces a verified diagnostic artifact with the exact
TowerForge source commit and per-file SHA-256 values.

The public mirror owns `Sync from TowerForge`. It runs every six hours or on manual dispatch,
rebuilds from public `TowerForge/main`, and commits only a verified export. Publication uses the
short-lived `GITHUB_TOKEN` scoped to the mirror itself; neither repository stores a PAT, SSH key,
or credential that can write to both repositories. Run the mirror workflow manually when a release
must appear immediately rather than waiting for the schedule.

## Grid And Tileset Authoring

Every map selects `hex`/`odd-r` or `square`/`cardinal`. Square routes accept only north/east/south/west neighbors; movement, ranges, auras, splash, direct-flight lines, and footprints use Manhattan topology. Run `npm run maps:compile -- --project <project>` after source edits.

Open **Assets > Tileset Workbench** to import a PNG spritesheet with a Tiled `.tsj` or `.tsx` descriptor. Select both files, verify topology and slicing, inspect the mask coverage list and image grid, then edit material/signature weights or typed terrain JSON if mapping is incomplete. Any edit invalidates the commit until **Preview tileset** runs again.

Supported Tiled data is limited to tileset image/slicing, Wang sets, tile probability, transformations, and `towerforge.terrainId`, `buildable`, `walkable`, `groundSpeedMultiplier`, `tags`, `connectGroup`, `connectionSource`. PNG is limited to 10 MB, descriptors to 2 MB, and 4096 tiles. Remote images, absolute/traversing paths, symlinks, non-PNG content, XML DTD/entities, unknown properties, invalid dimensions, and stale revisions fail closed. Apply writes the image and both catalogs atomically with backups and rollback.

Studio may show color fallback while a tileset is incomplete. This is a draft state only: `npm run build` and MCP `release_readiness` fail when any reachable map tile needs a missing signature. Agent workflow is `describe_schema({domain:"tiles"})` -> `inspect_tileset`/`preview_tileset_import` -> `preview_tile_binding` -> `bind_map_tileset` -> `render_tileset_preview` -> `release_readiness`. The agent must inspect the PNG contact sheet returned by `render_tileset_preview`; a clean structured coverage report alone is not a visual seam check.

## TowerScript Authoring

Open `Project > Scripts` or the **Scripts** sidebar item. The left pane is a filtered project tree; project/content/map files can be inspected there, while generic editing and file operations are intentionally limited to `scripts/`.

TowerScript files:

- live under `scripts/` and end in `.tower.json`;
- declare `schemaVersion: 1` or `2`, a unique `id`, one or more `bindings`, optional `initialState`, and lifecycle `handlers`; use v2 for terrain events/actions;
- bind to `global`, `mission`, `map`, `wave` (wave-set id), `tower` (tower-type id), `enemy` (enemy-type id), `ability` (ability id), or v2 `terrain` (terrain id);
- read values with `{ "$get": "event.enemyTypeId" }` and compose conditions/math with `{ "$op": "eq", "args": [...] }`;
- run typed actions such as resource/core/enemy changes, statuses, tower cooldown/stacks, enemy spawning, state updates, custom signals, and v2 `setTileTerrain`/`restoreTileTerrain`;
- can receive author-defined JSON events through the engine `emitScriptSignal` method or a headless `{ type: "emitSignal" }` action.

Save validates the candidate definition and all project references before an atomic write. A stale source revision returns a conflict; invalid post-write state restores the previous file. The runtime also caps expression work, actions, events, recursion, spawns, state, and payload size. A runtime error appears in `snapshot.scriptState.diagnostics` and as a `scriptDiagnostic` event instead of crashing the game.

TowerScript deliberately cannot run JavaScript, import packages, access files/network/DOM/environment, read wall-clock time, or generate randomness. Add a missing capability as a typed engine event/action with deterministic tests; do not add `eval`, `Function`, or raw host bridges.

Terrain changes are runtime-only. A duration restores authored terrain; no duration keeps the override until explicit restore or run end. Scripts may change at most 64 tiles per event transaction and hold 512 active overrides. Active route cells cannot become non-walkable; changing `buildable` never deletes an existing tower.

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

For a no-server handoff, run `npm run build -- --single-file` and open `dist/index.single.html`. For a distributable web ZIP with its own loopback launcher, use `npm run package:web`.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `PROJECT_DIR` | no | Overrides the default `.tdproj` project for Studio/CLI. |
| `PORT` | no | Overrides Studio port, default `5174`. |
| `ANTHROPIC_BASE_URL` | no | Overrides the AI Chat Anthropic base URL, default `https://api.anthropic.com`. |
| `OPENAI_BASE_URL` | no | Overrides the AI Chat OpenAI base URL, default `https://api.openai.com/v1`. |
| `OPENROUTER_BASE_URL` | no | Overrides the AI Chat OpenRouter base URL, default `https://openrouter.ai/api/v1`. |

Packaged Studio builds set internal desktop variables such as `TOWERFORGE_DESKTOP`, `TOWERFORGE_BUNDLED_RUNTIME`, `TOWERFORGE_RUNTIME_ROOT`, `TOWERFORGE_USER_DATA_DIR`, and `TOWERFORGE_SESSION_TOKEN`. `TOWERFORGE_DESKTOP` enables loopback/session security, while `TOWERFORGE_BUNDLED_RUNTIME` requires the precompiled engine shipped in the app. These are runtime diagnostics only; normal users should not need to set them manually.

Configure AI under `Settings > AI Connections`; provider, model, and reasoning defaults are under `Settings > AI Chat Defaults`. Open the right-side chat from the top bar, sidebar, command palette, or native `Project > AI Chat` command. AI Chat has two authentication paths:

- **Account runtimes**: Codex uses ChatGPT OAuth through Codex App Server; Claude Code uses the official Claude Agent SDK/runtime login. Click Connect and finish the provider-owned browser flow. TowerForge never receives the OAuth token and does not read the runtime credential cache. Credentials live under the provider runtime's protected directory in `<app-data>/agent-runtimes`; Codex is configured to use the OS keyring.
- **Direct APIs**: Anthropic, OpenAI, and OpenRouter keys remain separate browser `localStorage` entries for that device and are sent only to the loopback Studio server for the selected request. The old `towerforge:anthropic-key` entry is migrated automatically.

Both paths send the user prompt and the tool results needed for the task to the selected provider. Account isolation protects credentials; it does not make inference offline. TowerForge disables local account-runtime transcript persistence, gives each runtime a private home and empty working directory, restricts Codex filesystem reads to that workspace, disables Claude built-in tools, exposes only validated TowerForge tools, and does not inherit API/cloud/proxy credentials into the runtime process. Never put provider credentials in `.tdproj` files, committed docs, traces, or support logs.

AI Chat accepts up to eight JPEG/PNG/GIF/WebP images per turn, at most 4 MB each and 10 MB total. For a selected video up to 200 MB, the WebView decodes it locally and samples up to four JPEG frames. Only those frames are sent; the filename, original video, and audio are not sent. Codex attachment files use generated names inside its isolated turn directory and are deleted after the turn.

## Debugging

- Studio load failures: run `npm run validate`, then restart `npm run studio`.
- Engine compile failures: run `npm run typecheck`, then `npm run build:engine`.
- Build failures: inspect validation output first; build stops on validation errors.
- Project write conflicts: Studio returns a conflict when files changed on disk after load; reload before saving again.
- Browser player issues: serve the normal `dist` directory over HTTP. Only the generated `index.single.html` is designed and tested for direct `file://` use.
- Map compile issues: run `npm run maps:compile -- --project <project> --json` and inspect source map issues.
- Tileset import issues: verify that PNG filename matches the descriptor image basename, slicing fits the decoded image, all properties are allowlisted, and the descriptor's topology matches the destination map. Use `preview_tile_binding` to distinguish missing reachable masks from unused preset masks.
- Studio action traces: inspect `.towerforge/runs/*.jsonl` inside the active `.tdproj`.
- MCP edits: call domain-scoped `describe_schema`, then prefer compact reads, `get_progression`, recipes, `dry_run_progression_patch`, `preview_theme_pack`, and granular commit tools such as `apply_progression_patch`, `upsert_tower_script`, `apply_theme_pack`, or entity/map/asset/narrative writes. Commits validate, accept revision guards, and keep rollback backups under `.towerforge/mcp-backups` or `.towerforge/backups`.
- TowerScript load failures: run `npm run validate` and inspect the reported script file/field. Parse errors are associated with the source path; reference/schema errors identify the script id and field path.
- TowerScript runtime issues: inspect Studio Playtest events or `snapshot.scriptState.diagnostics`. Budget errors usually indicate recursive signals, broad `allEnemies/allTowers` work, or an unbounded tick handler; add `when`/`every`, narrow the binding, or split the rule.
- MCP tool discovery: run `npm run mcp -- --project <project>` and issue `tools/list`; tools include `riskClass` and `sideEffect` metadata for permission decisions.
- AI Chat direct-provider issues: verify the selected provider has a saved browser-local key and a tool-capable model, check `/api/ai/chat`, then reproduce the same action through `validate_project`, `simulate_mission`, or `balance_report`. OpenRouter model discovery uses `/api/ai/models?provider=openrouter`; Codex and Claude use the same endpoint with `provider=codex|claude-code`. Custom model IDs remain available when a live catalog is offline.
- Codex/Claude account issues: use Disconnect, restart Studio, and Connect again. The safe status endpoint is `/api/ai/runtime/status?provider=codex` or `provider=claude-code`; it never returns tokens. A packaged build must contain compatible packages under `runtime/node_modules/@openai` and `runtime/node_modules/@anthropic-ai`. `TOWERFORGE_CODEX_BIN` and `TOWERFORGE_CLAUDE_BIN` are internal test/diagnostic overrides only and must point to an absolute trusted executable path.
- Native packaging issues: inspect `<project>/mobile/README.md` or `<project>/desktop/README.md`; TowerForge only scaffolds Capacitor/Tauri projects and does not install native SDKs, sign binaries, or submit to stores.
- Desktop Studio packaging issues: run `npm run desktop:dev` first to verify the sidecar starts, then inspect `packages/desktop/src-tauri/runtime` for Studio files and production agent-runtime dependencies, and `packages/desktop/src-tauri/binaries` for the Node sidecar binary. If `/api/health` works but the app UI does not load, check the desktop session token/cookie handshake in the Tauri console.
- Linux AppImage agent runtime issues: the bundled Claude executable is stored with a masked ELF header plus a SHA-256 manifest so `linuxdeploy` does not rewrite or inspect the standalone runtime. On first use Studio verifies it, restores a `0700` copy under the private desktop app-data `agent-runtimes/bin` directory, verifies it again, and only then executes it. Do not unpack or patch this file manually.
- Desktop menu/bridge issues: confirm `packages/desktop/src-tauri/capabilities/main.json` allows only the main `http://127.0.0.1:*` WebView, then inspect the WebView console for `Desktop bridge setup failed`. Delete only `<app-data>/desktop-state.json` to reset last/recent projects without touching project data.
- E2E browser issues: install Playwright browsers with `npx playwright install chromium` if the local browser binary is missing.

## Deploy

Deployable web-game artifacts are the static bundle from `npm run build`, its optional `index.single.html`, or the deterministic archive from `npm run package:web`. The installable TowerForge Studio artifacts come from `npm run desktop:build`:

- Windows: `packages/desktop/src-tauri/target/release/bundle/nsis/*.exe` and `packages/desktop/src-tauri/target/release/bundle/msi/*.msi`
- macOS: `packages/desktop/src-tauri/target/release/bundle/dmg/*.dmg`
- Linux: `packages/desktop/src-tauri/target/release/bundle/appimage/*.AppImage`, `packages/desktop/src-tauri/target/release/bundle/deb/*.deb`, and `packages/desktop/src-tauri/target/release/bundle/rpm/*.rpm`

CI is configured in `.github/workflows/ci.yml` for local-alpha quality gates. `.github/workflows/desktop-release.yml` builds unsigned desktop artifacts on Windows, macOS, and Ubuntu. A manual run uploads a consolidated `towerforge-release-candidate` Actions artifact. Pushing a matching `vX.Y.Z` tag additionally publishes that candidate as a GitHub pre-release after version, installer, and checksum validation. Production macOS distribution requires Developer ID signing plus notarization; production Windows distribution requires a code-signing certificate.

Public desktop releases follow [the desktop release policy](releasing.md). Until signing is configured, they remain GitHub pre-releases with `Unsigned build` in the title. To inspect a cross-platform candidate without publishing, run **Actions > Unsigned Desktop Builds > Run workflow** against the intended commit. To publish, merge the release commit, then create and push an annotated tag whose version matches all desktop manifests:

```bash
git tag -a vX.Y.Z -m "TowerForge vX.Y.Z"
git push origin vX.Y.Z
```

The workflow refuses to overwrite an existing release. After publication, the release operator must download all GitHub-hosted installers and `SHA256SUMS`, recalculate every checksum, run `hdiutil verify` for the DMG on macOS, and verify the tag, commit, and source links. GitHub Actions artifacts are build evidence, not a substitute for the published GitHub Release.

## Rollback

For local project edits:

1. Stop Studio.
2. Inspect `.towerforge/*.bak`, `.towerforge/migration-backups/*.bak`, `.towerforge/mcp-backups/*.bak`, `.towerforge/backups/scripts`, and `.towerforge/backups/theme-*` in the affected `.tdproj`.
3. Restore the relevant JSON file manually.
4. Run `npm run validate`.

For generated builds, delete the project `dist` directory and rerun `npm run build`.

For generated portable web packages, delete only the selected `<project>/web` output and rerun `npm run package:web`; project source files are not modified.

For generated native scaffolds, delete `<project>/mobile` or `<project>/desktop` and rerun the matching `node packages/cli/package.mjs` command.

For desktop Studio runtime preparation, delete `packages/desktop/src-tauri/runtime` and `packages/desktop/src-tauri/binaries`, then rerun `npm run desktop:dev` or `npm run desktop:build`.

For a public desktop release with a wrong asset, checksum, or source link, remove public access immediately and follow `docs/releasing.md`. Never replace an installer silently under an existing version; issue a corrected patch release.

## Incidents

1. Capture the command, project path, changed files, and full error output.
2. Run `npm run validate`, `npm run typecheck`, and `npm run sim tutorial_01 60` when applicable.
3. Reproduce in Studio or the built player.
4. Add a focused validation guard, test, or runbook note so the same failure is cheaper to diagnose next time.
