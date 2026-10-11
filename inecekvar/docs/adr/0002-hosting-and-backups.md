# ADR-0002: Hosting and Postgres backups

- Status: Proposed
- Deciders: Project owner

## Context

The product specification calls for Caddy, PostgreSQL 16 with PostGIS, Redis 7.4, MinIO-compatible object storage and Mailpit in local Docker Compose. Production hosting, the `inecekvar.app` domain, public TLS and HSTS preload depend on external infrastructure.

## Decision

Use local Docker Compose as the only exercised environment in this phase: Caddy, PostGIS 16, Redis 7.4, MinIO and Mailpit. Keep production hosting, DNS, TLS and HSTS preload outside the local proof boundary. Report these as `not exercised: no domain, no host`.

Plan a PostgreSQL `pg_dump` and restore drill for Phase 6. The drill must restore into PostgreSQL with PostGIS and check published line geometry and stop references before it can be reported as run.

## Consequences

Local service wiring can be demonstrated without claiming production operation. No live domain, certificate, HSTS preload, object storage account or hosted backup is evidenced by this decision. Backup creation and restoration remain planned until their Phase 6 commands produce output.
