# Release checklist

Status: procedure; **no release has been made**. There is no production host, domain, store
account or signing key (ADR-0005), so every step that needs one is marked `not exercised`.
Commands run from `inecekvar/` unless a directory is named. Env keys are documented in
`docs/ops/env.md` (web keys also in ADR-0038 item 1 and ADR-0039 item 13; Caddy keys in
`ops/Caddyfile`); `node ops/release/check-release-docs.mjs` checks that every key named here is
documented.

## 1. Gaps that block a production release today

Recorded honestly so nobody assumes they exist:

| #   | Gap                                                                                                                                                                                                                                                                                         | Owner        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| G1  | No Dockerfile for the API, the worker or the SSR web server exists in the repository (`docker-compose.yml` runs only the backing services and Caddy; the API and web run on the host). Specification section 12 asks for Docker images.                                                     | lead         |
| G2  | No production Caddy configuration: `ops/Caddyfile` is the local one (`local_certs`, 127.0.0.1, host ports). Production needs the same snippets with public TLS for `inecekvar.app`, `app.inecekvar.app`, `api.inecekvar.app` (ADR-0055) and the admin-origin decision of `docs/ops/env.md`. | lead         |
| G3  | No tool creates a real city: the only city writer is the sample seed, which refuses production. A first city needs an operator SQL insert or a new admin route.                                                                                                                             | api          |
| G4  | No tool promotes the first admin: `PATCH admin/users/{id}/role` needs an existing admin. The first one needs an operator SQL update (`users.role = 'admin'`), then TOTP enrolment in the admin UI.                                                                                          | api          |
| G5  | `environment.ts` has no per-build replacement, so the RevenueCat **public** SDK key of a store build has to be written into the file in the release workspace (it is public; the file must still not be committed with a value unless the owner decides so).                                | mobile       |
| G6  | The PWA host serves no `/.well-known/assetlinks.json`, so app links on `app.inecekvar.app` (magic links) stay unverified (`signing.md` section 2.1).                                                                                                                                        | lead, mobile |
| G7  | No iOS platform (`signing.md` section 3).                                                                                                                                                                                                                                                   | mobile       |
| G8  | Store listing blockers: title over 30 characters (owner decision), sample-data screenshots with a 2.22 ratio, no support contact, no web deletion path (`store-listing.tr.md`, `privacy-labels.md` M5).                                                                                     | owner        |

## 2. Versions

| What                                                | Where                                            | Rule                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Android `versionCode`                               | `apps/mobile/android/app/build.gradle` (now `1`) | +1 for every upload to Play, never reused                                                                                   |
| Android `versionName`                               | same file (now `"1.0"`)                          | the user-visible version, `MAJOR.MINOR.PATCH`                                                                               |
| iOS `CFBundleShortVersionString`, `CFBundleVersion` | `Info.plist` once the platform exists            | same as Android name; build number +1 per upload                                                                            |
| Workspace                                           | `package.json` `version` (now `0.1.0`)           | set to the release version in the same commit                                                                               |
| PWA                                                 | Angular service worker (`ngsw-config.json`)      | every deploy is a new app version; clients update on the next start                                                         |
| API contract                                        | `docs/api/openapi.json` + `libs/domain`          | `INECEKVAR_ENV=local uv run python -m app.contract` (in `api/`) then `node libs/domain/scripts/build-api-types.mjs --check` |

## 3. Pre-release gates (run, record output)

```sh
pnpm install --frozen-lockfile
pnpm nx run-many -t lint test build
pnpm nx run mobile:csp-check              # PWA CSP hash equals ops/Caddyfile
pnpm nx run mobile:android-config-check   # no cleartext, no backup
node ops/release/check-release-docs.mjs
cd api && uv sync --locked && uv run ruff check . && uv run mypy --strict app && INECEKVAR_REQUIRE_DOCKER=1 uv run pytest -q
```

Plus the CI gates on the release commit: "Inecek Var CI gate" and "Inecek Var Security" green
(audits, osv-scanner, bandit, semgrep, gitleaks full history).

## 4. Builds

| Artefact       | Command                                                                                                                                    | Output                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| PWA            | `pnpm nx build mobile` (production is the default configuration)                                                                           | `dist/apps/mobile/browser`                                                        |
| Web SSR        | `pnpm nx build web`                                                                                                                        | `dist/apps/web` (start with `node dist/apps/web/server/server.mjs`)               |
| Android bundle | `pnpm nx run mobile:cap-sync`, then in `apps/mobile/android`: `./gradlew bundleRelease` with JDK 21 and the signing wiring of `signing.md` | `app/build/outputs/bundle/release/app-release.aab` (not exercised: no upload key) |
| iOS            | not possible (G7)                                                                                                                          |                                                                                   |

