# ADR 0005: Native Desktop Menu and Command Bridge

## Status

Accepted.

## Context

TowerForge Studio already exposes toolbar actions, sidebar navigation, keyboard shortcuts, and a command palette. Reimplementing editor behavior in Rust would create a second UI contract, while exposing general filesystem or shell plugins to the loopback WebView would expand the desktop attack surface.

## Decision

Tauri owns the native application menu, window controls, project pickers, recent-project persistence, sidecar switching, and close/quit lifecycle. Studio owns a single `runStudioCommand` registry used by native menu events, shortcuts, toolbar controls, sidebar navigation, and the command palette.

Native-to-web commands use the `towerforge:desktop-command` event. Web-to-native calls are limited to UI-state synchronization, native project selection/creation, project switching, and confirmed lifecycle actions. The capability applies only to the main loopback WebView and grants event listening; it does not grant browser code direct filesystem or shell APIs.

About-dialog links use one additional `desktop_open_external` command. Rust accepts HTTPS URLs only for the explicitly allowed GitHub, Lindforge, and Telegram hosts, then opens them through the system browser. The WebView still has no general shell capability.

Project creation reuses the canonical CLI scaffold library. The parent directory is selected and retained by Rust, so the WebView cannot submit an arbitrary write root. Dirty project transitions are resolved by Studio with Save, Discard, or Cancel before Rust restarts the sidecar or closes the app.

## Consequences

- macOS, Windows, and Linux receive conventional native menu placement with one command model.
- Editor behavior remains browser-testable by dispatching the same desktop command event.
- Rust receives only compact UI state for menu enablement and window titles; gameplay and project editing rules remain outside the desktop package.
- v1 remains single-window. Multi-project windows require a future sidecar/session ownership decision.
