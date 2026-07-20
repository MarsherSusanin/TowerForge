# Security

TowerForge is local-first, but local projects, imported packs, browser requests, AI prompts, and provider runtimes still cross trust boundaries. Treat every `.tdproj`, `.tdpack`, asset, attachment, and model response as untrusted input.

## Project And Filesystem Boundary

- Studio and packaged sidecars MUST bind to loopback. Desktop API routes additionally require the per-session token/cookie and reject invalid Host/Origin requests.
- Project reads and writes MUST stay under the active `.tdproj`. Asset/build/import paths reject absolute paths, external URLs, `..` traversal, symlink escapes, and unsafe archive entries.
- Loaded projects MUST pass schema, reference, and path validation before simulation or build. Project packs additionally pass archive path, checksum, entry-count, and size limits before extraction; existing import destinations are never overwritten.
- Generic project-tree editing is confined to `scripts/**/*.tower.json`. Content, maps, assets, narrative, and build targets use validation-aware APIs with revisions, atomic writes, backups, and rollback.
- Generated output stays under project-owned output directories. `.towerforge/` contains local traces, revisions, and backups and MUST NOT be committed.

## TowerScript Sandbox

TowerScript is versioned JSON interpreted by `packages/engine`; it is not JavaScript or Lua. It has a finite event/action vocabulary, deterministic mission time, serializable state, and budgets for expressions, actions, events, recursion, spawns, state, and payload size.

TowerScript MUST NOT use `eval`, `Function`, package imports, filesystem, network, DOM, environment, wall-clock time, host randomness, or raw host objects. Missing mechanics must be implemented as typed engine events/actions with deterministic tests. Runtime failures produce structured diagnostics instead of escaping the simulation.

## AI And Account Runtimes

- Direct Anthropic, OpenAI, and OpenRouter keys remain in browser `localStorage`; they are sent only to the loopback server for the selected request and are never stored in projects, traces, or support logs.
- Codex App Server and Claude Agent SDK/Claude Code exclusively own OAuth/account credentials. TowerForge exposes safe status/connect/logout operations and MUST NOT read, return, log, or persist provider tokens or credential caches.
- Account runtimes run with a private home and empty working directory. Child environments omit API keys, cloud/proxy credentials, debug variables, and unrelated user environment. Codex filesystem access is restricted to the isolated turn workspace; Claude built-in tools are disabled.
- Models receive only the allowlisted TowerForge tools. Raw shell, arbitrary filesystem access, package/build tools, and model-selected project roots are not exposed.
- Attachments require explicit selection and MIME/signature/size checks. Video is decoded locally into bounded still frames; the original video, filename, and audio are not sent.
- Prompts, selected attachments, and required tool results leave the machine for the selected provider. Credential isolation does not make inference offline.

## Desktop Boundary

The Tauri capability bridge is limited to the main loopback WebView and narrow menu/window/project commands. Web content MUST NOT receive direct filesystem, shell, or unrestricted path capabilities. Unsigned desktop distribution follows [docs/releasing.md](docs/releasing.md); never advise users to disable Gatekeeper or remove quarantine attributes.

## Reporting

Report security issues privately to the repository maintainer before public disclosure. Include reproduction steps, affected command/API, platform, TowerForge version or commit, and the smallest redacted project fixture that demonstrates the issue. Never include provider credentials, OAuth artifacts, private project content, or user-local paths that are not required to reproduce the problem.
