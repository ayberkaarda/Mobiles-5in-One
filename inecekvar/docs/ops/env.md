# Local environment variables

These values are for local development only. Password-like values are the compose defaults (`inecekvar_local_dev`); never reuse them outside the local stack. Angular environment configuration may contain public values only.

The API reads its configuration from `INECEKVAR_*` environment values through `pydantic-settings` (`api/app/core/settings.py`, Phase 1). The keys below are split by who reads them.

## Consumed in Phase 0

Docker Compose reads these from `.env` next to `docker-compose.yml` (copy `.env.example`) or from the shell. Every port binds to 127.0.0.1.

| Key | Default | Purpose |
| --- | --- | --- |
| `INECEKVAR_PG_PORT` | `57432` | Host port of PostgreSQL/PostGIS. |
| `INECEKVAR_REDIS_PORT` | `57379` | Host port of Redis. |
| `INECEKVAR_WEB_PORT` | `57080` | Host port of the Caddy web site. |
| `INECEKVAR_APP_PORT` | `57081` | Host port of the Caddy app (PWA) site. |
| `INECEKVAR_MINIO_PORT` | `57900` | Host port of the MinIO S3 API. |
| `INECEKVAR_MINIO_CONSOLE_PORT` | `57901` | Host port of the MinIO console. |
| `INECEKVAR_MAIL_SMTP_PORT` | `57025` | Host port of the Mailpit SMTP sink. |
| `INECEKVAR_MAIL_UI_PORT` | `57825` | Host port of the Mailpit web UI. |
| `INECEKVAR_DB_PASSWORD` | `inecekvar_local_dev` | Local PostgreSQL password. |
| `INECEKVAR_MINIO_PASSWORD` | `inecekvar_local_dev` | Local MinIO root password. |

Read from the process environment by other Phase 0 code (not from `.env`):

| Key | Read by | Purpose |
| --- | --- | --- |
| `HOST`, `PORT` | `apps/web/src/server.ts` | SSR bind address and port; default `127.0.0.1` and `4000`. A deployment sets `HOST`. |
| `NG_ALLOWED_HOSTS` | Angular SSR | Extra allowed `Host` values for local production-build runs (for example `127.0.0.1`). |
| `INECEKVAR_TEST_DATABASE_URL` | `api/tests/conftest.py` | Use an existing PostGIS database instead of Testcontainers (the CI service container). |
| `INECEKVAR_TEST_REDIS_URL` | `api/tests/conftest.py` | Use an existing Redis service instead of Testcontainers. |
| `INECEKVAR_TEST_S3_URL` | `api/tests/conftest.py` | Use an existing S3-compatible service instead of Testcontainers. |
| `INECEKVAR_TEST_S3_ACCESS_KEY` | `api/tests/conftest.py` | Access key for the configured S3 service (default `inecekvar-test`). |
| `INECEKVAR_TEST_S3_SECRET_KEY` | `api/tests/conftest.py` | Secret key for the configured S3 service (default `inecekvar-test-only`). |
| `INECEKVAR_REQUIRE_DOCKER` | `api/tests/conftest.py` | `1` turns a skipped container-backed test into a failure (set in CI). |

The API bind address and port are uvicorn flags, not environment keys: `uv run uvicorn app.main:app --host 127.0.0.1 --port 57800` (Caddy proxies `/api/*` to port 57800).

## Read by the API (Phase 1)

`api/app/core/settings.py` reads these with the prefix `INECEKVAR_` (case-insensitive). `INECEKVAR_ENV` is required. With `local`, missing URLs fall back to the compose defaults and missing secrets and the ES256 key pair are created per process (`app/main.py::with_local_defaults`); with `test` or `production` they are required and startup fails without them.

