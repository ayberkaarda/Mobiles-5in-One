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
| `INECEKVAR_TRUSTED_PROXY_CIDRS` | `["127.0.0.1/32","::1/128"]` | Peers whose `X-Real-IP` header is trusted (Caddy). |
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

The `media.presign` rate limit is 20 requests per user per 24 hours; `pack.download` is 10 per anonymous hash or signed-in user per 24 hours; `auth.step_up` (TOTP confirmation and step-up) is 5 per 15 minutes per user and, separately, per client IP. These limits are fixed rules, not environment keys.

Token lifetimes, Argon2 parameters, body limits and other rate-limit rules have defaults fixed by the specification and are not meant to be changed per environment.

The API does not read `.env` files: export the values in the shell before `uv run uvicorn app.main:app --reload` (at least `INECEKVAR_ENV=local`); without `INECEKVAR_ENV` startup stops with a validation error.

Do not place signing keys, provider credentials, production endpoints or other secrets in the example file. Production hosting, the public domain, TLS and HSTS preload are not exercised: no domain, no host.

## Read by the web SSR server (Phase 4)

`apps/web/src/server/config.ts` reads the `IV_WEB_*` keys listed in ADR-0038 item 1. Two keys were added after the phase 4 review:

| Key | Default | Purpose |
| --- | --- | --- |
| `IV_WEB_BYPASS_RENDER_BURST` | `60` | Token bucket size for renders that cannot use the page cache (requests with `Cookie` or `Authorization`, repeated or oversized allowlisted parameters). Cacheable requests and the client-only `/admin` shell never consume it. Over the limit the server answers 429 with `Retry-After`. |
| `IV_WEB_BYPASS_RENDER_PER_MINUTE` | `60` | Refill rate of that bucket. |

The bucket is keyed on the TCP peer address (`trust proxy` stays off and forwarded headers are stripped). Behind a reverse proxy every request has the proxy's address, so the limit becomes one shared bucket for all cache-bypass renders: it caps the load such requests put on the API, and under abuse it can also delay public page views of signed-in staff (never the `/admin` shell).

## Admin origin and the staff session cookie

The staff session cookie is `__Host-iv_session` with `Path=/` (the `__Host-` prefix forbids a narrower path), plus a CSRF cookie. While the admin UI lives under `inecekvar.app/admin`, every public page request of a signed-in moderator carries these cookies to the public SSR Node process (which never reads them, never forwards them to rendering and bypasses the page cache for them). A compromise of the SSR tier would therefore expose staff sessions.

Production should serve the admin UI on a separate origin (for example `yonetim.inecekvar.app`, its own Caddy site that proxies `/api/*` to the API and everything else to a static build of the admin shell) or behind a path whose cookie never reaches the public SSR node. Current state, recorded honestly: the repository has only the local `ops/Caddyfile` (`:8080` web, `:8081` PWA, both proxying `/api/*`); no production Caddy configuration exists, no admin origin is configured, and the API cookie settings have not been checked for such an origin. This is a deployment decision for the hosting work (ADR-0002); no code changed for it in phase 4 (ADR-0041 item 15).
