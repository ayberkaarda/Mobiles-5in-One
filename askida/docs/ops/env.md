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

## Server keys

| Key                                   | Purpose                                                                              | Local convention                           | Secret in production |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------- |
| `APP_NAME`                            | Application name in mail and logs                                                    | `Askida`                                   | no                   |
| `APP_ENV`                             | Environment name: `local`, `testing`, `production`; gates simulated transports       | `local`                                    | no                   |
| `APP_KEY`                             | Encryption key for `Crypt` (tax number, IBAN) and cookies                            | empty; set with `php artisan key:generate` | yes                  |
| `APP_DEBUG`                           | Debug output; must be `false` outside local                                          | `true`                                     | no                   |
| `APP_URL`                             | Public base URL, used for links and signed URLs                                      | `http://localhost:58080`                   | no                   |
| `APP_TIMEZONE`                        | Application time zone                                                                | `Europe/Istanbul`                          | no                   |
| `LOG_CHANNEL`                         | Log channel                                                                          | `stack`                                    | no                   |
| `LOG_LEVEL`                           | Minimum log level                                                                    | `debug`                                    | no                   |
| `DB_CONNECTION`                       | Database driver, always `pgsql`                                                      | `pgsql`                                    | no                   |
| `DB_HOST`                             | Database host                                                                        | `postgres` (compose service)               | no                   |
| `DB_PORT`                             | Database port                                                                        | `5432` inside compose                      | no                   |
| `DB_DATABASE`                         | Database name                                                                        | `askida`                                   | no                   |
| `DB_USERNAME`                         | Database user                                                                        | `askida`                                   | no                   |
| `DB_PASSWORD`                         | Database password                                                                    | a documented local dummy word              | yes                  |
| `REDIS_HOST`                          | Redis host (queues, cache, rate limits)                                              | `redis` (compose service)                  | no                   |
| `REDIS_PORT`                          | Redis port                                                                           | `6379` inside compose                      | no                   |
| `QUEUE_CONNECTION`                    | Queue driver, `redis` (Horizon)                                                      | `redis`                                    | no                   |
| `CACHE_STORE`                         | Cache driver                                                                         | `redis`                                    | no                   |
| `SESSION_DRIVER`                      | Web and admin session driver                                                         | `redis`                                    | no                   |
| `SESSION_SECURE_COOKIE`               | Send session cookie only over HTTPS; `true` outside local                            | `false`                                    | no                   |
| `SESSION_SAME_SITE`                   | Cookie SameSite policy (admin guard is `strict`)                                     | `lax`                                      | no                   |
| `FILESYSTEM_DISK`                     | Default disk                                                                         | `local`                                    | no                   |
| `AWS_ACCESS_KEY_ID`                   | S3-compatible storage access key (MinIO locally, R2 in production)                   | MinIO local user word                      | yes                  |
| `AWS_SECRET_ACCESS_KEY`               | S3-compatible storage secret                                                         | MinIO local dummy word                     | yes                  |
| `AWS_DEFAULT_REGION`                  | Storage region                                                                       | `us-east-1`                                | no                   |
| `AWS_BUCKET_PRIVATE`                  | Private bucket: shop documents, backups                                              | `askida-private`                           | no                   |
| `AWS_BUCKET_PUBLIC`                   | Public bucket: shop photos                                                           | `askida-public`                            | no                   |
| `AWS_ENDPOINT`                        | Storage endpoint URL                                                                 | MinIO service URL                          | no                   |
| `AWS_USE_PATH_STYLE_ENDPOINT`         | Path-style addressing, needed for MinIO                                              | `true`                                     | no                   |
| `MAIL_MAILER`                         | Mail transport                                                                       | `smtp` to Mailpit                          | no                   |
| `MAIL_HOST`                           | SMTP host                                                                            | `mailpit` (compose service)                | no                   |
| `MAIL_PORT`                           | SMTP port                                                                            | `1025` inside compose                      | no                   |
| `MAIL_FROM_ADDRESS`                   | Sender address                                                                       | a local example address                    | no                   |
| `HOOK_CODE_PEPPER`                    | Pepper for `HMAC-SHA256` of redemption codes; changing it invalidates all open codes | empty or a documented local dummy word     | yes                  |
| `PAYMENT_PROVIDER`                    | Payment adapter: `iyzico` or `fake`; `fake` is rejected outside local and test       | `fake`                                     | no                   |
| `IYZICO_BASE_URL`                     | iyzico API base URL (sandbox or live)                                                | iyzico sandbox URL from `.env.example`     | no                   |
| `IYZICO_API_KEY`                      | iyzico API key                                                                       | empty                                      | yes                  |
| `IYZICO_SECRET_KEY`                   | iyzico secret key; also used for provider signatures                                 | empty                                      | yes                  |
| `PLAY_INTEGRITY_PROJECT`              | Google Cloud project number for Play Integrity verdict decoding                      | empty                                      | no                   |
| `PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` | Service account credential for the Play Integrity API                                | empty                                      | yes                  |
| `APPLE_TEAM_ID`                       | Apple team identifier for DeviceCheck                                                | empty                                      | no                   |
| `APPLE_DEVICECHECK_KEY_ID`            | DeviceCheck key identifier                                                           | empty                                      | no                   |
| `APPLE_DEVICECHECK_P8`                | DeviceCheck private key content                                                      | empty                                      | yes                  |
| `SENTRY_LARAVEL_DSN`                  | Error reporting DSN; empty disables reporting                                        | empty                                      | yes                  |

Notes:

- Empty provider keys (iyzico, Play Integrity, Apple) mean the real adapter is not configured. In
  `local` and test environments the simulated transports are used; see ADR-0002, ADR-0004 and
  ADR-0006.
- Push-related server secrets are described in ADR-0004; a Firebase service account value is added
  to the environment when real push is enabled and is a secret in production.
- Rotating `APP_KEY` requires re-encrypting `tax_number_enc` and `iban_enc`; the plan lives with the
  history-purge runbook in `docs/security/`.

## App keys

| Key            | Purpose                    | Where it comes from                                                               | Secret |
| -------------- | -------------------------- | --------------------------------------------------------------------------------- | ------ |
| `API_BASE_URL` | Base URL of the server API | `app/env/*.json` via `--dart-define-from-file` (only `example.json` is committed) | no     |