| Key | Local value | Purpose |
| --- | --- | --- |
| `INECEKVAR_ENV` | `local` | `local`, `test` or `production`; selects defaults and the local CORS origins. |
| `INECEKVAR_DATABASE_URL` | `postgresql+asyncpg://inecekvar:inecekvar_local_dev@localhost:57432/inecekvar` | PostgreSQL connection (also read by Alembic and the seed). |
| `INECEKVAR_REDIS_URL` | `redis://localhost:57379/0` | Redis for rate limits and planner cache. |
| `INECEKVAR_JWT_PRIVATE_KEY_PEM` or `INECEKVAR_JWT_PRIVATE_KEY_PATH` | none (per process locally) | ES256 signing key, PEM text or a file outside the repository. |
| `INECEKVAR_JWT_PUBLIC_KEY_PEM` or `INECEKVAR_JWT_PUBLIC_KEY_PATH` | none (per process locally) | ES256 verification key. |
| `INECEKVAR_CSRF_SECRET` | none (per process locally) | HMAC key binding CSRF tokens to sessions; at least 32 characters. |
| `INECEKVAR_LOG_HASH_KEY` | none (per process locally) | HMAC key for email, IP and rate-limit digests; at least 32 characters. |
| `INECEKVAR_SMTP_HOST`, `INECEKVAR_SMTP_PORT` | `localhost`, `57025` | Mail server (Mailpit locally). |
| `INECEKVAR_SMTP_USE_TLS` | `false` | STARTTLS; must be `true` in production. |
| `INECEKVAR_SMTP_USERNAME`, `INECEKVAR_SMTP_PASSWORD` | unset | SMTP login when the server needs one. |
| `INECEKVAR_MAIL_FROM` | `İnecek Var <no-reply@inecekvar.app>` | Sender address. |
| `INECEKVAR_MAGIC_LINK_BASE_URL` | `https://app.inecekvar.app/giris/baglanti` | Page that receives the magic-link token in the URL fragment. |
| `INECEKVAR_TRUSTED_PROXY_CIDRS` | `["127.0.0.1/32","::1/128"]` | Peers whose `X-Real-IP` and forwarded-proto headers are trusted (Caddy); in production the proxy address only. An IPv4-mapped peer (`::ffff:127.0.0.1`, what a dual-stack `--host ::` socket reports for an IPv4 connection) is unwrapped to its IPv4 address before this test, so the IPv4 CIDR covers it; prefer `--host 127.0.0.1` (or the proxy-facing address) anyway, and list the proxy's IPv6 address separately if it connects over IPv6. |
| `INECEKVAR_REQUIRE_HTTPS` | unset: enforced in `production`, off in `local` and `test` | Refuse plain http with 403 `transport.https_required` unless the request came over TLS or a trusted proxy marks it https; `false` is refused in production (ADR-0055). |
| `INECEKVAR_FORWARDED_PROTO_HEADER` | `X-Forwarded-Proto` | Header a trusted proxy uses to report the client's scheme (ADR-0055). |
| `INECEKVAR_CLIENT_IP_HEADER` | `X-Real-IP` | The only header read for the client address. |
| `INECEKVAR_HIBP_ENABLED` | `true` | Breached-password range check at registration. |
| `INECEKVAR_LOG_LEVEL` | `INFO` | Log level of the JSON logs. |
| `INECEKVAR_TOTP_ENCRYPTION_KEY` | none (per process locally) | AES-256-GCM key for stored TOTP secrets: URL-safe base64 of exactly 32 random bytes (for example `python -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"`). Required in production; without it in test the TOTP routes answer 503 `auth.totp_unavailable`. Locally a per-process key is created, so enrolments do not survive an API restart. To rotate, set the new key, move the old key to `INECEKVAR_TOTP_PREVIOUS_ENCRYPTION_KEY`, run `uv run python -m app.auth.totp_rotation`, then remove the previous key; it is on the rotation list of the history-purge runbook (section 6.2). ADR-0037. |
| `INECEKVAR_TOTP_PREVIOUS_ENCRYPTION_KEY` | unset | Previous TOTP encryption key during rotation; the same URL-safe base64 format as the current key. Remove after re-encryption. |

Object-storage, planner, offline-pack and retention settings are also read by the API:

