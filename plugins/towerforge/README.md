# TowerForge for Codex

Build and maintain local TowerForge `.tdproj` games from Codex through the same validation,
simulation, map, TowerScript, asset, balance, build, and packaging contracts used by Studio.

## Requirements

- Codex with plugin support.
- Node.js 22 or newer available as `node`.
- A Codex workspace containing one or more `.tdproj` directories.

No TowerForge server account, API key, or cloud service is required. The MCP server runs locally.
It only discovers projects below filesystem roots explicitly shared by the current Codex workspace.

## First use

1. Open the repository or directory containing the `.tdproj` game as the Codex workspace.
2. Ask Codex to use TowerForge, or choose one of the plugin starter prompts.
3. With multiple projects, select one from `list_workspace_projects` before authoring.

Writes use TowerForge validation, revision guards, backups, and rollback. Keep generated builds and
packaged artifacts under the active project; the plugin never searches the home directory.

Plugin releases and issues: [towerforge-codex-plugin](https://github.com/Lindforge-Studios/towerforge-codex-plugin)

Canonical engine and MCP source: [TowerForge](https://github.com/Lindforge-Studios/TowerForge)
