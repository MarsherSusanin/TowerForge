# 0001. Record Architecture Decisions

Date: 2026-06-29

## Status

Accepted

## Context

TowerForge is becoming an open-source constructor with separate engine, CLI, Studio, project format, and generated player concerns. Changes to package boundaries, project schema, build outputs, or validation behavior can affect every game project built with the kit.

## Decision

Use `docs/adr/` for Architecture Decision Records. Add a new ADR for decisions that are expensive to reverse or affect multiple modules, including project schema changes, renderer strategy, package boundaries, deployment model, or security policy.

## Consequences

- Humans and agents can find decision history without reading chat logs.
- `AGENTS.md` can stay short and link to durable decisions.
- Changes to `.tdproj` compatibility and engine boundaries have an explicit review point.
