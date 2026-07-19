## Summary

- 

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build:engine`
- [ ] `npm run validate`
- [ ] `npm run sim tutorial_01 60`
- [ ] `npm run build`
- [ ] `npm run test:e2e`

## Boundaries

- [ ] Engine remains DOM/Node/filesystem/Studio-free.
- [ ] Project format, validation, or build-output changes are documented.
- [ ] Generated build output is not treated as source.

## Desktop Release Safety

- [ ] Not applicable, or the unsigned release procedure in `docs/releasing.md` was followed.
- [ ] Release notes identify the build as unsigned and link the exact tag and source tree.
- [ ] Installer checksums are present in both `SHA256SUMS` and the release notes.
- [ ] User guidance does not disable Gatekeeper or remove quarantine attributes.
