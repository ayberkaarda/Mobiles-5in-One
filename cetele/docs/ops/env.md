# Environment variables

Server configuration comes from the process environment. For local work, `cetele/.env.example`
(committed, dummies only) is copied to `cetele/.env` (gitignored) and read by `docker-compose.yml`.
`application.yml` uses `${VAR}` placeholders only, and there is no `application-prod.yml` in the
repository.

The Android app has one build-time key, `cetele.apiBaseUrl`, read from `android/local.properties`.
No other value is compiled into the app.

This file was reconciled in Phase 0 with `cetele/.env.example` and `cetele/docker-compose.yml`. The "Bound in" column says which phase first reads the
key in code. A key declared in `.env.example` but bound in a later phase is documented now so that
the names are stable; until its phase it has no effect. If this file and `.env.example` disagree,
`.env.example` and the compose file are the source of truth and this file is fixed.

## Conventions

- `.env.example` holds an empty value or a documented dummy that is valid only locally. It never
  contains `TODO`, `FIXME`, `lorem` or `YOUR_` text and no value shaped like a real key or token.
- "Secret in production" means the value must come from the host environment or a secret store and
  must never appear in the repository, an image layer or a log.
- Local values match `docker-compose.yml` (project `cetele`, host ports in the 60xxx block, bound to
  `127.0.0.1`). The compose file is the source of truth for ports and service names.
- Code reads configuration through typed properties bound from `application.yml`; it never reads the
  environment directly.

## Local stack

| Service    | Host port                    | Notes                                                                                                   |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| `postgres` | 60432 (to 5432)              | PostgreSQL 16.15; database `cetele`; the init SQL in `docker/postgres/init` also creates `cetele_test`. |
| `minio`    | 60900 (API), 60901 (console) | Local stand-in for Cloudflare R2; private bucket `cetele-media`.                                        |
| `mailpit`  | 60025 (SMTP), 60825 (web UI) | Optional; catches alert mail in Phase 4 and Phase 6.                                                    |
| `server`   | 60080 (to 8080)              | Image `cetele-server:local`; health at `/actuator/health`.                                              |

The Android emulator reaches the server at `http://10.0.2.2:60080`.

## Server keys

Values are those of `cetele/.env.example`. Compose passes only the runtime, database and storage keys
to the `server` container, with the same dummies as defaults (`${VAR:-default}`), so
`docker compose up -d --wait` works without a `.env` file. The other keys are declared in
`.env.example` for stable names and are read by no code yet.

