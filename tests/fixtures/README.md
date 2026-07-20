# TowerForge Test Fixtures

Committed fixture classes:

- `valid-starter`: copied from `examples/starter.tdproj` into a temporary directory by E2E tests.
- `legacy-project.json`: project manifest without `schemaVersion`, used for migration tests.
- `invalid-visuals.json`: unsafe asset paths for schema/security tests.
- Invalid map routes, TowerScript definitions, balance candidates, project packs, themes, renderer outputs, and desktop state are generated as focused temporary fixtures by their owning unit/integration suites.

Tests should copy `examples/starter.tdproj` or committed fixtures to a temporary directory before mutation. Source fixtures are not runtime project state and generated `dist`, `.towerforge`, native scaffold, or desktop bundle output must not become fixture source.

Add a committed fixture only when byte-for-byte source shape matters across tests. Prefer a local test factory for small behavior-specific cases so project schema changes do not require updating unrelated snapshots.
