# ADR 0003: Agent-Safe MCP Authoring Surface

Date: 2026-07-02 (updated 2026-07-20)

## Status

Accepted

## Context

TowerForge exposes project authoring to two agent entry points: the stdio MCP server and Studio AI Chat. These agents can validate, simulate, build, and patch local `.tdproj` files, so the tool surface must be narrow, inspectable, and recoverable. Prompt instructions alone are not enough to protect project files from accidental broad replacements or invalid writes.

## Decision

- Keep the shared tool registry in `packages/mcp/tools.mjs`, separate from the stdio transport in `packages/mcp/server.mjs`.
- Keep the canonical authoring policy in `packages/mcp/agent-instructions.mjs`; Studio direct APIs, Codex, Claude, and the stdio MCP `initialize.instructions` consume the same text.
- Expose versioned progressive schema discovery through `describe_schema({domain})`. Engine-owned descriptors define combat, mission, progression, and TowerScript vocabulary; MCP adds only adapter-owned asset workflows.
- Reuse the CLI loader, validator, map compiler, build, and packaging helpers instead of duplicating project rules inside MCP.
- Advertise `riskClass` and `sideEffect` metadata on tools so callers can make permission decisions.
- Split speculative and committing actions where practical: balance/map/progression dry-runs and theme previews do not write; committing tools write only after validation.
- Prefer compact `list_entities/get_entity`, `get_progression`, and script/tree reads plus granular write tools (entity CRUD, `apply_progression_patch`, `write_map`, `upsert_tower_script`, themes/assets, and narrative) over broad section replacement.
- Guard mutable balance, visual, and narrative files with independent content revisions so a stale agent write returns `conflict:true` without touching disk.
- For source writes, create backups under `.towerforge/mcp-backups` and roll back when post-write validation fails. Imported assets also restore or remove the destination on failure.
- Return structured results with `ok`, `written`, validation summaries, and `nextValidActions` where useful for agent loops.
- In Studio AI Chat, force `projectDir` to the active local project, derive Ask/Plan/Act permissions from MCP risk metadata, review applied diffs with Keep/Revert, and send provider API keys only per request from browser `localStorage`.

## Consequences

- Agents get the same project contracts as CLI and Studio rather than raw file mutation.
- Broad tools such as `apply_balance_patch` remain for compatibility but are no longer the preferred write path.
- New agent-facing write tools must include schema validation, risk metadata, scoped writes, backup/rollback behavior, and tests.
- Domain-scoped schema discovery, shared instructions, recipes, progression/script/theme authoring, generic CRUD/delete, source map authoring, revisions, project packs, and structured diagnostics are shipped. Remaining work is broader adversarial eval fixtures and capability pagination only if the registry outgrows domain discovery.
