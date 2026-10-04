# Environment variables

Server configuration lives in `server/.env` (gitignored), created from `server/.env.example`. Every
key below is read only in `server/config/*.php`; application code, controllers and jobs read
`config('...')`, never `env()`.

The app has a single build-time key, `API_BASE_URL`, passed with `--dart-define-from-file`. No other
value is compiled into the app.

## Conventions

- `.env.example` holds either an empty value or a documented dummy that is valid only locally. No
  value that looks like a key, token or credential is ever committed.
- "Secret in production" means the value must come from the host environment or a secret store and
  must never appear in the repository, an image layer or a log.
- Local values match `docker-compose.yml` (project `askida`, host ports 55432 for Postgres, 56379
  for Redis, 59000 and 59001 for MinIO, 51025 and 58025 for Mailpit, 58080 for the server).
  Each host port can be changed for a second stack with an environment variable read by compose
  (not by Laravel): `ASKIDA_PG_PORT`, `ASKIDA_REDIS_PORT`, `ASKIDA_WEB_PORT`, `ASKIDA_MINIO_PORT`,
  `ASKIDA_MINIO_CONSOLE_PORT`, `ASKIDA_MAIL_SMTP_PORT`, `ASKIDA_MAIL_UI_PORT`; the database and
  object-storage passwords can be changed with `ASKIDA_DB_PASSWORD` and `ASKIDA_MINIO_PASSWORD`
  (then update `server/.env` to match).

## Server keys

