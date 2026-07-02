# TowerForge Test Fixtures

Fixture classes for local alpha regression tests:

- `valid-starter`: copied from `examples/starter.tdproj` into a temporary directory by E2E tests.
- `legacy-project.json`: project manifest without `schemaVersion`, used for migration tests.
- `invalid-visuals.json`: unsafe asset paths for schema/security tests.
- `bad-map-route`: map route references are covered by engine validation tests.

Tests should copy fixtures to a temporary directory before mutation. Source fixtures are not runtime project state.
