# ADR-0002: Hosting — Docker on a VPS behind Caddy

- Status: Accepted (cost and data-location confirmation requested from the owner, see "Open points")
- Date: 2026-10-01
- Deciders: Ayberk (owner)

## Context

Kadro runs three processes in production:

1. `apps/web` — Next.js marketing/SEO pages and the `/api/v1` REST API.
2. `apps/worker` — a long-running pg-boss process (reminders, push fan-out, e-mail, deletion,
   webhook processing, backup verification).
3. PostgreSQL 16 — application data, pg-boss queues and rate-limit buckets (no Redis).

The two candidates were Vercel (web + API) and Docker on a VPS behind Caddy.

## Options considered

### Vercel for web + API

- Pros: zero-ops deploys, preview URL per branch, global CDN, first-class Next.js support.
- Cons: the worker cannot run there (pg-boss needs a persistent process holding a connection pool),
  so a second platform is required anyway; serverless functions open many short-lived Postgres
  connections (a pooler becomes mandatory); usage-based billing for functions, bandwidth and image
  optimisation is harder to cap, which conflicts with checklist item 22 (cost alerts); three
  vendors (Vercel, worker host, managed Postgres) to secure and monitor.

### Docker on a VPS behind Caddy (chosen)

- Pros: web, worker and Postgres share one private network and one bill with a fixed monthly cost;
  the same images run in local `docker compose` and production; Caddy provides automatic HTTPS
  (Let's Encrypt), HTTP→HTTPS redirect and HSTS for the `.app` domain; long-lived connection pools
  suit pg-boss and Drizzle; data location is chosen explicitly.
- Cons: operations are ours (OS patching, Postgres upgrades, monitoring, backups); no built-in
  preview environment per branch; single-host availability.

## Decision

Production runs on a single Linux VPS with Docker Compose:

- `caddy` (reverse proxy, TLS termination, security-header passthrough) → `web:3000`.
- `web` built from `apps/web/Dockerfile` (Next.js standalone output, non-root user, health check on
  `/api/v1/health`).
- `worker` built from `apps/worker/Dockerfile` (non-root user, pruned production dependencies).
- `postgres` 16 on a persistent volume, not exposed publicly.

Sizing at launch: 4 vCPU, 8 GB RAM, 160 GB SSD, in an EU or Türkiye region (see "Open points").
`preview` uses a second, smaller VPS with the same compose stack; branch previews are not provided.

Backups follow checklist item 20: daily `pg_dump -Fc`, encrypted with `age`, uploaded to the R2
bucket `kadro-backups` with a 30-day lifecycle, plus a weekly restore drill in CI. Because Postgres
is self-hosted, point-in-time recovery is not available; the recovery point objective is 24 hours.

Local development uses `docker-compose.yml` at the repository root (Postgres 16, web, worker)
regardless of this decision.

## Consequences

- `docs/ops/` owns the runbooks: provisioning, deploy, backup/restore and cost alerts.
  Note (2026-10-03): the backup/restore and cost alert documents were written under
  `docs/release/` (`backup-restore-drill.md`, `cost-alerts.md`); `docs/ops/README.md` links them.
- The production compose file and `Caddyfile` are delivered in the release-readiness phase together
  with the deploy runbook; Phase 0 delivers the images and the local stack.
- Trusted client IP comes from Caddy's `X-Forwarded-For` handling only (rate limiting, item 5); the
  web container is never published directly on the host.
- Moving to managed Postgres later (to gain PITR) only changes `DATABASE_URL` and the backup
  runbook.

## Open points for the owner

- **Cost:** fixed VPS cost for production plus a smaller preview VPS; confirm the budget ceiling used
  in `docs/release/cost-alerts.md` (path corrected 2026-10-03; it was cited as `docs/ops/`).
- **Data location (KVKK):** a Türkiye-hosted VPS keeps the primary database in-country; an EU region
  makes the database a cross-border transfer under KVKK Article 9. R2, Resend, Sentry and RevenueCat
  are processors outside Türkiye in either case. Confirm the region before production provisioning.
