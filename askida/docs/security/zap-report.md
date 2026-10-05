# Askıda: OWASP ZAP dynamic scans

| | |
|---|---|
| Status | Baseline scan (public web, passive) and API scan (OpenAPI import, active) run locally on 2026-10-05 against the compose stack `askida-p6scan`, twice each. Result: **0 High**. Medium: the three documented `/admin` CSP relaxations (accepted) and "HTTP only site" on the API (accepted: plain HTTP is a local relaxation); one Medium and two Low alerts were fixed and confirmed absent on the re-run. |
| Tool | ZAP **2.17.0**, Docker image `ghcr.io/zaproxy/zaproxy:stable`, digest `sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef` (the same digest is pinned in `.github/workflows/askida-security.yml`). |
| Configuration | `server/.zap/baseline.conf`, `server/.zap/api-scan.conf` (rule actions: FAIL for regressions, INFO for accepted alerts with the reason), `server/.zap/api-context.xml` (scope; no credential). |
| Reports | HTML and JSON reports are written to `server/.zap/reports/` and are not committed (ignored in `server/.gitignore`). The tables below are taken from those JSON reports. |
| CI | Job `zap` in "Askida Security" on the weekly schedule and on manual runs, informational. GitHub runs are recorded after the push: **not exercised yet**. |

## 1. Target and local relaxations

Stack: `docker compose -p askida-p6scan up -d postgres redis minio minio-init server horizon`
(host ports 55533, 56533, 58533, 59535/59536), database migrated and seeded with the
`[ÖRNEK]` sample data (`php artisan migrate --seed`). ZAP reaches the server as
`http://host.docker.internal:58533`.

The stack differs from production in these points only, each needed to scan it over plain HTTP
on one machine:

| Setting | Scan value | Production | Why |
|---|---|---|---|
| `APP_ENV` | `local` | `production` | Outside `local`/`testing` the boot refuses the fake payment, attestation and push drivers (`PaymentsServiceProvider`, `AnonServiceProvider::guardConfiguration`) and `EnforceHttps` redirects every HTTP request to HTTPS, so a scan over HTTP would only see 301 responses. |
| `APP_DEBUG` | `false` | `false` | Same as production: no debug pages. `Handler` prints details only for `local` with debug on. |
| `SESSION_SECURE_COOKIE` | `false` | `true` (forced outside `local`, cookie name `__Host-askida_session`) | Plain HTTP. |
| HSTS | not sent | sent on HTTPS (`config/secure-headers.php`) | Plain HTTP. |
| `APP_URL` | `http://localhost:58533` | the HTTPS origin | Local port. |
| Fake drivers | `PAYMENT_PROVIDER=fake`, `ATTESTATION_DRIVER=fake`, `PUSH_DRIVER=log` | real providers | No provider accounts (portfolio rules). |
| `BREACHED_PASSWORD_CHECK` | `false` | `true` | Keeps the scan from calling the external range API. |

Two scan-only tunings were applied through an untracked compose override and are not part of
the image: `opcache.validate_timestamps=0` (the Windows bind mount made every request take
12-15 s; with it about 1.3 s) and the nginx configuration of this branch mounted read-only so the
fixes in section 4 were live without rebuilding the shared `askida-server:local` image.

## 2. Commands

```bash
# Baseline: spider (5 minutes) and passive rules over the public web
docker run --rm --add-host=host.docker.internal:host-gateway \
  -v "$PWD/askida/server/.zap:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:58533 -m 5 -I \
  -c baseline.conf -r reports/zap-baseline.html -J reports/zap-baseline.json

# API: import docs/api/openapi.yaml, active scan with the donor token
ZAP_AUTH_HEADER_VALUE="Bearer $(php artisan tinker ... DeviceTokenIssuer ... plainTextToken)"
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e ZAP_AUTH_HEADER_VALUE -e ZAP_AUTH_HEADER=Authorization \
  -e ZAP_AUTH_HEADER_SITE=host.docker.internal \
  -v "$PWD/askida/server/.zap:/zap/wrk:rw" -v "$PWD/askida/docs/api:/zap/api:ro" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py -t /zap/api/openapi.yaml -f openapi -I \
  -O http://host.docker.internal:58533 -n api-context.xml -c api-scan.conf \
  -r reports/zap-api.html -J reports/zap-api.json \
  -z "-config scanner.threadPerHost=4 -config scanner.maxScanDurationInMins=60"
```

