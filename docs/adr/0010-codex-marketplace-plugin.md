# ADR 0010: Workspace-Bound Codex Marketplace Plugin

## Status

Accepted.

## Context

TowerForge already exposes validated authoring tools through a local stdio MCP server, but Codex
users previously had to edit user-level MCP configuration and pin one absolute project path. Codex
plugins can package skills, MCP configuration, branding, and an executable runtime from a Git
marketplace. A public plugin must remain usable from a sparse checkout without trusting model-
supplied paths or requiring a TowerForge cloud service.

## Decision

Keep the canonical development marketplace at `.agents/plugins/marketplace.json` and the plugin at
`plugins/towerforge`. Publish a generated release mirror at
`Lindforge-Studios/towerforge-codex-plugin`; it is the public installation origin, not a second
source of truth. The plugin contains an authoring skill and a generated runtime assembled by
`npm run plugin:build` from canonical MCP, CLI, compiled engine, renderer, theme, and required
production dependency files. The runtime invokes locally available Node.js 22 and never installs
packages at use time.

The exporter records the exact TowerForge source commit, plugin/engine versions, agent guide and
MCP protocol versions, and SHA-256 for every distributed file. Tag and manual workflows update the
mirror using a write deploy key scoped only to that repository. Runtime changes are made only in
TowerForge; the mirror accepts generated release commits rather than independent implementation.

Installed mode sets `TOWERFORGE_MCP_WORKSPACE_BOUND=1`. After MCP initialization, the server asks
the client for filesystem roots. It performs a bounded, symlink-free `.tdproj` search only below
those canonical roots. One project is selected automatically; multiple projects are represented by
opaque session IDs. Public tool schemas omit `projectDir`, and an injected value is rejected. Tool
results remove `projectDir` and redact local absolute paths.

The existing direct MCP `--project` mode remains supported for Claude, IDE integrations, local
development, and legacy Codex setups. Both modes call the same transport-agnostic `callTool`
registry and therefore retain validation, risk metadata, revision guards, backups, and rollback.

## Security And Privacy

- No TowerForge account, API key, remote MCP endpoint, telemetry endpoint, or plugin OAuth is used.
- Workspace roots are treated as an allowlist and enforced with canonical paths, not as advisory
  metadata alone.
- Root discovery is depth/count bounded and ignores symlinks, dependencies, VCS state, builds, and
  local TowerForge working data.
- Failing or missing root negotiation leaves project tools unavailable rather than falling back to
  a bundled example or the user's home directory.
- Prompts and necessary tool results still reach the selected Codex/OpenAI service. Local MCP
  execution does not make the complete Codex session offline.

## Consequences

The plugin archive is larger because it includes generated runtime files and tile/theme assets,
but installation is deterministic and requires no package manager. Node remains an explicit host
prerequisite. MCP roots are supported by the negotiated 2024-11-05 protocol but deprecated in the
2026 draft; TowerForge will keep the current fail-closed contract until Codex exposes a replacement
workspace capability, then migrate behind the same workspace-session boundary.

CI rebuilds, validates, smokes, and diff-checks the generated runtime. Source package changes are
not complete until the plugin bundle is regenerated. The separate public repository provides a
small stable update origin and issue tracker without duplicating ownership of MCP or engine code.
