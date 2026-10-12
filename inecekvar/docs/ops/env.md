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
| `INECEKVAR_REQUIRE_DOCKER` | `api/tests/conftest.py` | `1` turns a skipped PostGIS test into a failure (set in CI). |

The API bind address and port are uvicorn flags, not environment keys: `uv run uvicorn app.main:app --host 127.0.0.1 --port 57800` (Caddy proxies `/api/*` to port 57800).

## Read by the API (Phase 1)

`api/app/core/settings.py` reads these with the prefix `INECEKVAR_` (case-insensitive). `INECEKVAR_ENV` is required. With `local`, missing URLs fall back to the compose defaults and missing secrets and the ES256 key pair are created per process (`app/main.py::with_local_defaults`); with `test` or `production` they are required and startup fails without them.

| Key | Local value | Purpose |
| --- | --- | --- |
| `INECEKVAR_ENV` | `local` | `local`, `test` or `production`; selects defaults and the local CORS origins. |
| `INECEKVAR_DATABASE_URL` | `postgresql+asyncpg://inecekvar:inecekvar_local_dev@localhost:57432/inecekvar` | PostgreSQL connection (also read by Alembic and the seed). |
| `INECEKVAR_REDIS_URL` | `redis://localhost:57379/0` | Redis for rate limits. |
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

Token lifetimes, Argon2 parameters, body limits and rate-limit rules have defaults fixed by the specification and are not meant to be changed per environment.

The API does not read `.env` files: export the values in the shell before `uv run uvicorn app.main:app --reload` (at least `INECEKVAR_ENV=local`); without `INECEKVAR_ENV` startup stops with a validation error.

## Planned for Phase 2

Object storage keys are in `.env.example` so the local values are written down once; the API does not read them yet.

| Key | Local value | Purpose |
| --- | --- | --- |
| `S3_ENDPOINT_URL` | `http://localhost:57900` | Local MinIO S3-compatible endpoint. |
| `S3_BUCKET` | `inecekvar-media` | Local object bucket (the compose init also creates inecekvar-exports and inecekvar-backups). |
| `S3_ACCESS_KEY_ID` | `inecekvar` | Local MinIO access key. |
| `S3_SECRET_ACCESS_KEY` | `inecekvar_local_dev` | Local MinIO secret key. |

Do not place signing keys, provider credentials, production endpoints or other secrets in the example file. Production hosting, the public domain, TLS and HSTS preload are not exercised: no domain, no host.