The token belongs to the seeded donor `ornek-bagisci@example.test`, is minted at run time with
`App\Domain\Auth\Tokens\DeviceTokenIssuer` (device name `zap-scan`), and reaches ZAP only through
the environment (`-e ZAP_AUTH_HEADER_VALUE` without a value on the command line). It is never
written to a file, a context or a report header in the repository. `api-context.xml` excludes
`/api/v1/auth/logout`, which would revoke the token during the run.

## 3. Results

### 3.1 Baseline (public web)

Run 1 is the Phase 6 base; run 2 is after the fixes in section 4, with `baseline.conf`.
ZAP visited 41 URLs in run 1 and 43 in run 2. Summary line of run 2:
`FAIL-NEW: 0 FAIL-INPROG: 0 WARN-NEW: 3 WARN-INPROG: 0 INFO: 3 IGNORE: 0 PASS: 61`.

| Alert (rule) | Risk | Run 1 | Run 2 | Where | Assessment |
|---|---|---|---|---|---|
| CSP: script-src unsafe-eval (10055) | Medium | 1 | 1 | `/admin` | **Accepted.** The `admin` CSP profile (`config/secure-headers.php`) allows `unsafe-eval` because Alpine.js inside Livewire/Filament 3 evaluates expressions with the Function constructor. The panel is behind the IP allowlist, TOTP and its own `SameSite=Strict` session; the public web keeps the strict nonce policy. |
| CSP: script-src unsafe-inline (10055) | Medium | 1 | 1 | `/admin` | **Accepted**, same profile: Filament prints inline scripts without a nonce. |
| CSP: style-src unsafe-inline (10055) | Medium | 1 | 1 | `/admin` | **Accepted**, same profile: inline styles of the panel. |
| Content Security Policy header not set (10038) | Medium | 1 | 0 | `/og/` (403) | **Fixed.** nginx answered the directory path itself (`try_files $uri $uri/`), without the headers Laravel adds. Now every non-file path reaches Laravel (404 with CSP). `baseline.conf`: FAIL. |
| Permissions-Policy header not set (10063) | Low | 1 | 0 | `/og/` (403) | **Fixed**, same change. `baseline.conf`: FAIL. |
| Cross-Origin-Resource-Policy missing or invalid (90004) | Low | 5 | 0 | static `css`, `woff2`, `svg` (header missing); `/`, `/robots.txt` (`same-site`) | **Fixed.** nginx now sends `Cross-Origin-Resource-Policy: same-origin` on static files, and the application value moved from `same-site` to `same-origin` (no other `askida.app` subdomain loads these responses). |
| Cross-Origin-Embedder-Policy missing (90004) | Low | 3 | 5 | public pages, `/sitemap.xml` | **Accepted.** `require-corp` would block the payment provider's checkout frame on `/pay/*`, whose responses we do not control; no page needs cross-origin isolation (no `SharedArrayBuffer`). The count differs only because run 2 visited more pages. |
| Cookie no HttpOnly flag (10010) | Low | 5 | 5 | every page (`XSRF-TOKEN`) | **Accepted.** `XSRF-TOKEN` is Laravel's CSRF cookie, readable by design so scripts can echo it in a header; it is not a session credential and is useless without the HttpOnly session cookie. The session cookie is HttpOnly (`config/session.php`). See section 6. |
| Big redirect detected (10044) | Low | 1 | 1 | `/admin` (302) | **False positive.** The body is the framework's standard redirect page naming the same login URL as the `Location` header; no other content. |
| Non-storable content (10049) | Info | 5 | 5 | pages with `Cache-Control: private`, the 404 of `/og/` | Informational: personalised or session pages are not cacheable by shared caches, as intended. |
| Storable and cacheable content (10049) | Info | 3 | 3 | versioned static files | Informational: `max-age=31536000, immutable` on fingerprinted files, as intended. |
| Session management response identified (10112) | Info | 11 | 12 | public pages | Informational: the `web` middleware group starts a session on every page (see section 6). |