| Key                                           | Purpose                                                                                                                                                                                                 | Local convention                              | Secret in production |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------- |
| `APP_NAME`                                    | Application name in mail and logs                                                                                                                                                                       | `Askida`                                      | no                   |
| `APP_ENV`                                     | Environment name: `local`, `testing`, `production`; gates simulated transports                                                                                                                          | `local`                                       | no                   |
| `APP_KEY`                                     | Encryption key for `Crypt` (tax number, IBAN) and cookies                                                                                                                                               | empty; set with `php artisan key:generate`    | yes                  |
| `APP_DEBUG`                                   | Debug output; must be `false` outside local                                                                                                                                                             | `true`                                        | no                   |
| `APP_URL`                                     | Public base URL, used for links and signed URLs                                                                                                                                                         | `http://localhost:58080`                      | no                   |
| `APP_TIMEZONE`                                | Application time zone                                                                                                                                                                                   | `Europe/Istanbul`                             | no                   |
| `LOG_CHANNEL`                                 | Log channel                                                                                                                                                                                             | `stack`                                       | no                   |
| `LOG_LEVEL`                                   | Minimum log level                                                                                                                                                                                       | `debug`                                       | no                   |
| `DB_CONNECTION`                               | Database driver, always `pgsql`                                                                                                                                                                         | `pgsql`                                       | no                   |
| `DB_HOST`                                     | Database host                                                                                                                                                                                           | `postgres` (compose service)                  | no                   |
| `DB_PORT`                                     | Database port                                                                                                                                                                                           | `5432` inside compose                         | no                   |
| `DB_DATABASE`                                 | Database name                                                                                                                                                                                           | `askida`                                      | no                   |
| `DB_USERNAME`                                 | Database user                                                                                                                                                                                           | `askida`                                      | no                   |
| `DB_PASSWORD`                                 | Database password                                                                                                                                                                                       | a documented local dummy word                 | yes                  |
| `REDIS_HOST`                                  | Redis host (queues, cache, rate limits)                                                                                                                                                                 | `redis` (compose service)                     | no                   |
| `REDIS_PORT`                                  | Redis port                                                                                                                                                                                              | `6379` inside compose                         | no                   |
| `QUEUE_CONNECTION`                            | Queue driver, `redis` (Horizon)                                                                                                                                                                         | `redis`                                       | no                   |
| `CACHE_STORE`                                 | Cache driver                                                                                                                                                                                            | `redis`                                       | no                   |
| `SESSION_DRIVER`                              | Web and admin session driver                                                                                                                                                                            | `redis`                                       | no                   |
| `SESSION_SECURE_COOKIE`                       | Send session cookie only over HTTPS; `true` outside local                                                                                                                                               | `false`                                       | no                   |
| `SESSION_SAME_SITE`                           | Cookie SameSite policy (admin guard is `strict`)                                                                                                                                                        | `lax`                                         | no                   |
| `FILESYSTEM_DISK`                             | Default disk                                                                                                                                                                                            | `local`                                       | no                   |
| `AWS_ACCESS_KEY_ID`                           | S3-compatible storage access key (MinIO locally, R2 in production)                                                                                                                                      | MinIO local user word                         | yes                  |
| `AWS_SECRET_ACCESS_KEY`                       | S3-compatible storage secret                                                                                                                                                                            | MinIO local dummy word                        | yes                  |
| `AWS_DEFAULT_REGION`                          | Storage region                                                                                                                                                                                          | `us-east-1`                                   | no                   |
| `AWS_BUCKET_PRIVATE`                          | Private bucket: shop documents, backups                                                                                                                                                                 | `askida-private`                              | no                   |
| `AWS_BUCKET_PUBLIC`                           | Public bucket: shop photos                                                                                                                                                                              | `askida-public`                               | no                   |
| `AWS_ENDPOINT`                                | Storage endpoint URL                                                                                                                                                                                    | MinIO service URL                             | no                   |
| `AWS_USE_PATH_STYLE_ENDPOINT`                 | Path-style addressing, needed for MinIO                                                                                                                                                                 | `true`                                        | no                   |
| `MAIL_MAILER`                                 | Mail transport                                                                                                                                                                                          | `smtp` to Mailpit                             | no                   |
| `MAIL_HOST`                                   | SMTP host                                                                                                                                                                                               | `mailpit` (compose service)                   | no                   |
| `MAIL_PORT`                                   | SMTP port                                                                                                                                                                                               | `1025` inside compose                         | no                   |
| `MAIL_FROM_ADDRESS`                           | Sender address                                                                                                                                                                                          | a local example address                       | no                   |
| `HOOK_CODE_PEPPER`                            | Pepper for `HMAC-SHA256` of redemption codes, at least 32 characters; changing it invalidates all open codes; an empty or short value stops the boot outside `local` and `testing` (ADR-0020, ADR-0021) | a plain-word local dummy that is not a secret | yes                  |
| `HOOK_RESERVATION_MINUTES`                    | Minutes a reserved unit is held before it returns to the pool (ADR-0020)                                                                                                                                | `10`                                          | no                   |
| `ATTESTATION_DRIVER`                          | Device attestation adapter: `fake` or `real`; `fake` is refused outside `local` and `testing` (ADR-0019, ADR-0021)                                                                                      | `fake`                                        | no                   |
| `PLAY_INTEGRITY_PACKAGE_NAME`                 | Android application id the integrity verdict must name                                                                                                                                                  | empty                                         | no                   |
| `APPLE_DEVICECHECK_ENVIRONMENT`               | DeviceCheck endpoint: `sandbox` (maps to the development endpoint) or `production`; config default is `production`                                                                                      | `sandbox`                                     | no                   |
| `PUSH_DRIVER`                                 | Push transport: `log` is refused outside `local` and `testing`; no real transport exists yet (ADR-0021)                                                                                                 | `log`                                         | no                   |
| `PUSH_HOURLY_FANOUT_CAP`                      | Push deliveries allowed per hour across all users; above it deliveries are dropped with a warning (config default 2000)                                                                                 | `500`                                         | no                   |
| `FILESYSTEM_PRIVATE_DISK`                     | Name of the disk that holds shop documents; never a public disk (ADR-0017)                                                                                                                              | `private`                                     | no                   |
| `DOCUMENT_URL_TTL_SECONDS`                    | Listed in `.env.example` but read by no configuration file: the signed URL lifetime is the constant 5 minutes of the document rules (ADR-0017)                                                          | `300`, no effect                              | no                   |
| `ALLOW_SAMPLE_SHOPS`                          | Include `is_sample` shops in public listings; honoured outside production only (ADR-0016); config default is off                                                                                        | `true`                                        | no                   |
| `AWS_PUBLIC_ENDPOINT`                         | Endpoint written into presigned upload URLs for devices that reach the store under another address than the server; empty uses `AWS_ENDPOINT`                                                           | empty; emulator `http://10.0.2.2:59000`       | no                   |
| `APP_CIPHER`                                  | Cipher of the encrypted columns (tax number, IBAN) and `Crypt`; the key stays 32 bytes                                                                                                                  | `AES-256-GCM`                                 | no                   |
| `PAYMENT_PROVIDER`                            | Payment adapter: `iyzico` or `fake`; `fake` is rejected outside local and test                                                                                                                          | `fake`                                        | no                   |
| `IYZICO_BASE_URL`                             | iyzico API base URL (sandbox or live)                                                                                                                                                                   | iyzico sandbox URL from `.env.example`        | no                   |
| `IYZICO_API_KEY`                              | iyzico API key                                                                                                                                                                                          | empty                                         | yes                  |
| `IYZICO_SECRET_KEY`                           | iyzico secret key; also used for provider signatures                                                                                                                                                    | empty                                         | yes                  |
| `PLAY_INTEGRITY_PROJECT`                      | Google Cloud project number for Play Integrity verdict decoding                                                                                                                                         | empty                                         | no                   |
| `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON`         | Service account credential for the Play Integrity API                                                                                                                                                   | empty                                         | yes                  |
| `APPLE_TEAM_ID`                               | Apple team identifier for DeviceCheck                                                                                                                                                                   | empty                                         | no                   |
| `APPLE_DEVICECHECK_KEY_ID`                    | DeviceCheck key identifier                                                                                                                                                                              | empty                                         | no                   |
| `APPLE_DEVICECHECK_P8`                        | DeviceCheck private key content                                                                                                                                                                         | empty                                         | yes                  |
| `SENTRY_LARAVEL_DSN`                          | Error reporting DSN; empty disables reporting                                                                                                                                                           | empty                                         | yes                  |
| `DB_TIMEZONE`                                 | Database session time zone; defaults to `APP_TIMEZONE` so timestamps and business days agree (ADR-0014)                                                                                                 | unset (uses `APP_TIMEZONE`)                   | no                   |
| `APPLE_CLIENT_ID`                             | Comma list of client ids accepted as the Apple identity token audience; empty rejects every token                                                                                                       | empty                                         | no                   |
| `GOOGLE_CLIENT_ID`                            | Comma list of client ids accepted as the Google identity token audience; empty rejects every token                                                                                                      | empty                                         | no                   |
| `BREACHED_PASSWORD_CHECK`                     | Breached password check (k-anonymity range API); fails open with a warning (ADR-0009)                                                                                                                   | `true`                                        | no                   |
| `AUTH_LOCKOUT_ATTEMPTS`                       | Failed sign-ins per e-mail and address before a lockout                                                                                                                                                 | `10`                                          | no                   |
| `AUTH_LOCKOUT_MINUTES`                        | Lockout duration in minutes                                                                                                                                                                             | `15`                                          | no                   |
| `SANCTUM_TOKEN_EXPIRATION_MINUTES`            | Device token lifetime in minutes (30 days)                                                                                                                                                              | `43200`                                       | no                   |
| `TRUSTED_PROXIES`                             | Comma list of proxy addresses or CIDR ranges whose forwarded headers are trusted; empty means none; `*` only as the whole value (ADR-0011)                                                              | empty                                         | no                   |
| `SECURITY_HSTS_FORCE`                         | Send HSTS even when the request does not look secure (TLS ended by an untrusted hop)                                                                                                                    | `false`                                       | no                   |
| `SECURITY_CORS_ALLOWED_ORIGINS`               | Comma list of exact origins allowed by CORS; wildcard entries are dropped                                                                                                                               | `https://askida.app`                          | no                   |
| `SECURITY_CSP_FRAME_SRC_PAY`                  | Comma list of payment provider frame hosts for `/pay/*`; empty means no frames                                                                                                                          | empty                                         | no                   |
| `ARGON_MEMORY`, `ARGON_TIME`, `ARGON_THREADS` | Test-only overrides of the Argon2id cost; production uses the defaults 65536, 4, 1 (ADR-0009)                                                                                                           | unset (tests set a low cost in `phpunit.xml`) | no                   |

