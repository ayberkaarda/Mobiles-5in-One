# Deploy

How the server runs and what a production-like deployment needs. Status first, so nothing is
over-read: **this has never been run on a public host.** No domain, server, certificate authority
account or payment, push and attestation provider exists for this portfolio build (ADR-0006).
Every step that needs one is marked `not exercised: <reason>`. What is verified is the local
compose stack (`docs/ops/env.md`, "Parallel stacks") and the `/up` health check. The hosting
choice itself (Docker Compose on one VPS behind Caddy) is ADR-0002.

## Roles and images

All three application roles run the same image, built from `docker/php/Dockerfile` (PHP-FPM 8.3
and nginx in one container) through the `server-image` anchor in `docker-compose.yml`:

| Role (compose service) | Command | Purpose | Health |
| --- | --- | --- | --- |
| `server` | `start-server` (PHP-FPM in the background, nginx in the foreground, port 80) | HTTP: API, public web, admin panel, payment pages | `curl -fsS http://127.0.0.1/up` (Laravel health route, `server/bootstrap/app.php`) |
| `horizon` | `php artisan horizon` | Queue workers (Redis) | `php artisan horizon:status` |
| `scheduler` | `php artisan schedule:work` | Scheduled jobs in `server/routes/console.php` (hook expiry, retention, reconciliation, payouts, fraud scan, impact snapshots) | none; run exactly one instance |

Supporting services in the same file: `postgres` (PostGIS 16), `redis`, `minio` and `minio-init`
(S3-compatible storage; buckets `askida-private` and `askida-public`), `mailpit` (local mail
catcher). In production these are replaced by managed equivalents: PostgreSQL with PostGIS, Redis,
an S3-compatible store (Cloudflare R2 is the documented target) and a real mail provider.

Honest limit: the image is a **development image**. The source tree is bind-mounted
(`./server:/var/www/html`), and `start-server.sh` runs `composer install` and creates a local
`.env` on the first start. A production image that bakes the application in (multi-stage build,
`composer install --no-dev --optimize-autoloader`, no bind mount, no `.env` creation, non-root
user) does not exist; it is a suggestion in the release report, not built in Phase 6. Until it
exists a deployment means running this image on one host with the source checked out and the
environment supplied by the host.

## Edge: Caddy

`docker/caddy/Caddyfile.example` is a one-host template:

- automatic HTTPS and the HTTP to HTTPS redirect (Caddy does both for a named site address);
- `reverse_proxy` to `server:80` (the Caddy container joins the compose network);
- `/up` forwarded unchanged for the uptime check, plus an active health probe of the upstream;
- a JSON edge log that removes the `near` query parameter, which carries the approximate location
  of nearby-shop requests;
- HSTS is not added by Caddy: the application sends it (`server/config/secure-headers.php`: two
  years, subdomains, preload) on requests it sees as HTTPS and Caddy passes it through, so the
  header is not duplicated.

Two settings in `server/.env` make this work behind the proxy:

- `TRUSTED_PROXIES`: the proxy's address or network. Empty means no proxy is trusted: the client
  address becomes the proxy's (rate limits then apply to everyone at once) and the forwarded
  protocol is ignored (the HTTPS logic and secure cookies misbehave).
- `SECURITY_HSTS_FORCE=false` while the proxy is trusted; `true` only for a terminator that cannot
  be listed in `TRUSTED_PROXIES`.

The template has not met a real certificate authority: not exercised: no domain. The default
nginx access log inside the application container still records the request line (see
`docs/release/privacy-labels.md`, IP address row): the Caddyfile filter does not cover it.

## Environment checklist

Source of truth for every key: `docs/ops/env.md` and `server/.env.example`.

1. `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://<domain>`, `WEB_ORIGIN=https://<domain>`.
2. `APP_KEY` created once and kept in the secret store. Losing it makes the encrypted columns
   (`shops.tax_number_enc`, `shops.iban_enc`) and the admin TOTP secrets unreadable; rotating it
   follows the plan in `docs/security/history-purge-runbook.md`.
3. Real drivers. The application refuses to boot outside local and testing with these left on
   their local values: `PAYMENT_PROVIDER=iyzico` (not `fake`), `ATTESTATION_DRIVER=real`, a real
   `PUSH_DRIVER` (`log` is refused), `HOOK_CODE_PEPPER` of at least 32 characters (changing it
   later invalidates every open code). The real providers are **not exercised: no iyzico, Google
   Cloud or Apple accounts**.
4. Cookies and proxies: `SESSION_SECURE_COOKIE=true`, `TRUSTED_PROXIES` as above,
   `SECURITY_CORS_ALLOWED_ORIGINS` limited to the web origin, the `SECURITY_CSP_*_PAY` lists set
   from the payment provider's documentation (the sample values in `.env.example` are unverified).
5. Data stores: `DB_*` for PostgreSQL with the PostGIS extension (the first migration runs
   `CREATE EXTENSION IF NOT EXISTS postgis`, which needs a role allowed to do so, or the extension
   created beforehand), `REDIS_HOST`, `QUEUE_CONNECTION=redis`, `AWS_*` for the object store with
   `AWS_BUCKET_PRIVATE` never public and `AWS_BUCKET_PUBLIC` for shop photos only,
   `AWS_PUBLIC_ENDPOINT` only when devices reach the store under another address.
6. Mail: `MAIL_*` for the provider and a verified sender; delivery is **not exercised: no
   provider**.
7. Logging: `LOG_STACK=daily` (30 files kept) instead of the local `single`.
8. Secrets come from the host's secret store, never from the repository, an image layer or a log.

## First start and updates

```sh
docker compose build server
docker compose up -d server horizon scheduler
docker compose exec -T server php artisan migrate --force
docker compose exec -T server php artisan config:cache
docker compose exec -T server php artisan route:cache
docker compose exec -T server php artisan view:cache
```

Check: `curl -fsS https://<domain>/up` answers 200, `horizon:status` reports running, and the
scheduler log shows the jobs running. The migration and cache commands were exercised on the local
stack only.

## Zero-downtime note

One `server` container cannot swap releases without a short gap. Two options: (a) accept a
restart of a few seconds, announced with maintenance mode (below); (b) run two `server`
containers behind Caddy (several upstreams in `reverse_proxy`) and update them one at a time, using
`/up` as the gate. Only one `scheduler` and one `horizon` may run per environment. Database
changes stay backward compatible for one release (add columns first, drop them in a later release)
so old and new code can run side by side. Option (b) is documented, not run: not exercised: no
host.

## Maintenance mode

```sh
docker compose exec -T server php artisan down --secret="<one-time-path>" --retry=60
# open https://<domain>/<one-time-path> once to get the bypass cookie and check the release
docker compose exec -T server php artisan up
```

The secret path is new for each use and never stored in the repository. While the application is
down, payment callbacks and provider webhooks receive a 503 and the provider retries; check the
provider's retry window before a long maintenance.

## Rollback

Keep the previous image tag and start it again. If the release included a migration that is not
backward compatible, restore from backup per `docs/ops/backup-restore.md`. Do not run
`migrate:rollback` against production data without a backup taken immediately before.

## Not exercised (summary)

| Item | Reason |
| --- | --- |
| Public deployment, TLS issuance, HSTS preload | no domain, no host |
| Production image build | not written (suggestion) |
| Real payment, attestation, push and mail providers | no accounts |
| Two-container rolling update | no host |
| Backups and the restore drill against production | no bucket, no credentials |
