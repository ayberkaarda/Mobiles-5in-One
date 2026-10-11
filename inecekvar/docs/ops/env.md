# Local environment variables

These values are for local development only. Password-like values are the compose defaults (`inecekvar_local_dev`); never reuse them outside the local stack. Angular environment configuration may contain public values only.

Phase 0 has no API settings class: `pydantic-settings` is not installed yet and the API reads no environment variable at runtime. The keys below are therefore split by who actually reads them today.

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

## Planned for Phase 1

These keys are in `.env.example` so the local values are written down once, but nothing reads them yet. The Phase 1 API settings class (`pydantic-settings`) will consume them.

| Key | Local value | Purpose |
| --- | --- | --- |
| `APP_ENV` | `local` | Selects local application configuration. |
| `DATABASE_URL` | `postgresql+asyncpg://inecekvar:inecekvar_local_dev@localhost:57432/inecekvar` | Local Postgres connection (compose default password). |
| `REDIS_URL` | `redis://localhost:57379/0` | Local Redis connection; the local instance has no password. |
| `S3_ENDPOINT_URL` | `http://localhost:57900` | Local MinIO S3-compatible endpoint. |
| `S3_BUCKET` | `inecekvar-media` | Local object bucket (the compose init also creates inecekvar-exports and inecekvar-backups). |
| `S3_ACCESS_KEY_ID` | `inecekvar` | Local MinIO access key. |
| `S3_SECRET_ACCESS_KEY` | `inecekvar_local_dev` | Local MinIO secret key. |
| `SMTP_HOST` | `localhost` | Local Mailpit SMTP host. |
| `SMTP_PORT` | `57025` | Local Mailpit SMTP port. |

Do not place signing keys, provider credentials, production endpoints or other secrets in the example file. Production hosting, the public domain, TLS and HSTS preload are not exercised: no domain, no host.
