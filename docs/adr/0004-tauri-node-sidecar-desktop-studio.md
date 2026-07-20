# ADR 0004: Tauri + Node Sidecar for Packaged Studio

## Status

Accepted.

## Context

TowerForge Studio is currently a local browser UI backed by `packages/studio/server.mjs`. That server reuses the Node-side project loader, validation, map compiler, build pipeline, MCP tools, AI Chat loop, and filesystem writes. Rewriting those APIs into a native backend would duplicate the most sensitive project contracts before the desktop product surface is proven.

The repository already uses Tauri v2 scaffolds for exported games, but that path packages a built game bundle under a `.tdproj`. It does not package TowerForge Studio itself.

## Decision

Package TowerForge Studio as a dedicated Tauri v2 app in `packages/desktop`, with a bundled Node sidecar that starts the existing Studio server from a prepared runtime directory.

The desktop runtime includes Studio public files, CLI/MCP libraries, renderer files, the precompiled engine `dist`, and the starter project. Packaged mode sets `TOWERFORGE_DESKTOP=1`, `TOWERFORGE_BUNDLED_RUNTIME=1`, and `TOWERFORGE_RUNTIME_ROOT`, so the loader uses bundled engine output and never requires user-installed Node, npm, or TypeScript after installation. The explicit bundled-runtime flag is separate from desktop security mode so source-level desktop integration tests can still compile the engine in a clean checkout.

The app starts the sidecar on an ephemeral loopback port, waits for a machine-readable ready line, then loads the WebView with a one-time desktop token. The server sets an HttpOnly session cookie and rejects desktop API calls without a valid token.

## Consequences

- Existing Studio, CLI, MCP, validation, and build behavior stay canonical.
- The first desktop release can ship `.exe`/`.msi`, `.dmg`, `.AppImage`, `.deb`, and `.rpm` artifacts without an Electron shell.
- Binary size includes a Node runtime sidecar.
- Production macOS and Windows releases still need external signing/notarization credentials.
- A future v2 can move selected APIs from the Node sidecar into Rust commands if the sidecar becomes a maintenance, startup, or security bottleneck.
