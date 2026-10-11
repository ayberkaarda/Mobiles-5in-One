# Local environment variables

These values are for local development only. Password-like values use `local-dev-only`; never reuse them outside the local stack. API configuration is read through `pydantic-settings`. Angular environment configuration may contain public values only.

| Key | Local value | Purpose |
| --- | --- | --- |
| `APP_ENV` | `local` | Selects local application configuration. |
| `API_HOST` | `127.0.0.1` | API bind address. |
| `API_PORT` | `8000` | API bind port. |
| `DATABASE_URL` | `postgresql+asyncpg://inecekvar:local-dev-only@localhost:5432/inecekvar` | Local Postgres connection; password is local-dev-only. |
| `REDIS_URL` | `redis://:local-dev-only@localhost:6379/0` | Local Redis connection; password is local-dev-only. |
| `S3_ENDPOINT_URL` | `http://localhost:9000` | Local MinIO S3-compatible endpoint. |
| `S3_BUCKET` | `inecekvar-local` | Local object bucket. |
| `S3_ACCESS_KEY_ID` | `local-dev-only` | Local MinIO access key. |
| `S3_SECRET_ACCESS_KEY` | `local-dev-only` | Local MinIO secret key. |
| `SMTP_HOST` | `localhost` | Local Mailpit SMTP host. |
| `SMTP_PORT` | `1025` | Local Mailpit SMTP port. |
| `CADDY_HTTP_PORT` | `8080` | Local Caddy HTTP port. |
| `CADDY_HTTPS_PORT` | `8443` | Local Caddy HTTPS port. |

Copy `.env.example` for local configuration. Do not place signing keys, provider credentials, production endpoints or other secrets in the example file. Production hosting, the public domain, TLS and HSTS preload are not exercised: no domain, no host.