| Key | Default | Purpose |
| --- | --- | --- |
| `INECEKVAR_S3_ENDPOINT_URL` | unset; local default `http://localhost:57900` | S3-compatible object-storage endpoint; local startup fills the MinIO endpoint, and without an endpoint outside local the media and export routes answer 503. |
| `INECEKVAR_S3_REGION` | `auto`; local default `us-east-1` | Signing region for S3 requests. |
| `INECEKVAR_S3_ACCESS_KEY_ID` | unset; local default `inecekvar` | S3 access key; local startup fills the compose MinIO credential. |
| `INECEKVAR_S3_SECRET_ACCESS_KEY` | unset; local default `inecekvar_local_dev` | S3 secret key; local startup fills the compose MinIO credential. |
| `INECEKVAR_MEDIA_BUCKET` | `inecekvar-media` | Bucket used for uploaded photos. |
| `INECEKVAR_EXPORTS_BUCKET` | `inecekvar-exports` | Bucket used for exports. |
| `INECEKVAR_EXPORT_MAX_FEATURES` | `50000` | Maximum line and stop features per export. |
| `INECEKVAR_EXPORT_MAX_BYTES` | `52428800` (50 MiB) | Maximum encoded export size before upload. |
| `INECEKVAR_PRESIGN_TTL_SECONDS` | `300` | Lifetime in seconds of signed media URLs. |
| `INECEKVAR_MEDIA_MAX_BYTES` | `4194304` (4 MiB) | Maximum accepted photo size. |
| `INECEKVAR_PLANNER_TIMEOUT_SECONDS` | `3.0` | Maximum time in seconds allowed for a planner request. |
| `INECEKVAR_PLANNER_CACHE_TTL_SECONDS` | `600` | Planner result cache lifetime in seconds; the cache is held in Redis. |
| `INECEKVAR_STOP_PAIRS_CACHE_TTL_SECONDS` | `3600` | Stop-pair cache lifetime in seconds; 60 to 86400, keyed by city and pack version. |
| `INECEKVAR_STOP_PAIRS_TIMEOUT_MS` | `2000` | Stop-pair SQL timeout in milliseconds; 100 to 10000. |
| `INECEKVAR_PMTILES_BASE_URL` | unset | HTTPS CDN base URL for offline city tile packs; when unset the tile route answers 404. |
| `INECEKVAR_TRACE_RETENTION_DAYS` | `30` | Retention period in days for raw traces. |
| `INECEKVAR_DELETION_GRACE_DAYS` | `7` | Grace period in days before an account deletion request can be completed. |

The `media.presign` rate limit is 20 requests per user per 24 hours; `pack.download` is 10 per anonymous hash or signed-in user per 24 hours; `auth.step_up` (TOTP confirmation and step-up) is 5 per 15 minutes per user and, separately, per client IP; `mail.security_after_bounce` allows 3 sign-in or account-exists mails per address per 24 hours to an address that hard-bounced more than 30 days ago (ADR-0050 item 13). These limits are fixed rules, not environment keys. Per-IP windows of an IPv6 client: the auth rules and `plan` count per address plus a ceiling per /64 at 20 times the limit; `public.stop_pairs` and the anonymous pack identity count per /64; IPv4-mapped addresses count as the IPv4 address (ADR-0052 decisions 4 and 9).

Token lifetimes, Argon2 parameters, body limits and other rate-limit rules have defaults fixed by the specification and are not meant to be changed per environment.

The API does not read `.env` files: export the values in the shell before `uv run uvicorn app.main:app --reload` (at least `INECEKVAR_ENV=local`); without `INECEKVAR_ENV` startup stops with a validation error.

Do not place signing keys, provider credentials, production endpoints or other secrets in the example file. Production hosting, the public domain, TLS and HSTS preload are not exercised: no domain, no host.

## Read by the API and the worker (Phase 5)

Webhooks, billing and nightly jobs (ADR-0050). Every secret below is unset by default and has no local default: without it the matching feature stays off and fails closed.

