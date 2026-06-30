# Contributing

Mycelium Kit is a local-first constructor for 2D hex tower-defense games.

## Development

Install dependencies with `npm install`, then use the root scripts:

- `npm run studio`
- `npm run validate`
- `npm run sim tutorial_01 60`
- `npm run maps:compile -- --project examples/starter.tdproj`
- `npm run build`
- `npm test`
- `npm run test:e2e`

## Boundaries

- Keep `packages/engine` pure TypeScript with no DOM, Node, filesystem, Studio, or renderer imports.
- Keep `.tdproj` loading, migration, source map compilation, asset copying, and build output in Node-side packages.
- Use engine validation and simulation APIs instead of duplicating gameplay rules in Studio.
- Update architecture docs or ADRs when package boundaries, project format, validation, or build output changes.

## Pull Requests

Before opening a PR, run the relevant checks listed in `.github/pull_request_template.md`. For project format changes, include a migration and fixture or regression test.