Before the Android build of a store release: put the RevenueCat public key into
`apps/mobile/src/environments/environment.ts` in the release workspace (G5); without it the app
offers no purchase (`plus/purchases.ts`).

## 5. Production environment

Every secret comes from the process environment of its service, never from a file in the
repository. Values are not listed here.

### 5.1 API and worker (`api/app/core/settings.py`)

Required in production (start-up fails without them):

- `INECEKVAR_ENV` = `production`
- `INECEKVAR_DATABASE_URL`, `INECEKVAR_REDIS_URL`
- `INECEKVAR_JWT_PRIVATE_KEY_PEM` or `INECEKVAR_JWT_PRIVATE_KEY_PATH`; `INECEKVAR_JWT_PUBLIC_KEY_PEM` or `INECEKVAR_JWT_PUBLIC_KEY_PATH`
- `INECEKVAR_CSRF_SECRET`, `INECEKVAR_LOG_HASH_KEY` (at least 32 characters each)
- `INECEKVAR_TOTP_ENCRYPTION_KEY`
- `INECEKVAR_SMTP_USE_TLS` = `true` (production refuses `false`)

HTTPS and proxy (ADR-0055), required for a working deployment:

- `INECEKVAR_TRUSTED_PROXY_CIDRS`: the address of the reverse proxy only. The API trusts
  `X-Real-IP` and the forwarded-proto header only from these peers.
- `INECEKVAR_REQUIRE_HTTPS`: leave unset (enforced in production) or `true`; `false` is refused.
  A request the proxy does not mark https answers 403 `transport.https_required`.
- `INECEKVAR_FORWARDED_PROTO_HEADER` (default `X-Forwarded-Proto`) and `INECEKVAR_CLIENT_IP_HEADER`
  (default `X-Real-IP`) must match what the proxy sets; the proxy must overwrite any client value
  (Caddy without `trusted_proxies` does).
- Run uvicorn with `--no-proxy-headers` so only these settings decide what is trusted.

Needed for the features to work (each fails closed when missing):

- Mail: `INECEKVAR_SMTP_HOST`, `INECEKVAR_SMTP_PORT`, `INECEKVAR_SMTP_USERNAME`,
  `INECEKVAR_SMTP_PASSWORD`, `INECEKVAR_MAIL_FROM`, `INECEKVAR_MAGIC_LINK_BASE_URL`
- Object storage: `INECEKVAR_S3_ENDPOINT_URL`, `INECEKVAR_S3_REGION`, `INECEKVAR_S3_ACCESS_KEY_ID`,
  `INECEKVAR_S3_SECRET_ACCESS_KEY`, `INECEKVAR_MEDIA_BUCKET`, `INECEKVAR_EXPORTS_BUCKET`
- Tiles: `INECEKVAR_PMTILES_BASE_URL` (https; `pmtiles-recipe.md`)
- Billing and webhooks: `INECEKVAR_REVENUECAT_WEBHOOK_SECRET`, `INECEKVAR_REVENUECAT_API_KEY`,
  `INECEKVAR_REVENUECAT_PLUS_ENTITLEMENT`, `INECEKVAR_REVENUECAT_PLUS_PRODUCT_IDS`,
  `INECEKVAR_REVENUECAT_ALLOW_SANDBOX` = `false`, `INECEKVAR_RESEND_WEBHOOK_SECRET`
- Backup check (worker): `INECEKVAR_BACKUP_VERIFY_ENDPOINT_URL`,
  `INECEKVAR_BACKUP_VERIFY_ACCESS_KEY_ID`, `INECEKVAR_BACKUP_VERIFY_SECRET_ACCESS_KEY`,
  `INECEKVAR_BACKUP_VERIFY_BUCKET`
- Optional: `INECEKVAR_SENTRY_DSN` (needs the SDK package too, ADR-0054)

### 5.2 Web SSR server (`apps/web/src/server/config.ts`)

`INECEKVAR_ENV` (unset means production), `HOST`, `PORT`, `IV_WEB_CANONICAL_ORIGIN`,
`IV_WEB_ALLOWED_HOSTS`, `IV_WEB_API_PUBLIC_ORIGIN`, `IV_WEB_API_INTERNAL_URL`,
`IV_WEB_TILES_ORIGIN`, `IV_WEB_APP_ORIGIN`, and for app association `IV_WEB_ANDROID_CERT_SHA256`,
`IV_WEB_IOS_TEAM_ID`, `IV_WEB_IOS_APP_ID` (`signing.md`).

### 5.3 Reverse proxy (`ops/Caddyfile` snippets)