| Key | Default | Purpose |
| --- | --- | --- |
| `INECEKVAR_REVENUECAT_WEBHOOK_SECRET` | unset | Value RevenueCat sends in the `Authorization` header of `POST /v1/webhooks/revenuecat` (set the same value in the RevenueCat dashboard); at least 32 characters, compared in constant time. Unset: the route answers 503 and stores nothing. On the rotation list of the history-purge runbook. |
| `INECEKVAR_REVENUECAT_API_KEY` | unset | Secret REST API key (v1) for the nightly reconciliation, transfers and subscriber deletion at account erasure; at least 32 characters. Unset: reconciliation is skipped and the hard delete defers accounts that have subscription rows. Never the public SDK key of the app. |
| `INECEKVAR_REVENUECAT_PLUS_ENTITLEMENT` | `plus` | RevenueCat entitlement id that means Plus (the app uses the same id, `apps/mobile/src/app/plus/purchases.ts`). |
| `INECEKVAR_REVENUECAT_PLUS_PRODUCT_IDS` | `[]` | JSON list of store product ids that also count as Plus when an event or snapshot does not name the entitlement (for example expired products). |
| `INECEKVAR_REVENUECAT_ALLOW_SANDBOX` | `false` | Apply sandbox purchases. Keep `false` in production; a staging deployment may enable it. |
| `INECEKVAR_REVENUECAT_TIMEOUT_SECONDS` | `5.0` | Timeout of one RevenueCat REST call (0 to 30). |
| `INECEKVAR_RESEND_WEBHOOK_SECRET` | unset | Svix signing secret of the Resend webhook endpoint (`whsec_` followed by base64 of at least 24 bytes). Unset: `POST /v1/webhooks/resend` answers 503. On the rotation list of the history-purge runbook. |
| `INECEKVAR_MAX_WEBHOOK_BODY_BYTES` | `65536` | Body limit of the webhook routes (1 KiB to 1 MiB); larger bodies answer 413 before routing. |
| `INECEKVAR_WEBHOOK_EVENT_RETENTION_DAYS` | `30` | Processed `webhook_events` rows (event id, type, outcome; no payload) are deleted after this many days (7 to 365). Idempotency holds for this window; the providers retry for hours, not weeks. |
| `INECEKVAR_BOUNCE_SUPPRESSION_RETENTION_DAYS` | `365` | Bounce suppressions are lifted after this many days (30 to 3650). Complaint and manual suppressions are never purged by the job. |
| `INECEKVAR_PACK_DOWNLOAD_RETENTION_DAYS` | `90` | Per-identity `pack_downloads` rows older than this are counted into `pack_download_stats` and deleted (30 to 730); each account keeps its earliest row (its free first city), anonymous network rows are deleted completely. |
| `INECEKVAR_JOBS_DRY_RUN` | `false` | The nightly jobs count what they would change and write nothing. A job enqueued with `dry_run=True` or `dry_run=False` overrides it for that run. |

Worker schedule (Europe/Istanbul): pending webhook sweep every five minutes; RevenueCat reconciliation 04:10; expired entitlement sweep 04:40; retention purge 04:50; pack download roll-up 05:00 (`app/workers/main.py`, ADR-0050). The suppression list stores HMAC-SHA256 digests under `INECEKVAR_LOG_HASH_KEY`; rotating that key empties the effective list.

## Backups and restore (Phase 6)

Runbook: [backup-restore.md](backup-restore.md); ADR-0053. Two readers: the worker job `backup.verify` (a separate settings class in `app/workers/backup_verify.py`, prefix `INECEKVAR_BACKUP_VERIFY_`; the API settings ignore these keys) and the shell scripts of `ops/backup/` (process environment of the backup host or the operator, `/etc/inecekvar/backup.env` mode 0600). No key below has an example value that works outside the local stack; the secrets have none at all.

Worker (`backup.verify`, daily 07:30 Europe/Istanbul):

