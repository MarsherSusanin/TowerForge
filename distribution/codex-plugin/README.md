<p align="center">
  <img src="plugins/towerforge/assets/logo.png" alt="TowerForge" width="128">
</p>

# TowerForge for Codex

Use Codex to inspect, author, validate, simulate, balance, script, and package local TowerForge
games through project-aware tools.

Current plugin version: `{{PLUGIN_VERSION}}`

## Install

In Codex **Add plugin marketplace**, use:

- Source: `Lindforge-Studios/towerforge-codex-plugin`
- Git ref: `main`, or a published release tag
- Sparse paths: leave empty

CLI equivalent:

```bash
codex plugin marketplace add Lindforge-Studios/towerforge-codex-plugin --ref main
codex plugin add towerforge@towerforge
```

Start a new Codex task after installation. Open a workspace containing one or more `.tdproj`
directories. The plugin selects a single project automatically; with several projects, ask Codex
to list and select the workspace project.

## Requirements

- Codex with plugin support.
- Node.js 22 or newer available as `node`.
- A local TowerForge `.tdproj` workspace.

No TowerForge account, API key, package installation, or cloud MCP endpoint is required.

## Security

The bundled MCP server runs locally and accepts projects only from filesystem roots shared by the
current Codex workspace. It rejects model-supplied absolute project paths, symlinked project trees,
path traversal, and unsupported writes. Project writes use TowerForge validation, revision guards,
backups, and rollback. Local MCP execution does not make the complete Codex session offline:
prompts and necessary tool results are sent to the selected OpenAI service.

See [SECURITY.md](SECURITY.md) for reporting and trust boundaries.

## Provenance

This is a generated release mirror. Do not edit runtime files here. Every release records its exact
source commit and per-file SHA-256 values in `build-manifest.json`.

- Canonical source: [Lindforge-Studios/TowerForge](https://github.com/Lindforge-Studios/TowerForge)
- Source commit: [`{{SOURCE_COMMIT}}`](https://github.com/Lindforge-Studios/TowerForge/commit/{{SOURCE_COMMIT}})
- Distribution workflow: `Sync from TowerForge` in this mirror. It uses only this repository's
  short-lived `GITHUB_TOKEN`; no cross-repository credential is stored.