### 3.2 API scan

38 URLs imported from `docs/api/openapi.yaml`. Requests reached the authenticated routes with the
donor token (for example `GET /api/v1/donations` and `PATCH /api/v1/me` answered 200), so the
scan was not limited to the public endpoints.

| | Run 1 (`-g`, no rule file) | Run 2 (`-c api-scan.conf`) |
|---|---|---|
| Wall clock | 13 minutes (01:03-01:16 UTC) | 61 minutes (01:19-02:20 UTC) |
| Requests seen in the nginx log | about 8 400 | about 11 600 |
| 5xx responses | 0 | 0 |
| Summary line | `FAIL-NEW: 0 ... WARN-NEW: 1 ... INFO: 0 ... PASS: 118` | `FAIL-NEW: 0 ... WARN-NEW: 1 ... INFO: 1 ... PASS: 117` |

Run 1 ran with the Laravel configuration cached and finished well inside the 60-minute
active-scan cap. Before run 2 the configuration cache was cleared (the test suite must not run
against a cached configuration), every request became slower, and the run took 61 minutes: it
reached the cap, so **run 2 may have been cut short by `scanner.maxScanDurationInMins=60`** (the
ZAP output does not say whether the cap fired). Run 1 is the complete pass; run 2 confirms the rule
file and adds the two alerts below.

| Alert (rule) | Risk | Run 1 | Run 2 | Where | Assessment |
|---|---|---|---|---|---|
| HTTP only site (10106) | Medium | 0 | 1 | `POST /api/v1/anon/attest` | **Accepted (local relaxation).** The scan stack is plain HTTP by design (section 1). In production `EnforceHttps` answers API calls over HTTP with 403 `https_required` and the edge proxy redirects port 80. `api-scan.conf`: INFO. |
| Unexpected Content-Type was returned (100001) | Low | 2 | 51 | the site root and its CSS and fonts; `/api/v1/shops/...` and `/api/v1/donations/...` with a null byte or dot segments above the root | **False positive.** Non-JSON answers come from the public web root and its static files (the context covers the whole host so the active scan can start at the root), and from nginx's own 400 page for malformed paths (`%00`, `..%2F` above the document root), which never reach Laravel. No API handler answered HTML. `api-scan.conf`: INFO. |
| A client error response code was returned (100000) | Info | 1 238 | 1 595 | API routes | Informational: mostly 404 (unknown ids and fuzzed path segments), then 400 (nginx, malformed paths), 405, 422, 429, 401. |
| Authentication request identified (10111) | Info | 2 | 2 | `POST /api/v1/auth/login`, `/auth/reset` | Informational. |
| Session management response identified (10112) | Info | 2 | 1 | `POST /api/v1/auth/login` (token in the body) | Informational. |
| Non-storable content (10049) | Info | 5 | 5 | auth responses (`no-store`) | Informational, as intended. |

Not raised in either run (PASS): SQL injection (generic and PostgreSQL time based), reflected and
persistent XSS, path traversal, remote file inclusion, CRLF injection, server side include and
code injection, remote OS command injection, XXE, XSLT injection, Shell Shock, CVE-2012-1823,
application error disclosure, debug error messages. These are FAIL in `api-scan.conf`, so a
future run that raises one of them fails that step.

Coverage limits, stated plainly: of about 8 400 requests in run 1, 2 677 were answered 429 by the
rate limiters and 2 446 were 404 (path ids taken from the OpenAPI examples do not exist in the
seeded data); run 2 shows the same pattern (3 326 answered 429, 3 316 answered 404). The active
rules therefore reached the handlers of a subset of the operations. The
rate-limited and id-based paths are covered by the attack suite (`docs/security/attack-report.md`,
IDOR, brute force and amount tampering tests) rather than by ZAP.

## 4. Changes made because of the scans