| Key | Default | Purpose |
| --- | --- | --- |
| `INECEKVAR_BACKUP_VERIFY_ENDPOINT_URL` | unset; with `INECEKVAR_ENV=local` the API's `INECEKVAR_S3_ENDPOINT_URL` | S3 endpoint of the backup bucket. Unset in production: the job logs `backup.verify.alert` with status `not_configured`; in test it logs a skip. |
| `INECEKVAR_BACKUP_VERIFY_REGION` | `auto` | Signing region. |
| `INECEKVAR_BACKUP_VERIFY_ACCESS_KEY_ID`, `INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY` | unset; locally the API's S3 keys | List-only identity of the backup prefix (`minio/backup-verifier-policy.json`); it can read no dump. On the rotation list. |
| `INECEKVAR_BACKUP_VERIFY_BUCKET` | `inecekvar-backups` | Backup bucket. |
| `INECEKVAR_BACKUP_VERIFY_PREFIX` | `inecekvar/` | Dump prefix; empty or ending with `/`. |
| `INECEKVAR_BACKUP_VERIFY_MAX_AGE_HOURS` | `26` | Newest dump older than this alerts as `stale` (a daily dump plus slack; above 0, at most 336). |
| `INECEKVAR_BACKUP_VERIFY_MIN_SIZE_BYTES` | `4096` | Newest dump smaller than this alerts as `too_small`; 0 bytes as `empty`. |
| `INECEKVAR_BACKUP_VERIFY_MAX_STAMP_SKEW_HOURS` | `6` | A dump whose key stamp and `LastModified` differ by more than this alerts as `stamp_skew` (an overwrite of an old key); above 0, at most 48. |
| `INECEKVAR_BACKUP_VERIFY_FUTURE_TOLERANCE_MINUTES` | `10` | A key stamp more than this far in the future alerts as `future_stamp`; 0 to 120. |

`INECEKVAR_JOBS_DRY_RUN` also applies: a dry run logs `backup.verify.alert_suppressed` and does not write the Redis result `inecekvar:ops:backup-verify:last`. The worker also keeps the last listing (ETag and size per key) in the Redis hash `inecekvar:ops:backup-verify:seen` (40 days) and alerts `changed` once when a seen key changes; a dry run compares but does not update it. The command-line run (`python -m app.workers.backup_verify`, used by the drill) has no Redis and skips the change check.

Scripts (`ops/backup/*.sh --help` prints the same list):

