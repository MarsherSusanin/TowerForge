# ADR 0003: Agent-Safe MCP Authoring Surface

Date: 2026-07-02

## Status

Accepted

## Context

TowerForge exposes project authoring to two agent entry points: the stdio MCP server and the Studio AI Designer. These agents can validate, simulate, build, and patch local `.tdproj` files, so the tool surface must be narrow, inspectable, and recoverable. Prompt instructions alone are not enough to protect project files from accidental broad replacements or invalid writes.

## Decision

- Keep the shared tool registry in `packages/mcp/tools.mjs`, separate from the stdio transport in `packages/mcp/server.mjs`.
- Reuse the CLI loader, validator, map compiler, build, and packaging helpers instead of duplicating project rules inside MCP.
- Advertise `riskClass` and `sideEffect` metadata on tools so callers can make permission decisions.
- Split speculative and committing actions where practical: `dry_run_balance_patch` and `compile_maps_dry_run` do not write source files; `apply_validated_patch` writes only after validation.
- Prefer granular write tools (`set_enemy_stat`, `upsert_tower`, `add_wave_group`, `bind_sprite`) over broad section replacement.
- For balance and visual writes, create backups under `.towerforge/mcp-backups` and roll back when post-write validation fails.
- Return structured results with `ok`, `written`, validation summaries, and `nextValidActions` where useful for agent loops.
- In Studio AI Designer, force `projectDir` to the active local project and send provider API keys only per request from browser `localStorage`.

## Consequences

- Agents get the same project contracts as CLI and Studio rather than raw file mutation.
- Broad tools such as `apply_balance_patch` remain for compatibility but are no longer the preferred write path.
- New agent-facing write tools must include schema validation, risk metadata, scoped writes, backup/rollback behavior, and tests.
- The remaining MCP roadmap is clear: schema introspection, generic entity CRUD/delete, source map authoring, optimistic revision tokens, and broader eval fixtures.
