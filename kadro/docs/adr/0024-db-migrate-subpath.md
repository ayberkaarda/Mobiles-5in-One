# ADR-0024: Migrations exposed only through the `@kadro/db/migrate` subpath

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 item 15; threat model TB3, TB4

## Context

`packages/db` contains both the runtime client used by the API and worker and the migration runner
used by the CLI and integration tests. Exporting the runner from the package root puts migration
code in every runtime bundle and makes it easy to call DDL from request or job code, against the
least-privilege model (no DDL at runtime for the `kadro_app` and `kadro_worker` roles).

## Decision

- The migration runner is exported only from the subpath `@kadro/db/migrate`; the package root
  (`@kadro/db`) exports the client, schema and types, never the runner.
- Only the `db:migrate` CLI, the deploy step and test setup import `@kadro/db/migrate`. An ESLint
  `no-restricted-imports` rule forbids the subpath in `apps/web/app/**` and `apps/worker/src/**`.
- Migrations run with a separate migration database role; the runtime roles have no DDL grants.

## Consequences

- Runtime code cannot run migrations by accident, and its bundles stay free of migrator code.
- Integration tests import the subpath explicitly, which keeps the dependency visible in review.