Notes:

- Empty provider keys (iyzico, Play Integrity, Apple) mean the real adapter is not configured. In
  `local` and test environments the simulated transports are used; see ADR-0002, ADR-0004 and
  ADR-0006.
- Push-related server secrets are described in ADR-0004; a Firebase service account value is added
  to the environment when real push is enabled and is a secret in production.
- The local pepper in `.env.example` is long enough to pass the length check, so copying the file to
  production would not stop the boot; every non-local environment sets its own random value.
- Presigned upload URLs are signed for one host. Inside compose that is `http://minio:9000`, which a
  device cannot reach; set `AWS_PUBLIC_ENDPOINT` to the address the device uses (the URL is signed for
  it, not rewritten, ADR-0017).
- Queues: Horizon's default supervisor consumes `default`, `push` and `payments`. Scheduled jobs
  (`hooks.release-expired` every minute, `anon.purge-old` daily 03:15 Europe/Istanbul,
  `accounts.hard-delete` and `impact.snapshot` hourly) run in the compose `scheduler` service
  (`schedule:work`); no other variable controls them.
- Mail for account deletion uses the `MAIL_*` keys; the tests fake the mailer, so a real SMTP service
  is not exercised.
- Rotating `APP_KEY` requires re-encrypting `tax_number_enc` and `iban_enc`; the plan lives with the
  history-purge runbook in `docs/security/`.

