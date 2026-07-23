# Security Policy

## Reporting

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/Lindforge-Studios/towerforge-codex-plugin/security/advisories/new).

Include the plugin version, `sourceCommit` from `build-manifest.json`, affected tool, expected trust
boundary, and a minimal reproduction without credentials or private project data.

## Trust Boundaries

- The plugin MCP server is local and has no TowerForge cloud backend.
- Codex/OpenAI receives prompts and tool results required for the selected task.
- Filesystem access is limited in application logic to roots shared by the Codex workspace.
- Project-authored TowerScript cannot access filesystem, network, shell, environment, clock, DOM,
  package imports, or arbitrary JavaScript execution.
- Project writes use narrow schemas, risk metadata, validation, revision guards, backups, and
  rollback where supported.

Never include API keys, OAuth tokens, private keys, credentials, or private project archives in a
security report.

## Supported Versions

Only the latest release on `main` is supported. The exact canonical source revision and distributed
file hashes are recorded in `build-manifest.json`.
