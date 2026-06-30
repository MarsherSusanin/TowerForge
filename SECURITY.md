# Security

Mycelium Kit treats imported `.tdproj` projects as untrusted local data.

## Current Policy

- Studio binds to `127.0.0.1` by default.
- Build output must stay inside the project directory.
- Asset paths must be project-relative; absolute paths, external URLs, and `..` traversal are rejected.
- The engine package must not depend on Node, DOM, filesystem, browser storage, Studio, or renderer code.

## Reporting

For now, report security issues privately to the repository maintainer before public disclosure. Include reproduction steps, affected command or API, and the smallest project fixture that demonstrates the issue.
