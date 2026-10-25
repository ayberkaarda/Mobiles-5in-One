# ADR-0002: Hosting and scaling

- Status: Accepted
- Date: 2026-10-25

## Context

Patika serves a spatially indexed PostgreSQL database, an API, SSR web pages, scheduled jobs, media uploads, and push fan-out. The MVP needs an operationally simple deployment with a clear path to horizontal scaling and recoverable data.

## Decision

- Package the API, Razor Pages web app, and Quartz.NET worker as separate containers.
- Run PostgreSQL 17 with PostGIS 3.5 as the primary stateful service. Use managed PostgreSQL with point-in-time recovery in production; use PostgreSQL plus PostGIS in the local Compose environment.
- Put a reverse proxy and Cloudflare in front of the web and API services. Store production media in Cloudflare R2 and local media in MinIO.
- Begin with one API, one web, and one worker instance. Scale stateless API and web instances horizontally when measured load requires it.
- Use a shared Redis-backed rate-limit store when running multiple API instances so limits do not reset per instance. Keep job execution coordinated so scheduled work is not duplicated across worker instances.
- Back up the database daily, retain protected copies separately from the primary database, enable object versioning for media, and verify recovery through restore drills.
- Define operational alerts for database capacity, object storage and egress, email volume, and push volume before production launch.

## Consequences

The initial deployment has a small service footprint and avoids premature service decomposition. PostgreSQL and object storage remain explicit recovery responsibilities. Horizontal API scaling requires shared rate-limit state, while worker scaling requires coordination for scheduled jobs. Production provider details, budget thresholds, and recovery objectives are documented in operational runbooks before launch.
