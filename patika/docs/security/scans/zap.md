# OWASP ZAP scans

Run on 2026-10-26 with ZAP 2.17.0 (`ghcr.io/zaproxy/zaproxy:stable`, digest `sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6`) against the compose stack built from `feat/patika-p6`, with the API and the Web in `ASPNETCORE_ENVIRONMENT=Staging` (no developer pages, HSTS and the exception handler on) and the `[ÖRNEK]` sample rows shown. **Real vs simulated:** the scans are real, the target is a local Docker stack over plain HTTP; there is no hosted origin, reverse proxy or TLS to scan.

Trimmed reports (5 instances per alert): [`zap/`](zap/).

## Results

| Scan | Target | Requests or URLs | High | Medium | Low | Info | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (spider and passive rules), before the fixes | Web public pages from `/` | 81 URLs | 0 | 1 | 3 | 3 | [web-baseline-before.md](zap/web-baseline-before.md) |
| Baseline, after the fixes | Web public pages from `/` | 81 URLs | 0 | 0 | 1 | 3 | [web-baseline.md](zap/web-baseline.md) |
| Baseline, after the fixes | `/admin/giris` and what the spider reaches from it | 85 URLs | 0 | 0 | 1 | 6 | [admin-baseline.md](zap/admin-baseline.md) |
| API scan (OpenAPI import, active rules), no credentials | `/openapi.json` (78 operations) | 15,909 requests, 15,615 answered 429 | 0 | 0 | 0 | 3 | [api-scan-unauthenticated.md](zap/api-scan-unauthenticated.md) |
| API scan, signed in as a plain user, throttled | 76 operations (see below) | about 20,000 requests, 2,928 answered 429 | 1 (false positive) | 0 | 1 (fixed) | 3 | [api-scan-authenticated.md](zap/api-scan-authenticated.md) |

The unauthenticated API scan proves mainly that the global limit of 300 requests a minute per address holds: almost every attack request was refused before it reached a handler. That is why the scan was repeated with a bearer token, from a container on the compose network (its own address), with `scanner.delayInMs=220` and one thread, which keeps it just under the global limit; it ran 69 minutes. `DELETE /v1/me` and `POST /v1/auth/logout` were removed from the imported document for that run, because the first attempt deleted its own account after 10 seconds (by design, see P6C-07 in the [pentest report](../pentest-report.md)). The per-route limits (sign-in 5 per 15 minutes, TOTP, refresh) still answered 429 where they apply, which is expected.

## Findings and verdicts

| ZAP alert | Where | Verdict |
| --- | --- | --- |
| 10055 CSP: failure to define a directive with no fallback (`form-action`), medium | Web, every page | **Fixed** (550baf6a): `form-action 'self'`; asserted in `NetworkHardeningTests`; gone in the rerun |
| 90004 insufficient site isolation: COOP and CORP missing, low | Web | **Fixed** (550baf6a): `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` `same-origin`; gone in the rerun |
| 90004: COEP missing, low | Web | **Accepted**: `require-corp` would block photos from the media origin unless it sends CORP itself, and no page uses a cross-origin-isolated API |
| 100000 a server error response code, low | API `GET /v1/adoptions?district=%00` | **Fixed** (003306d3): a NUL in a query or route value reached PostgreSQL (`22021 invalid byte sequence`) and came back as a generic 500. The `/v1` filter now answers 400 `validation_failed`; `RequestTextTests.ANulInAQueryValueIsAValidationErrorNotAServerError` (fails with the check removed); live retest: `district=%00` and `cursor=%00` 400, `district=%2500` and `district=Moda` 200, no error lines in the API log. The 500 body itself held only the generic title, `code` and `traceId` |
| 10062 PII disclosure ("credit card number"), high | API `POST /v1/subscriptions/verify` | **False positive**: the 13 digits are a run inside the random W3C `traceId` of a 400 `invalid_purchase` problem; no card data exists anywhere in Patika |
| 10031 user-controllable HTML attribute, info | Web `/sahiplendirme?tur=…`, admin sign-in `Email` | **Accepted**: `tur` is checked against an enum (a `"><script>` value is not reflected at all) and Razor encodes every attribute; the sign-in form re-shows the typed address, encoded |
| 10049 storable and cacheable content, 10050 retrieved from cache, info | Web | **Accepted**: public pages are meant to be cached (5-minute output cache, phase 4); admin pages send `no-store` |
| 10111 authentication request identified, 10112 session management response identified, info | admin sign-in | **Accepted**: informational markers for the sign-in form and the admin cookie |
| 100000 client error response codes, info | API | **Expected**: 400, 401, 403, 404 and 429 for malformed or unauthorized attack requests |

Passed rules worth naming: SQL injection (40018 and the time-based variants), path traversal, remote file inclusion, OS command and server-side template injection, XXE, cookie flags (10010, 10011, 10054), HSTS (10035), anti-clickjacking (10020), X-Content-Type-Options (10021), application and debug error disclosure (90022, 10023), `Server` and `X-Powered-By` leaks (10036, 10037).

## Commands

The Web baseline runs in CI as the `Patika ZAP baseline` job in `.github/workflows/patika-ci.yml`, and locally the same way:

```sh
cd patika
bash ops/ci/zap/zap-baseline.sh     # builds a throwaway compose project, scans / and /admin/giris, removes it
```

It fails on any alert not listed in [`ops/ci/zap/zap-rules.conf`](../../../ops/ci/zap/zap-rules.conf), which holds the accepted ones above with their reasons. Locally it took 89 seconds with warm Docker caches.

The API scan is manual (about 70 minutes with the real rate limits, too long for every pull request). With the compose stack up in Staging, `OpenApi__Enabled=true` on the API and a signed-in test user's access token in `$TOKEN`:

```sh
curl -s http://127.0.0.1:5000/openapi.json -o openapi-scan.json   # then drop DELETE /v1/me and POST /v1/auth/logout
docker run --rm --network patika_default -v "$PWD:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py -t /zap/wrk/openapi-scan.json -f openapi -O http://api:8080 -T 120 \
  -r api-scan.html -w api-scan.md \
  -z "-config scanner.delayInMs=220 -config scanner.threadPerHost=1 \
      -config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true \
      -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization \
      -config replacer.full_list(0).regex=false -config replacer.full_list(0).replacement=Bearer\ $TOKEN"
```

`/openapi.json` is served only in Development or with `OpenApi:Enabled=true` ([env.md](../../ops/env.md)).

## Not exercised

- TLS, HSTS preload and the reverse proxy on a real domain (nothing is hosted).
- An authenticated API scan as a moderator or admin (TOTP sign-in is not scriptable for ZAP here); admin routes answered 403 to the plain user, which is the expected result and is covered by `AdminFlowTests` and `AdminAuthorizationTests`.
- The ZAP API scan in CI.