| File | Before | After |
|---|---|---|
| `docker/nginx/default.conf` (`location /`) | `try_files $uri $uri/ /index.php?$query_string;` (a directory such as `/og/` got nginx's own 403 without security headers) | `try_files $uri /index.php?$query_string;` (every non-file path reaches Laravel) |
| `docker/nginx/default.conf` (static files) | no `Cross-Origin-Resource-Policy` | `Cross-Origin-Resource-Policy: same-origin` |
| `config/secure-headers.php` | `cross-origin-resource-policy => same-site` | `same-origin` (COEP stays off, reason in the file) |
| `docker/nginx/default.conf` (access log) | nginx `combined` format: client address, full request line with the query string (the nearby-shops request carries `near=<lat>,<lng>`), referrer, browser string | `askida_private` format: time, method, path without the query string, protocol, status, bytes, duration; `/pay/<token>` logged as `/pay/-` |

The access log change came from the privacy-label review (the release documentation says the
location is not logged). Check, run on this stack after the change:

```bash
curl -s "http://127.0.0.1:58533/api/v1/shops?near=41.0123,28.9765"
curl -s "http://127.0.0.1:58533/pay/abcdefghijklmnop0123?x=1"
curl -s "http://127.0.0.1:58533/dukkanlar/istanbul?near=41.0123,28.9765"
docker logs --since "$since" askida-p6scan-server-1 2>&1 \
  | grep -cE "41\.0123|28\.9765|abcdefghijklmnop0123|172\.|192\.168\.|10\.85\."
# -> 0
```

Logged lines for those requests:

```text
2026-10-05T00:54:27+00:00 "GET /api/v1/shops HTTP/1.1" 401 207 2.184
2026-10-05T00:54:29+00:00 "GET /pay/- HTTP/1.1" 404 1041 2.516
2026-10-05T00:54:34+00:00 "GET /dukkanlar/istanbul HTTP/1.1" 200 6206 5.069
```

The PHP-FPM access log of the image (`/proc/self/fd/2`, format `%R - %u %t "%m %r" %s`) logs
`127.0.0.1` (nginx in the same container) and the script name `/index.php`, without the query
string. Residual: nginx error log lines (`error_log`, level `error`) quote the client address and
the request line when nginx itself fails a request (for example an upstream timeout); their
format cannot be changed. They are written only on failures and follow the host's log
rotation.

## 5. Rule configuration files

- `server/.zap/baseline.conf`: rules 10020, 10021, 10023, 10036, 10037, 10038, 10063 and 90022 are
  FAIL (fixed or never present, must stay absent); 10010, 10044 and 10055 are INFO with the
  reasons above; every other rule WARN.
- `server/.zap/api-scan.conf`: the injection, traversal, inclusion and disclosure rules listed in
  3.2 plus 10021, 10023, 10038, 90022 are FAIL; 100001 and 10106 are INFO; every other rule WARN.
  The INFO line for 10106 and the wider 100001 message were added after run 2 and have not been
  through a third run (they change only how an alert is reported, not what is scanned).
- `-I` keeps WARN alerts from failing the run; FAIL alerts still fail it.

## 6. Not exercised and open points

- HTTPS-only behaviour (HSTS, `__Host-` cookie, `Secure` flag, HTTPS redirect): not exercised by
  ZAP (no TLS endpoint locally); covered by feature tests of `EnforceHttps` and the session
  configuration (`tests/Feature/Security/HeadersHttpsTest.php`, `tests/Feature/Security/CookiesTest.php`).
- Production-like `APP_ENV`: not exercised (section 1).
- Authenticated scan of the Filament panel: not exercised (TOTP and the IP allowlist; the panel is
  covered by the Filament exposure tests of the attack suite).
- Merchant and anonymous tokens: the API scan used the donor token only.
- GitHub `zap` job: not exercised until the workflow runs after the push.
- Open point for the web owner: every public page starts a session and sets `XSRF-TOKEN` (10010,
  10112), including `robots.txt` and `sitemap.xml`. Serving the read-only public pages without a
  session would remove both cookies for visitors; it touches the route middleware, which is
  outside this scan's file set.
