# Desktop Release Policy

TowerForge desktop artifacts are built and published through GitHub Actions. Until platform signing credentials are configured, every macOS and Windows artifact is an internal/alpha **Unsigned build**.

## Release Invariants

- A release MUST point to the exact git tag and commit used for the build.
- An unsigned release MUST be a GitHub pre-release and MUST include `Unsigned build` in its title and warning block.
- Release assets MUST include every platform installer and a plain-text `SHA256SUMS` file.
- Release notes MUST repeat the full SHA-256 value for every attached installer and link to both the tag and tagged source tree.
- Release notes MUST NOT recommend `xattr -d`, disabling Gatekeeper, or reducing operating-system security.
- A manual `Unsigned Desktop Builds` run produces a private release-candidate artifact for inspection but does not publish a release.
- A pushed `vX.Y.Z` tag publishes only after every platform build and release-assembly job succeeds.
- GitHub Actions artifacts are build evidence, not public releases. A release is complete only after its assets and notes are visible on the repository Releases page.

## Automated Pipeline

`.github/workflows/desktop-release.yml` builds on native GitHub-hosted runners:

- macOS: `.dmg`;
- Windows: NSIS `.exe` and `.msi`;
- Linux: `.AppImage`, `.deb`, and `.rpm`.

Every run creates the `towerforge-release-candidate` Actions artifact. It contains the installers, `SHA256SUMS`, and generated release notes. A manual run stops there. A tag run additionally creates a GitHub pre-release titled `TowerForge vX.Y.Z - Unsigned build` using the repository-scoped `GITHUB_TOKEN`; no provider, signing, or user API keys are exposed to the workflow.

The release assembler rejects mismatched versions across root npm, desktop npm, Tauri, and Cargo manifests, duplicate installer names, unsupported tag syntax, missing installers, and attempts to reuse an existing release tag. It never silently replaces published assets.

## Codex Plugin Mirror

`Lindforge-Studios/towerforge-codex-plugin` is a generated public marketplace, not an independent
source repository. Canonical plugin code remains under `plugins/towerforge`, `packages/mcp`, and
their dependencies in TowerForge.

The source `Build Codex Plugin Export` workflow runs manually or for `vX.Y.Z` tags. It rebuilds and
smokes the bundled runtime, exports the distribution outside the source tree, verifies every
SHA-256, and uploads a 14-day diagnostic artifact. It has read-only repository permissions.

The mirror's `Sync from TowerForge` workflow runs every six hours and on manual dispatch. It reads
public `TowerForge/main`, repeats the same gates, and pushes one generated release commit through
the mirror-scoped, short-lived `GITHUB_TOKEN`. No PAT, deploy key, or cross-repository secret is
stored. If the exported source commit is exactly tagged `vX.Y.Z` and the plugin version matches,
the workflow creates the same annotated tag in the mirror without overwriting existing tags.

The mirror `build-manifest.json` MUST contain the exact source commit, TowerForge/plugin/MCP
versions, agent-guide and protocol versions, runtime requirements, and every distributed file's
size and SHA-256. The mirror's own CI rejects missing, unexpected, symlinked, or modified files.

For an immediate plugin update, manually run `Sync from TowerForge` in the mirror after source CI
passes. Keep the workflow permission at `contents: write` and do not add repository or organization
secrets. Never use a broad organization PAT for routine mirror publication.

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

1. Confirm `package.json`, desktop npm, Tauri, and Cargo versions match the intended release tag.
2. Run the relevant quality gates from `AGENTS.md`.
3. Merge the exact source commit intended for release and confirm required CI passes.
4. Run `Unsigned Desktop Builds` manually on that commit when a cross-platform release candidate is needed before tagging.
5. Create an annotated `vX.Y.Z` tag on the release commit and push it.
6. Wait for all three native builds, release assembly, and publication to pass.
7. Confirm the GitHub pre-release title contains `Unsigned build` and all six installer formats are attached when supported by the runners.
8. Download the published installers and `SHA256SUMS`, recalculate the checksums, and compare them with the release notes.
9. Verify the DMG with `hdiutil verify` on macOS.
10. Confirm the tag, tagged source, and commit links resolve to the released commit.

## Rollback

If an asset, checksum, tag, or source link is wrong, immediately mark the release as a draft or delete the release assets. Do not silently replace an installer under the same checksum. Fix the source or build, create a new patch version, regenerate all hashes, and publish new notes.

## Incident Handling

1. Record the release URL, tag, commit, asset name, reported checksum, and observed checksum.
2. Remove public access to mismatched assets while investigating.
3. Rebuild from the tagged source in a clean environment.
4. Publish a corrected patch release; do not reuse the compromised version number.
5. If signing credentials are introduced later, follow `docs/runbook.md` and the desktop ADR before removing the unsigned warning.