| Key | Read by | Purpose |
| --- | --- | --- |
| `INECEKVAR_BACKUP_AGE_RECIPIENT` | `backup.sh` | age public recipient (`age1...`); a private identity is refused. |
| `INECEKVAR_BACKUP_S3_ENDPOINT` | all bucket scripts | S3 endpoint; https, plain http only for loopback or a single-label name on `INECEKVAR_BACKUP_DOCKER_NETWORK`. |
| `INECEKVAR_BACKUP_S3_BUCKET`, `INECEKVAR_BACKUP_S3_PREFIX` | all bucket scripts | default `inecekvar-backups` and `inecekvar/`. |
| `INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY`, `INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY` | `backup.sh`, `bucket-setup.sh` | Write-only identity (PutObject under the prefix). Secret; backup host only. |
| `INECEKVAR_RESTORE_S3_READ_ACCESS_KEY`, `INECEKVAR_RESTORE_S3_READ_SECRET_KEY` | `restore.sh`, `restore-drill.sh`, `bucket-setup.sh` | Read-only identity (list and get). Secret; kept offline with the age identity. |
| `INECEKVAR_BACKUP_S3_ADMIN_ACCESS_KEY`, `INECEKVAR_BACKUP_S3_ADMIN_SECRET_KEY` | `bucket-setup.sh` | MinIO admin identity (local stack and drill only). |
| `INECEKVAR_MEDIA_BUCKET`, `INECEKVAR_EXPORTS_BUCKET` | `bucket-setup.sh` | The API settings of the same name; versioning and lifecycle are applied to them. |
| `INECEKVAR_BACKUP_PG_CONTAINER`, `INECEKVAR_BACKUP_PG_DATABASE`, `INECEKVAR_BACKUP_PG_USER` | `backup.sh` | Source database (container or libpq environment); defaults `inecekvar`. |
| `INECEKVAR_RESTORE_AGE_IDENTITY_FILE` or `INECEKVAR_RESTORE_AGE_IDENTITY` | `restore.sh`, `restore-drill.sh` | The age identity (private key): a file path, or the text, which is written to a 0600 temp file and removed. Never stored in the repository. |
| `INECEKVAR_RESTORE_PG_DATABASE`, `INECEKVAR_RESTORE_PG_CONTAINER`, `INECEKVAR_RESTORE_PG_USER` | `restore.sh`, `replay-deletions.sh` | Restore target; must be empty for `restore.sh`. |
| `INECEKVAR_RESTORE_OBJECT` | `restore.sh` | A dump key to restore instead of the newest. |
| `INECEKVAR_REPLAY_DELETIONS_FILE`, `INECEKVAR_REPLAY_APPLY`, `INECEKVAR_REPLAY_STATE_FILE` | `replay-deletions.sh` | Replay list, `1` to re-apply missing requests, and an optional state output. |
| `INECEKVAR_BACKUP_MC_IMAGE`, `INECEKVAR_BACKUP_DOCKER_NETWORK`, `INECEKVAR_BACKUP_AGE_BIN` | all | Bucket client image (default the `minio-init` image), its docker network, the age binary. |
| `INECEKVAR_DRILL_EXPECTED`, `INECEKVAR_DRILL_DELETIONS`, `INECEKVAR_DRILL_REPLAY`, `INECEKVAR_DRILL_REQUIRED_TABLES`, `INECEKVAR_DRILL_EXPECTED_HEAD`, `INECEKVAR_DRILL_PG_IMAGE` | `restore-drill.sh` | Source fingerprint, replay list, replay switch (default `1`), tables that must hold rows, expected Alembic head, scratch PostGIS image. |
| `INECEKVAR_DRILL_PG_PORT`, `INECEKVAR_DRILL_MINIO_PORT`, `INECEKVAR_DRILL_MINIO_IMAGE`, `INECEKVAR_DRILL_AGE_KEYGEN_BIN`, `INECEKVAR_DRILL_UV_BIN`, `INECEKVAR_DRILL_MUTATION` | `drill-e2e.sh` | Host ports on 127.0.0.1 (default 57791 and 57792; 57277 to 57776 refused), images and tools, and the negative-run switch. Passwords of the scratch stack are random per run. |

## Cost guard, degrade mode and error reports (Phase 6)

Runbooks: [cost-alerts.md](cost-alerts.md), [logging.md](logging.md); ADR-0054. The worker job `cost.guard` reads its own settings class (`app/workers/cost_guard.py`, prefix `INECEKVAR_COST_GUARD_`); the API settings ignore these keys. A count at or above its threshold alerts once per resource and UTC day.

| Key | Default | Purpose |
| --- | --- | --- |
| `INECEKVAR_COST_GUARD_EMAILS_PER_DAY` | `80` | Sign-in, registration and erasure mails per UTC day (80 % of the Resend free tier). |
| `INECEKVAR_COST_GUARD_PACK_DOWNLOADS_PER_DAY` | `1000` | `pack_downloads` rows per UTC day. |
| `INECEKVAR_COST_GUARD_PRESIGNS_PER_DAY` | `300` | Presigned photo uploads per UTC day (300 x 4 MiB = 1.2 GiB). |
| `INECEKVAR_COST_GUARD_EXPORTS_PER_DAY` | `20` | Export runs (weekly job and admin) per UTC day. |
| `INECEKVAR_COST_GUARD_PLANNER_CALLS_PER_DAY` | `20000` | Computed plans (cache misses) per UTC day (alert only). |
| `INECEKVAR_COST_GUARD_PLANNER_CALLS_PER_HOUR` | `3000` | Computed plans (cache misses) in the current UTC hour; reaching it logs `cost.guard.alert` (resource `planner_load`) and sets the planner degrade flag. **Must exceed the per-IP plan limit (30 a minute, so 1,800 an hour per address or IPv6 /64) times the number of attacker addresses you want to absorb**: with the default, two addresses at the limit can force a degrade for every city (ADR-0054 decision 10). |
| `INECEKVAR_COST_GUARD_DEGRADE_ON_LOAD` | `true` | `false` keeps the load alert but never sets the flag automatically. |
| `INECEKVAR_COST_GUARD_COOL_DOWN_MINUTES` | `60` | Lifetime of the guard's flag, re-armed while the load holds; the guard clears it a full cool-down after the last re-arm (5 to 1440). |
| `INECEKVAR_COST_GUARD_DRY_RUN` | `false` | Log `cost.guard.alert_suppressed` and `cost.guard.degrade_suppressed`, write nothing. `INECEKVAR_JOBS_DRY_RUN` and the job argument also apply. |
| `INECEKVAR_SENTRY_DSN` | unset | Error reports (API and worker). Unset: no SDK is imported. Set without the `sentry_sdk` package installed (the case in this repository): one `error_reporting.sdk_missing` warning, nothing sent. Treat as a secret. |
| `INECEKVAR_SENTRY_ENVIRONMENT` | `production` | Environment name sent with error reports. |

