# Inecek Var: OWASP ZAP scans (web SSR, PWA, API)

| | |
| --- | --- |
| Spec item | 23 (dynamic part: ZAP baseline on web and PWA, API scan from `openapi.json`); items 9 and 10 (headers and https behaviour seen from outside). |
| Status | Three local runs on 2026-10-13 against the compose stack over https. Run 1 (every rule WARN) raised 5 alert types; run 2 (triaged rules, API header fix) raised one new defect, a 500 on NUL characters, fixed before run 3. Run 3: **0 FAIL and 0 WARN** on all three scans; the accepted alerts are INFO with their reasons in the rule files. |
| Tool | ZAP **2.17.0**, image `ghcr.io/zaproxy/zaproxy:stable@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef` (pinned in `ops/security/zap/run-zap.sh`). |
| Configuration | `ops/security/zap/run-zap.sh` (procedure, sign-in of the scan account), `baseline.conf` and `api-scan.conf` (every FAIL and INFO line carries its reason), `api-context.xml` (scope and the excluded session-ending routes, no credential). |
| Reports | `docs/security/scan-reports/zap/` (HTML, JSON, Markdown), ignored by git. The counts below are the console summary lines and the JSON of each run. |
| Decisions | ADR-0055. |

## 1. Target

Compose project `iv6b` (PostGIS, Redis, MinIO, Mailpit, Caddy with `ops/Caddyfile`), the API from this branch under uvicorn on 127.0.0.1:57850 with `INECEKVAR_REQUIRE_HTTPS=true` and `--no-proxy-headers`, the SSR server (`dist/apps/web/server/server.mjs`, `INECEKVAR_ENV=production`, canonical origin `https://host.docker.internal:58443`) on 127.0.0.1:4200, and the PWA production build served by Caddy. ZAP runs in Docker and reaches the Caddy sites as `https://host.docker.internal:{58443,58444,58445}` (web, PWA, API site); certificates come from Caddy's local CA.

Differences from production:

| Setting | Scan | Production | Why |
| --- | --- | --- | --- |
| Certificates | Caddy local CA (`local_certs`) | public CA (automatic TLS) | no public host |
| API environment | `local` with `INECEKVAR_REQUIRE_HTTPS=true` | `production` (https enforced by default) | local mail and storage stand-ins |
| Canonical web origin | `https://host.docker.internal:58443` | `https://inecekvar.app` | the SSR server redirects every other host to the canonical one |
| Upload origin in the PWA CSP | `http://127.0.0.1:57953` (MinIO) | the R2 endpoint of the media bucket | `INECEKVAR_PWA_UPLOAD_ORIGIN` |

Authentication of the API scan: a throw-away account registered in bearer mode, the sign-in link read from Mailpit, `POST /v1/auth/magic-link/verify`; the access token reached ZAP only through `-e ZAP_AUTH_HEADER_VALUE`. Authenticated routes answered 2xx during the scan (`GET /v1/me/totp` 200, `POST /v1/me/totp/enrol` 201, `POST /v1/me/licence-accept`). The active scan was capped at 12 minutes because the access token lives 15; it ended earlier in every run.

## 2. Commands

```bash
cd inecekvar
IV_E2E_STACK=iv6b node apps/web-e2e/scripts/real-stack.mjs up     # databases, migrations, seed
INECEKVAR_API_UPSTREAM=host.docker.internal:57850 INECEKVAR_PWA_UPLOAD_ORIGIN=http://127.0.0.1:57953 \
  INECEKVAR_PG_PORT=57951 INECEKVAR_REDIS_PORT=57952 INECEKVAR_MINIO_PORT=57953 \
  INECEKVAR_MINIO_CONSOLE_PORT=57954 INECEKVAR_MAIL_SMTP_PORT=57955 INECEKVAR_MAIL_UI_PORT=57956 \
  docker compose -p iv6b up -d --wait caddy
# API (iv6b environment of apps/web-e2e/stack-env.mjs plus INECEKVAR_REQUIRE_HTTPS=true):
(cd api && uv run uvicorn app.main:app --host 127.0.0.1 --port 57850 --no-proxy-headers)
# SSR server: PORT=4200 INECEKVAR_ENV=production IV_WEB_ALLOWED_HOSTS=host.docker.internal
#   IV_WEB_CANONICAL_ORIGIN=https://host.docker.internal:58443 IV_WEB_API_INTERNAL_URL=http://127.0.0.1:57957/v1
node dist/apps/web/server/server.mjs
IV_ZAP_MAIL=http://127.0.0.1:57956 IV_ZAP_GENERATE=1 bash ops/security/zap/run-zap.sh all   # run 1
IV_ZAP_MAIL=http://127.0.0.1:57956 bash ops/security/zap/run-zap.sh all                     # runs 2, 3
```

## 3. Results

