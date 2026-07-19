# Desktop Release Policy

TowerForge desktop artifacts are published through GitHub Releases. Until platform signing credentials are configured, every macOS and Windows artifact is an internal/alpha **Unsigned build**.

## Release Invariants

- A release MUST point to the exact git tag and commit used for the build.
- An unsigned release MUST be a GitHub pre-release and MUST include `Unsigned build` in its title and warning block.
- Release assets MUST include the installer and a plain-text `SHA256SUMS` file.
- Release notes MUST repeat the full SHA-256 value for every attached installer and link to both the tag and tagged source tree.
- Release notes MUST NOT recommend `xattr -d`, disabling Gatekeeper, or reducing operating-system security.
- GitHub Actions artifacts are build evidence, not public releases. A release is complete only after its assets and notes are visible on the repository Releases page.

## macOS Unsigned Build

Build and verify the Apple Silicon DMG:

```bash
npm run desktop:build:mac
hdiutil verify packages/desktop/src-tauri/target/release/bundle/dmg/TowerForge_<version>_aarch64.dmg
shasum -a 256 packages/desktop/src-tauri/target/release/bundle/dmg/TowerForge_<version>_aarch64.dmg
```

Write `SHA256SUMS` using the installer basename, not an absolute path:

```text
<sha256>  TowerForge_<version>_aarch64.dmg
```

Users may install the app by moving it to Applications. If macOS blocks the first launch, the only supported override is **System Settings > Privacy & Security > Open Anyway** after verifying the checksum and release source.

## Publication Checklist

1. Confirm `package.json` and Tauri versions match the release tag.
2. Run the relevant quality gates from `AGENTS.md`.
3. Build the installer from a clean source commit.
4. Verify the DMG and calculate SHA-256.
5. Create an annotated version tag on that commit and push it.
6. Create a GitHub pre-release titled `TowerForge <tag> - Unsigned build`.
7. Use [the canonical release-notes example](examples/unsigned-release-notes.md), replacing every placeholder.
8. Attach the installer and `SHA256SUMS`.
9. Download both assets from GitHub, recalculate the checksum, and compare it with the release notes.
10. Confirm the tag and source links resolve to the released commit.

## Rollback

If an asset, checksum, tag, or source link is wrong, immediately mark the release as a draft or delete the release assets. Do not silently replace an installer under the same checksum. Fix the source or build, create a new patch version, regenerate all hashes, and publish new notes.

## Incident Handling

1. Record the release URL, tag, commit, asset name, reported checksum, and observed checksum.
2. Remove public access to mismatched assets while investigating.
3. Rebuild from the tagged source in a clean environment.
4. Publish a corrected patch release; do not reuse the compromised version number.
5. If signing credentials are introduced later, follow `docs/runbook.md` and the desktop ADR before removing the unsigned warning.
