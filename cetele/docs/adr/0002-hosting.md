# ADR-0002: Hosting

- Status: Accepted (nothing is provisioned; provider behaviour and prices not verified, see "Not verified")
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Çetele runs these processes in production:

1. `server`: Spring Boot (Kotlin) with the `/v1` API, the Thymeleaf web pages and the `/admin/**`
   console, one image built by Jib.
2. PostgreSQL 16 with the ledger, the change log and the account tables.
3. S3-compatible object storage for ledger photos and for backups.
4. A reverse proxy that terminates TLS (spec section 4, section 6 item 10).

Scheduled work (reminders, SMS balance monitor, post-upload photo processing, deletion jobs) runs
inside the server process, so there is no separate worker process to host. Backups (spec section 6
item 20) need a job on the host that can reach PostgreSQL.

## Options considered

- Managed platform (container service with managed PostgreSQL): less operations work, but backup
  control, cost caps and data location depend on the vendor, and the cost is harder to bound.
- Docker Compose on one VPS behind Caddy (chosen): one fixed monthly bill, the same images locally
  and in production, automatic HTTPS and HSTS from Caddy, explicit data location. Patching,
  upgrades, backups and monitoring are ours, and availability is single-host.
- Cloudflare in front of the origin (proxied DNS): adds a second proxy hop and a second source for
  the client address. Not chosen for the first deployment, see Decision.

## Decision

Production runs on one Linux VPS (Hetzner-class) with Docker Compose:

- `caddy` terminates TLS with automatic certificates, sets HSTS and forwards to `server`. The
  server trusts the forwarded-address header of Caddy only (`server.forward-headers-strategy=native`,
  spec section 6 items 5 and 10).
- `server` is the Jib image `cetele-server`. `postgres` runs on a persistent volume and is not
  exposed publicly.
- PostgreSQL 16 is self-hosted. Backups are WAL archiving through pgBackRest plus a daily
  `pg_dump -Fc`, encrypted with `age` and uploaded to a separate write-only bucket with 30 days
  retention (spec section 6 item 20). Because the database is self-hosted, the "managed PITR"
  alternative of the spec does not apply.
- Object storage is Cloudflare R2 in production and MinIO in local development, both reached with
  the AWS SDK v2 through the `CETELE_S3_*` settings. Media is private and served by short-lived
  presigned URLs; the backup bucket is separate.
- DNS is on Cloudflare in DNS-only mode, so Caddy is the only proxy and the only source of the
  client address. Switching to proxied DNS needs a new decision about the trusted header.
- Alert mail (spec section 6 item 22) goes through a transactional mail provider; the local stack
  uses Mailpit.
- Local development uses `docker-compose.yml` (project `cetele`, host ports in the 60xxx block bound
  to `127.0.0.1`) and is independent of this decision. The Android emulator reaches the server at
  `http://10.0.2.2:60080`.

Sizing, region, the production Caddyfile and the restore drill are delivered in Phase 6.

## Not verified

- Current VPS and R2 prices, free tiers and egress terms.
- Whether an R2 token can be limited to write-only on the backup bucket, which the backup design in
  spec section 6 item 20 assumes.
- Data location: a Turkey-hosted or EU-hosted VPS changes the cross-border position under KVKK.
- Evidence limit: nothing in this record was exercised against a real host
  (`not exercised: no hosting account`). See ADR-0004.

## Consequences

- The deployment is reproducible from the repository, because production and local use the same
  image and the same configuration keys (see [env.md](../ops/env.md)).
- Availability is single-host and the recovery point is bounded by WAL archiving; both are accepted
  for a portfolio deployment.
- Operations runbooks (deploy, backup and restore, cost alerts) live in `docs/ops/` and are added in
  Phase 6.

## Open points for the owner

- Cost: monthly VPS, storage and mail budget.
- Region: choose the data location before any real deployment.
- A real launch needs a domain, DNS and a certificate; none exist now.