| Key                                      | Purpose                                                                                | Local value                                  | Secret in production | Bound in                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `SPRING_PROFILES_ACTIVE`                 | Spring profile; `local` enables local-only adapters                                    | `local`                                      | no                   | Phase 0                                                    |
| `SERVER_PORT`                            | Port inside the container (`${SERVER_PORT:8080}` in `application.yml`)                 | `8080`                                       | no                   | Phase 0                                                    |
| `CETELE_PUBLIC_BASE_URL`                 | Public base URL for statement links and the webhook audience                           | `http://127.0.0.1:60080`                     | no                   | Phase 2 (compose passes it, no code reads it yet)          |
| `CETELE_DB_URL`                          | JDBC URL of PostgreSQL; from the host use port 60432                                   | `jdbc:postgresql://postgres:5432/cetele`     | no                   | Phase 0                                                    |
| `CETELE_DB_USERNAME`                     | Database user                                                                          | `cetele`                                     | yes                  | Phase 0                                                    |
| `CETELE_DB_PASSWORD`                     | Database password; also read by compose for the `postgres` service                     | `cetele_local_dev` (dummy)                   | yes                  | Phase 0                                                    |
| `CETELE_S3_ENDPOINT`                     | S3-compatible endpoint (R2 in production, MinIO locally); from the host use port 60900 | `http://minio:9000`                          | no                   | Phase 0 (bound to `cetele.s3.endpoint`), used from Phase 2 |
| `CETELE_S3_REGION`                       | Region name; R2 uses `auto`                                                            | `auto`                                       | no                   | Phase 0 (bound), used from Phase 2                         |
| `CETELE_S3_ACCESS_KEY`                   | Storage access key; compose also uses it as the MinIO root user                        | `cetele` (dummy)                             | yes                  | Phase 0 (bound), used from Phase 2                         |
| `CETELE_S3_SECRET_KEY`                   | Storage secret key; compose also uses it as the MinIO root password                    | `cetele_local_dev` (dummy)                   | yes                  | Phase 0 (bound), used from Phase 2                         |
| `CETELE_S3_BUCKET_MEDIA`                 | Private bucket for ledger photos; `minio-init` creates it                              | `cetele-media`                               | no                   | Phase 0 (bound), used from Phase 2                         |
| `CETELE_S3_PATH_STYLE`                   | Path-style addressing; needed by MinIO                                                 | `true`                                       | no                   | Phase 0 (bound), used from Phase 2                         |
| `CETELE_MAIL_HOST`                       | SMTP host for alert mail                                                               | `mailpit` (compose service)                  | no                   | Phase 6                                                    |
| `CETELE_MAIL_PORT`                       | SMTP port; Mailpit listens on 1025 inside compose and 60025 on the host                | `1025`                                       | no                   | Phase 6                                                    |
| `CETELE_MAIL_FROM`                       | Sender address of alert mail                                                           | `no-reply@cetele.app`                        | no                   | Phase 6                                                    |
| `CETELE_OTP_PEPPER`                      | Secret mixed into the OTP HMAC (spec item 11)                                          | empty; set a random value locally            | yes                  | Phase 1                                                    |
| `CETELE_JWT_ES256_PRIVATE_KEY_PEM`       | ES256 private key that signs access tokens                                             | empty; a key pair is created per environment | yes                  | Phase 1                                                    |
| `CETELE_JWT_ES256_PUBLIC_KEY_PEM`        | ES256 public key that verifies access tokens                                           | empty; matches the private key               | no                   | Phase 1                                                    |
| `CETELE_SMS_PROVIDER`                    | SMS adapter: `fake` or `netgsm` ([ADR-0003](../adr/0003-sms-provider.md))              | `fake`                                       | no                   | Phase 1 (`fake` only), `netgsm` in Phase 2                 |
| `CETELE_NETGSM_USERNAME`                 | Netgsm account user                                                                    | empty                                        | yes                  | Phase 2                                                    |
| `CETELE_NETGSM_PASSWORD`                 | Netgsm account password                                                                | empty                                        | yes                  | Phase 2                                                    |
| `CETELE_NETGSM_MSGHEADER`                | Registered sender name                                                                 | empty                                        | no                   | Phase 2                                                    |
| `CETELE_SMS_DLR_SECRET`                  | HMAC secret for the delivery-report webhook (spec item 17)                             | empty; set a random value locally            | yes                  | Phase 4                                                    |
| `CETELE_PLAY_PACKAGE_NAME`               | Android package name checked in purchases and integrity verdicts                       | `app.cetele.android`                         | no                   | Phase 4 (see open note 1)                                  |
| `CETELE_PLAY_SERVICE_ACCOUNT_JSON`       | Service account for the Play Developer API                                             | empty                                        | yes                  | Phase 4 (see open note 1)                                  |
| `CETELE_PLAY_RTDN_AUDIENCE`              | Expected audience of the RTDN push JWT: the endpoint URL                               | empty                                        | no                   | Phase 4                                                    |
| `CETELE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` | Expected `email` claim: the Pub/Sub push service account                               | empty                                        | no                   | Phase 4                                                    |
| `SENTRY_DSN`                             | Error reporting; an empty value disables it                                            | empty                                        | yes                  | Phase 1                                                    |

Open notes (proposals, not decisions):

1. Spec item 5 requires a Play Integrity token on `otp/request` in Phase 1, but the contract keys
   above bind the Play settings in Phase 4. Phase 1 can verify integrity verdicts through an
   interface with a fake verifier in `local`; if a real verifier is written it needs the package
   name and a service account earlier. Decide in the Phase 1 plan.
2. `CETELE_SMS_PROVIDER` is listed as bound in Phase 1 because OTP delivery needs a gateway
   (`fake` only); the Netgsm settings stay Phase 2.

## Android key

| Key                 | File                       | Purpose                                                    | Behaviour                                                                              |
| ------------------- | -------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `cetele.apiBaseUrl` | `android/local.properties` | Base URL of the API, exposed as `BuildConfig.API_BASE_URL` | Debug builds fall back to `http://10.0.2.2:60080` when missing; a release build fails. |

`local.properties`, `keystore.properties` and `*.jks` are gitignored and never committed. The app
ships no secrets: the SQLCipher key is created on the device (spec item 1).

## Not in this file yet

Backup and restore variables (spec item 20) and cost-alert thresholds (item 22) are documented with
`backup-restore.md` and `cost-alerts.md` in Phase 6.
