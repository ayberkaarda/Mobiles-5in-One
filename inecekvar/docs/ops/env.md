# Local environment variables

These values are for local development only. Password-like values are the compose defaults (`inecekvar_local_dev`); never reuse them outside the local stack. API configuration is read through `pydantic-settings`. Angular environment configuration may contain public values only.

| Key | Local value | Purpose |
| --- | --- | --- |
| `APP_ENV` | `local` | Selects local application configuration. |
| `API_HOST` | `127.0.0.1` | API bind address. |
| `API_PORT` | `57800` | API bind port (Caddy proxies it). |
| `DATABASE_URL` | `postgresql+asyncpg://inecekvar:inecekvar_local_dev@localhost:57432/inecekvar` | Local Postgres connection (compose default password). |
| `REDIS_URL` | `redis://localhost:57379/0` | Local Redis connection; the local instance has no password. |
| `S3_ENDPOINT_URL` | `http://localhost:57900` | Local MinIO S3-compatible endpoint. |
| `S3_BUCKET` | `inecekvar-media` | Local object bucket (the compose init also creates inecekvar-exports and inecekvar-backups). |
| `S3_ACCESS_KEY_ID` | `inecekvar` | Local MinIO access key. |
| `S3_SECRET_ACCESS_KEY` | `inecekvar_local_dev` | Local MinIO secret key. |
| `SMTP_HOST` | `localhost` | Local Mailpit SMTP host. |
| `SMTP_PORT` | `57025` | Local Mailpit SMTP port. |
| `CADDY_HTTP_PORT` | `57080` | Local Caddy HTTP port (host side). |

Copy `.env.example` for local configuration. Do not place signing keys, provider credentials, production endpoints or other secrets in the example file. Production hosting, the public domain, TLS and HSTS preload are not exercised: no domain, no host.