`INECEKVAR_API_UPSTREAM`, `INECEKVAR_WEB_UPSTREAM`, `INECEKVAR_PWA_API_ORIGIN`,
`INECEKVAR_PWA_TILES_ORIGIN`, `INECEKVAR_PWA_UPLOAD_ORIGIN` (narrowed to the media bucket's
account endpoint).

### 5.4 Backup host (`ops/backup/`, `/etc/inecekvar/backup.env` mode 0600)

`INECEKVAR_BACKUP_AGE_RECIPIENT`, `INECEKVAR_BACKUP_S3_ENDPOINT`, `INECEKVAR_BACKUP_S3_BUCKET`,
`INECEKVAR_BACKUP_S3_WRITE_ACCESS_KEY`, `INECEKVAR_BACKUP_S3_WRITE_SECRET_KEY`; the read-only
restore identity and the age identity stay offline (`docs/ops/backup-restore.md`).

## 6. Database migrations

Order for every release that carries a migration (`api/alembic/versions/`, now `0001` to `0005`):

1. Take a fresh backup: `ops/backup/backup.sh` (and confirm `backup.verify` is `ok`).
2. Stop the worker (jobs must not run against a half-migrated schema).
3. In `api/`: `uv run alembic upgrade head` with the production `INECEKVAR_DATABASE_URL`.
4. Start the new API, then the worker.
5. Rollback path: restore the dump of step 1 with `docs/ops/backup-restore.md` (including the
   deletion replay, ADR-0053); no down-migration is relied on.

## 7. First run and seed rules

- **Never seed the sample city in production.** `python -m app.seed` creates `[ÖRNEK] Test Şehri`
  (`is_sample = true`) and refuses to run when `INECEKVAR_ENV=production`
  (`app/seed/__main__.py`). Do not work around it by running it with another env value against the
  production database.
- No real line data is ever imported from outside; lines come from contributors and moderators
  (specification section 0.4).
- First admin and first city: G3 and G4. Record both operator actions in an audit note.

## 8. Deploy

| Part         | Steps                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API          | in `api/`: `uv sync --locked --no-dev`, migrations (section 6), `uv run uvicorn app.main:app --host 127.0.0.1 --port 57800 --no-proxy-headers` behind the proxy (port as in `ops/Caddyfile`); a container image once G1 is closed     |
| Worker       | `uv run arq app.workers.main.WorkerSettings` (one process; cron in Europe/Istanbul, `docs/ops/background-jobs.md`)                                                                                                                    |
| Web          | `node dist/apps/web/server/server.mjs` with section 5.2; `/healthz` for probes                                                                                                                                                        |
| PWA          | copy `dist/apps/mobile/browser` to the static root of the `app.inecekvar.app` site; serve with the `(pwa_headers)` and `(pwa_static)` snippets so the CSP hash and caching rules apply; run `mobile:csp-check` against the same build |
| Proxy        | Caddy with automatic public TLS for the three hosts, `/api/*` proxied on both browser origins, plain http answered with a redirect (G2)                                                                                               |
| Backups      | cron for `ops/backup/backup.sh` on the backup host; weekly `inecekvar-restore-drill.yml` stays on                                                                                                                                     |
| HSTS preload | submit `inecekvar.app` only after every subdomain serves https (the header already carries `preload`)                                                                                                                                 |

## 9. Smoke tests after deploy

| Check                                                                            | Expected                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `curl -sI http://inecekvar.app/`                                                 | redirect to https                                                               |
| `curl -s https://api.inecekvar.app/v1/health`                                    | 200, no details                                                                 |
| API over plain http from outside the proxy                                       | 403 `transport.https_required`                                                  |
| `curl -sI https://app.inecekvar.app/`                                            | the CSP of `(pwa_headers)`, HSTS, `X-Frame-Options: DENY`                       |
| `curl -sI -H "Origin: https://evil.example" https://api.inecekvar.app/v1/cities` | no CORS headers                                                                 |
| `https://inecekvar.app/sitemap.xml`, `/robots.txt`, `/llms.txt`                  | 200                                                                             |
| `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association`        | 200 once the fingerprint and team id are set, else 404                          |
| Registration and magic link                                                      | mail arrives over the production SMTP relay                                     |
| `GET /v1/cities/{slug}/tiles.pmtiles`                                            | 302 to the tiles host; the archive answers range requests (`pmtiles-recipe.md`) |
| RevenueCat and Resend dashboard test events                                      | 200                                                                             |
| Worker log                                                                       | `backup.verify` `ok`, no `cost.guard.alert`                                     |
| Store build on a device                                                          | sign-in, nearby, offline pack, ride recording, account deletion                 |
