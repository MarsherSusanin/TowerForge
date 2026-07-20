# ADR 0006: Official Account Agent Runtimes

Date: 2026-07-19

## Status

Accepted.

## Context

TowerForge AI Chat already supports direct Anthropic, OpenAI, and OpenRouter API keys and can expose the constructor through an external stdio MCP server. Desktop users also need an account-based path that uses their ChatGPT or Claude subscription without copying consumer OAuth tokens into TowerForge or calling undocumented provider endpoints.

An OAuth token is not an application integration contract. Reading another app's credential files, accepting access tokens in the WebView, or replaying consumer OAuth against direct model APIs would make TowerForge responsible for secret storage and refresh semantics and could violate provider policy.

## Decision

- Integrate ChatGPT accounts only through the official Codex App Server managed-auth flow: `account/read`, `account/login/start` with `type: chatgpt`, and `account/logout`.
- Integrate Claude accounts only through the official Claude Agent SDK and its bundled Claude Code runtime. TowerForge launches `auth login/status/logout`; it never reads `.credentials.json`, Keychain entries, or OAuth environment variables.
- Bundle pinned official Codex and Claude runtime packages into the desktop runtime. Users do not need global CLI installations.
- Reuse `packages/mcp/tools.mjs` as the canonical tool contract, but do not require project `.mcp.json` for account mode. Codex receives App Server dynamic tools. Claude receives an in-process SDK tool server because that is the Agent SDK's supported custom-tool transport; it is not exposed as a local port or user-configured stdio server.
- Expose only the AI Chat allowlist. Build/package commands, raw file access, shell, web tools, plugins, skills, and arbitrary executable/path inputs are unavailable.
- Force `projectDir` to the active Studio project on every tool call. Existing validation, optimistic revisions, backups, and rollback remain authoritative.
- Start both runtimes from an empty app-data working directory. Codex uses ephemeral threads and an explicit restricted-read sandbox whose only application root is that empty workspace. Claude receives no built-in tools, no settings sources, no session persistence, and a fail-closed `canUseTool` callback.
- Construct a minimal child environment with a private runtime `HOME`/Windows profile. Do not inherit the user's home path, provider API keys, cloud credentials, proxy credentials, tracing, debug, or telemetry configuration. Disable nonessential runtime traffic and auto-updates where supported.
- Keep account data in `<app-data>/agent-runtimes`, outside `.tdproj` projects and app bundles, with private directory/file modes where the OS supports them. Configure Codex credential storage for the OS keyring.
- Return only `{available, connected, method, subscription}` to the WebView. Authorization URLs must be HTTPS and match an explicit OpenAI host allowlist before the native shell opens them. The unauthenticated loopback health response and sidecar ready event do not include project paths.
- Apply a Studio CSP that limits browser connections to the current loopback origin. Desktop API routes remain protected by exact Host/Origin checks plus the HttpOnly desktop session cookie.
- Keep account connections and direct API keys in Settings. Model and reasoning defaults are device-local; the right-side AI Chat uses the same provider state from the top bar, sidebar, command palette, and native menu.
- Discover Codex models through App Server `model/list` and Claude models through Agent SDK `supportedModels()`. Pass the selected reasoning effort per turn. Unsupported catalogs or effort values fail without silently changing provider.
- Accept only JPEG, PNG, GIF, and WebP attachments after base64, byte-size, and magic-signature validation. Materialize Codex images under a private generated turn directory and remove it in `finally`; pass base64 images directly to Claude and direct APIs. Never pass a browser-supplied local path to a runtime.
- Treat video as a local preprocessing feature, not provider video support: the WebView samples up to four still frames. Filenames, audio, and original video files are not included in provider requests.
- State the data boundary honestly: prompts and requested TowerForge tool results are sent to the chosen provider for inference. OAuth credentials, unrelated environment secrets, arbitrary project files, and local runtime transcripts are not sent by TowerForge.

## Consequences

- Users can choose ChatGPT/Claude account billing or the existing direct API-key providers without configuring external MCP, then use one integrated AI Chat surface.
- TowerForge never becomes an OAuth client-secret store and cannot silently fall back from subscription auth to an inherited API key.
- Agent access is narrower than a normal coding CLI session. This intentionally trades general code-editing capability for validated constructor operations.
- Desktop artifacts become substantially larger because they include Node, Codex, Claude Code, and their platform binaries.
- Codex dynamic tools are experimental in the current App Server protocol. Versions are pinned; schema/protocol drift must fail closed and requires adapter tests before upgrades.
- Provider-side retention and account policies still apply to prompts and tool results. TowerForge's local privacy controls cannot override provider processing terms.

## References

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
