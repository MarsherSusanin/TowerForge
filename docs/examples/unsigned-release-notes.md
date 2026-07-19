# TowerForge vX.Y.Z - Unsigned build

> [!WARNING]
> This is an unsigned alpha build. macOS cannot verify the developer or notarization status. Verify the SHA-256 checksum before opening the application.

## Downloads

- `TowerForge_X.Y.Z_aarch64.dmg` - macOS Apple Silicon unsigned build.
- `SHA256SUMS` - checksums for the attached release assets.

## SHA-256

```text
<full-sha256>  TowerForge_X.Y.Z_aarch64.dmg
```

## Install On macOS

1. Verify the DMG against `SHA256SUMS`.
2. Move TowerForge to Applications.
3. Try to open TowerForge.
4. If macOS blocks it, open System Settings > Privacy & Security and choose Open Anyway.

TowerForge does not require disabling Gatekeeper or changing global security settings.

## Source

- Tag: `https://github.com/MarsherSusanin/TowerForge/releases/tag/vX.Y.Z`
- Tagged source: `https://github.com/MarsherSusanin/TowerForge/tree/vX.Y.Z`
- Commit: `<full-commit-sha>`

## Verification

- `<quality-gate and result>`
- DMG checksum verified with `hdiutil verify`.
- Packaged sidecar and bundled AI runtimes smoke-tested from the mounted DMG.