Summary lines (`FAIL-NEW / WARN-NEW / INFO / PASS`) and URLs in the site tree:

| Scan | Run 1 (all WARN) | Run 2 (rule files, CORP fix) | Run 3 (NUL fix) |
| --- | --- | --- | --- |
| Web SSR baseline | 0 / 2 / 0 / 64, 100 URLs | 0 / 3 / 2 / 62, 100 URLs | **0 / 0 / 5 / 62**, 100 URLs |
| PWA baseline | 0 / 2 / 0 / 64, 10 URLs | 0 / 3 / 2 / 62, 10 URLs | **0 / 0 / 5 / 62**, 10 URLs |
| API scan (62 operations imported) | 0 / 1 / 0 / 117, 98 URLs | 0 / 1 / 0 / 118, 251 URLs | **0 / 0 / 0 / 118**, 251 URLs |
| 5xx answers in the API scan | 0 | 3 | 0 |
| ZAP exit status | 0, 0, 0 (`-I`) | 0, 0, 0 | 0, 0, 0 |

The WARN count rises from run 1 to run 2 on the baselines because the rule files list the informational cache and framework rules, which the default run leaves out of the summary; run 3 records them as INFO with reasons. Run 1 of the API scan built a smaller tree (98 URLs against 251), which is why the NUL payload reached the slug routes only in run 2.

| Alert (rule) | Risk | Run 1 | Run 3 | Where | Disposition |
| --- | --- | --- | --- | --- | --- |
| Cross-Origin-Resource-Policy missing or invalid (90004-1) | Low | 5 (API, `same-site`) | 0 | every API answer | **Fixed**: `Cross-Origin-Resource-Policy: same-origin` (`app/core/headers.py`), pinned by `tests/core/test_headers.py::test_api_isolation_headers_are_pinned`; rule 90004 is FAIL in `api-scan.conf`. |
| A Server Error response code was returned (100000) | Low | 0 | 0 (run 2: 3) | `GET /v1/lines/{slug}`, `/v1/lines/{slug}/versions`, `/v1/stops/{slug}` with `city=` holding `%00` | **Fixed**: PostgreSQL refused the NUL (SQLSTATE 22021) and the error boundary answered 500 without detail. `app/core/url_guard.py` refuses a NUL in the path or query with 422 `validation.failed` before routing; `tests/security/test_attack_suite.py::test_nul_in_path_or_query_is_refused_not_a_server_error` (10 targets) was red (`assert 500 == 422`) without the guard. |
| CSP: style-src unsafe-inline (10055) | Medium | 1 (PWA) | 1, INFO | PWA shell | **Accepted**: styles only. Angular and Ionic insert style elements at run time and the build inlines critical CSS; scripts are hash-only and `mobile:csp-check` plus `csp.spec.ts` fail on any script relaxation. |
| Cross-Origin-Embedder-Policy missing (90004-2) | Low | 16 web, 1 PWA | 5 web, 1 PWA, INFO | HTML pages | **Accepted**: no cross-origin isolation is needed (no shared memory), and tile images do not opt in (ADR-0038). COOP and CORP are sent. |
| Timestamp Disclosure - Unix (10096) | Low | 13 | 5, INFO | `chunk-*.js` of the SSR build | **False positive**: numeric constants in minified library code. |
| Re-examine Cache-control (10015), Content cacheability (10049), Modern Web Application (10109) | Informational | not summarised | INFO | web, PWA, API | **Accepted**: the deliberate cache policy (API `no-store`, HTML `private, no-cache` or `no-cache`, hashed bundles immutable) and the nature of an Angular app. |

Checks that passed and are FAIL rules now (they must stay absent): HSTS (10035), CSP present (10038), anti-clickjacking (10020), nosniff (10021), Server and X-Powered-By leaks (10036, 10037), Permissions-Policy (10063), mixed content (10040), cookie flags (10010, 10011, 10054); on the API also HTTPS content available via HTTP (10047) and HTTP-only site (10106), reflected and persistent XSS (40012, 40014), SQL injection (40018, 40022), CRLF (40003), path traversal (6), remote file inclusion (7), command and code injection (90019, 90020), XXE (90023), SSTI (90035), application error disclosure (90022).

## 4. Not exercised

- A hosted target with public certificates, CDN and the real `api.inecekvar.app` host; the HSTS preload list.
- The ZAP job in CI (no workflow change in this package; the script supports `IV_ZAP_HOST_NETWORK=1` for Linux engines as the Cetele job needed).
- An AJAX spider on the PWA (`-j`): the baseline spider sees 10 URLs of the static shell; the app's routes were exercised by the Playwright suite under the same CSP instead (`apps/mobile-e2e`, ADR-0055).
- Authenticated moderator and admin roles in the API scan: the scan account is a plain user, so moderation and admin routes answered 403 (their role and step-up rules are covered by `tests/security/test_admin_routes.py`).