The manual degrade command `uv run python -m app.ops.planner_degrade on|off|status` reads only `INECEKVAR_REDIS_URL`. Redis keys: `inecekvar:ops:planner-degrade` (the flag), `inecekvar:cost:planner-calls:<UTC YYYYMMDDHH>` (3 days), `inecekvar:cost:alerted:<day>:<resource>` (2 days).

## Read by the web SSR server (Phase 4)

`apps/web/src/server/config.ts` reads these keys (ADR-0038 item 1, ADR-0039 item 13). `INECEKVAR_ENV` unset means production; an invalid origin, URL, fingerprint or team id stops start-up.

| Key | Default | Purpose |
| --- | --- | --- |
| `IV_WEB_CANONICAL_ORIGIN` | `https://inecekvar.app` | Origin written into canonical links, sitemaps and JSON-LD; in production any other allowed host is redirected to it with 301. |
| `IV_WEB_ALLOWED_HOSTS` | `inecekvar.app,www.inecekvar.app` | `Host` values the server answers; anything else is 400. The PWA host's Caddy site sends the canonical host for the app-link files (`INECEKVAR_WEB_HOST`). |
| `IV_WEB_API_PUBLIC_ORIGIN` | `https://api.inecekvar.app` | Public API origin, listed in the CSP `connect-src` and used for the export URL shown on `/veri`. |
| `IV_WEB_API_INTERNAL_URL` | `http://127.0.0.1:57800/v1` | API base the SSR server reads public data from (server side only, never sent to browsers). |
| `IV_WEB_TILES_ORIGIN` | `https://tiles.inecekvar.app` | Tiles origin for the CSP `img-src` and `connect-src`; keep it equal to `INECEKVAR_PWA_TILES_ORIGIN` and the app's `tilesBase` (`docs/release/pmtiles-recipe.md`). |
| `IV_WEB_APP_ORIGIN` | `https://app.inecekvar.app` | Origin of the web app (PWA) that public pages link to. |
| `IV_WEB_ANDROID_CERT_SHA256` | unset (owner-provided) | Comma-separated SHA-256 signing fingerprints (`AA:BB:...`, 32 bytes each) for `/.well-known/assetlinks.json`; unset answers 404. Served on both hosts (the PWA host through Caddy, ADR-0057). |
| `IV_WEB_IOS_TEAM_ID` | unset (owner-provided) | Apple team id (`^[A-Z0-9]{10}$`) for `/.well-known/apple-app-site-association`; unset answers 404. |
| `IV_WEB_IOS_APP_ID` | unset | App Store id (6 to 12 digits) for the Smart App Banner; other values are ignored. |
| `IV_WEB_CACHE_TTL_SECONDS`, `IV_WEB_CACHE_MAX_ENTRIES`, `IV_WEB_CACHE_QUERY_ALLOWLIST` | `600`, `500`, `sayfa` | Page cache lifetime, size and the query parameters that may vary a cached page. |

Two keys were added after the phase 4 review:

| Key | Default | Purpose |
| --- | --- | --- |
| `IV_WEB_BYPASS_RENDER_BURST` | `60` | Token bucket size for renders that cannot use the page cache (requests with `Cookie` or `Authorization`, repeated or oversized allowlisted parameters). Cacheable requests and the client-only `/admin` shell never consume it. Over the limit the server answers 429 with `Retry-After`. |
| `IV_WEB_BYPASS_RENDER_PER_MINUTE` | `60` | Refill rate of that bucket. |

The bucket is keyed on the TCP peer address (`trust proxy` stays off and forwarded headers are stripped). Behind a reverse proxy every request has the proxy's address, so the limit becomes one shared bucket for all cache-bypass renders: it caps the load such requests put on the API, and under abuse it can also delay public page views of signed-in staff (never the `/admin` shell).

## Admin origin and the staff session cookie

The staff session cookie is `__Host-iv_session` with `Path=/` (the `__Host-` prefix forbids a narrower path), plus a CSRF cookie. While the admin UI lives under `inecekvar.app/admin`, every public page request of a signed-in moderator carries these cookies to the public SSR Node process (which never reads them, never forwards them to rendering and bypasses the page cache for them). A compromise of the SSR tier would therefore expose staff sessions.

Production should serve the admin UI on a separate origin (for example `yonetim.inecekvar.app`, its own Caddy site that proxies `/api/*` to the API and everything else to a static build of the admin shell) or behind a path whose cookie never reaches the public SSR node. Current state, recorded honestly: the repository has only the local `ops/Caddyfile` (`:8080` web, `:8081` PWA, both proxying `/api/*`); no production Caddy configuration exists, no admin origin is configured, and the API cookie settings have not been checked for such an origin. This is a deployment decision for the hosting work (ADR-0002); no code changed for it in phase 4 (ADR-0041 item 15).

## Reverse proxy (`ops/Caddyfile`)

Caddy reads these from its process environment (compose passes them through). Production uses the same snippets with public TLS (release checklist G2).

| Key | Default | Purpose |
| --- | --- | --- |
| `INECEKVAR_API_UPSTREAM` | `host.docker.internal:57800` | API address that `/api/*` on both browser origins and the API site are proxied to. |
| `INECEKVAR_WEB_UPSTREAM` | `host.docker.internal:4200` | Web SSR server address; also the source of the two app-link files on the PWA site. |
| `INECEKVAR_WEB_HOST` | `inecekvar.app` | `Host` header Caddy sends when it fetches `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` for the PWA site; must be the web server's canonical host. |
| `INECEKVAR_PWA_API_ORIGIN` | `https://api.inecekvar.app` | API origin in the PWA CSP `connect-src`. |
| `INECEKVAR_PWA_TILES_ORIGIN` | `https://tiles.inecekvar.app` | Tiles origin in the PWA CSP `img-src` and `connect-src`. |
| `INECEKVAR_PWA_UPLOAD_ORIGIN` | `https://*.r2.cloudflarestorage.com` (compose: `http://127.0.0.1:57900`) | Presigned photo upload origin in the PWA CSP; the deployment narrows it to the media bucket's account endpoint. |
| `INECEKVAR_WEB_TLS_PORT`, `INECEKVAR_APP_TLS_PORT`, `INECEKVAR_API_TLS_PORT` | `58443`, `58444`, `58445` | Local host ports of the https sites (redirect targets of the plain http sites). |

## First-run bootstrap (`python -m app.ops.bootstrap`)

The command (ADR-0057, release checklist section 7) reads the API settings, so it runs with the API's environment: with `INECEKVAR_ENV=production` every key that the API requires must be set, as for the API process. It uses `INECEKVAR_DATABASE_URL` and, for `admin`, `INECEKVAR_LOG_HASH_KEY` (the audit row stores an HMAC-SHA256 digest of the address in `diff_hash`, never the address). With `INECEKVAR_ENV=local` and no log hash key set, the digest key is missing and `admin` stops with a configuration error; set the key. A new account's password is read from stdin (`--password-stdin`), never from an argument or a key. On invalid settings only the field names are printed.
