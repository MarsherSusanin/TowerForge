# TowerForge vX.Y.Z - Unsigned build

> [!WARNING]
> This is an unsigned alpha build. macOS cannot verify the developer or notarization status. Verify the SHA-256 checksum before opening the application.

## Downloads

- `TowerForge_X.Y.Z_aarch64.dmg` - macOS Apple Silicon unsigned build.
- `TowerForge_X.Y.Z_x64-setup.exe` - Windows NSIS unsigned installer.
- `TowerForge_X.Y.Z_x64_en-US.msi` - Windows MSI unsigned installer.
- `TowerForge_X.Y.Z_amd64.AppImage` - Linux AppImage.
- `TowerForge_X.Y.Z_amd64.deb` - Debian/Ubuntu package.
- `TowerForge-X.Y.Z-1.x86_64.rpm` - Fedora/RHEL package.
- `SHA256SUMS` - checksums for every attached installer.

## SHA-256

```text
<full-sha256>  TowerForge_X.Y.Z_aarch64.dmg
<full-sha256>  TowerForge_X.Y.Z_x64-setup.exe
<full-sha256>  TowerForge_X.Y.Z_x64_en-US.msi
<full-sha256>  TowerForge_X.Y.Z_amd64.AppImage
<full-sha256>  TowerForge_X.Y.Z_amd64.deb
<full-sha256>  TowerForge-X.Y.Z-1.x86_64.rpm
```

## Installation Safety

- macOS: verify the DMG, move TowerForge to Applications, and use System Settings > Privacy & Security > Open Anyway only if the verified build is blocked.
- Windows: keep SmartScreen and antivirus enabled, verify the installer checksum, and confirm this GitHub release is the source.
- Linux: verify the package or AppImage checksum before opening it.

TowerForge does not require disabling Gatekeeper, SmartScreen, antivirus, or other operating-system security controls.

## Source

- Tag: `https://github.com/Lindforge-Studios/TowerForge/releases/tag/vX.Y.Z`
- Tagged source: `https://github.com/Lindforge-Studios/TowerForge/tree/vX.Y.Z`
- Commit: `<full-commit-sha>`

## Verification

- `<quality-gate and result>`
- All attached assets match `SHA256SUMS` and the release-note hashes.
- DMG checksum verified with `hdiutil verify` on macOS.
- Packaged sidecar and bundled AI runtimes smoke-tested from the mounted DMG.