## Sample accounts (local only)

`php artisan migrate --seed` creates sample data only when `APP_ENV` is `local` or `testing`; it
refuses to run elsewhere. The sample users exist only for local development and demos, use the
reserved `example.test` domain, and their passwords are plain words, not secrets:

| Account                      | Kind     | Password        |
| ---------------------------- | -------- | --------------- |
| `ornek-esnaf@example.test`   | merchant | `ornek-esnaf`   |
| `ornek-bagisci@example.test` | donor    | `ornek-bagisci` |

The seed also creates six sample shops with `is_sample = true` and the name prefix `[ÖRNEK]`. Admin
roles and permissions are seeded in every environment; no admin user is created.

## Troubleshooting a fresh stack

On a Windows bind mount the first `composer install` inside the server container can exceed
Composer's default 300 second process timeout, and the start script then restarts in a loop. Stop the
server service, run the install once with `COMPOSER_PROCESS_TIMEOUT=0` in a one-off container
(`docker compose run --rm --no-deps --entrypoint "" server sh -c "COMPOSER_PROCESS_TIMEOUT=0 composer install"`),
then start the server again. The start script also creates `.env` from `.env.example` and runs `key:generate` when no
`APP_KEY` exists, so a manual run is not needed.

## Parallel stacks

Compose derives the volume names from the project name (`<project>_pg`, `<project>_minio`), so two
projects never share a data directory. To run a second stack, give it its own project name and host
ports, for example
`ASKIDA_PG_PORT=55441 ASKIDA_REDIS_PORT=56441 ASKIDA_WEB_PORT=58441 docker compose -p askida-second up -d`,
and its own `server/.env` copy. Never run two test processes against the same database, and never run
`docker compose down -v` without the owner's approval.

## App keys

| Key            | Purpose                    | Where it comes from                                                               | Secret |
| -------------- | -------------------------- | --------------------------------------------------------------------------------- | ------ |
| `API_BASE_URL` | Base URL of the server API | `app/env/*.json` via `--dart-define-from-file` (only `example.json` is committed) | no     |
