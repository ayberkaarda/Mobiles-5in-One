# Cetele: OWASP ZAP API scan

| | |
|---|---|
| Spec item | 23 (dynamic part). |
| Status | Two local runs of the API scan against the compose stack on 2026-10-11. Run 1 found one defect (a 500, fixed, section 4); run 2 on the rebuilt image raised **0 FAIL**, **1 WARN** (open, section 3) and **2 INFO** (accepted, reasons in the rule file). |
| Tool | ZAP **2.17.0**, image `ghcr.io/zaproxy/zaproxy:stable@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef` (pinned in `ops/zap/run-zap.sh`). |
| Input | `docs/api/openapi.json` (35 operations imported), host overridden to the scan stack with `-O`. |
| Configuration | `ops/zap/api-scan.conf` (rule actions, every non-WARN line has its reason), `ops/zap/api-context.xml` (scope, no credential), `ops/zap/docker-compose.zap.yml` (image tag and OTP local echo), `ops/zap/run-zap.sh` (the whole procedure). |
| Reports | `docs/security/scan-reports/zap/` (HTML, JSON, Markdown) is git-ignored; CI uploads it as the artifact `cetele-zap-reports`. The numbers below come from the JSON and the console summary of the runs. |
| CI | Job `zap` of `.github/workflows/cetele-security.yml`, informational (schedule, manual run, push to main). GitHub runs: **not exercised yet** (nothing pushed from this worktree). |

## 1. Target

Stack: compose project `cetele-p6zap` (postgres 16.15, minio, `minio-init`, `server`), server image built from this branch with `./gradlew --offline jibDockerBuild -Djib.to.image=cetele-server:p6zap`, profile `local`, host port 61080 (other host ports shifted to the 61000 block through the `CETELE_*` port keys because another stack held 60432). ZAP reaches it as `http://host.docker.internal:61080`.

Differences from production, each needed to scan one machine over plain HTTP:

| Setting | Scan | Production | Why |
|---|---|---|---|
| Profile | `local` | not `local` | The fake integrity verifier, fake SMS gateway and OTP local echo are accepted only in `local` and `test`. |
| `CETELE_OTP_LOCAL_ECHO` | `true` (override file) | refused outside `local`/`test` | The script reads the sign-in code from the server log. |
| Transport | plain HTTP | HTTPS only (ADR-0010) | One machine, no certificate. |
| Secrets | empty keys, random per start | from the secret store | `docs/ops/env.md`. |

The token is minted by the real sign-in flow (`POST /v1/auth/otp/request` with the fake integrity token, code read from the log, `POST /v1/auth/otp/verify`), passed to ZAP only through the environment (`-e ZAP_AUTH_HEADER_VALUE`, no value on the command line) and never written to a file. The scan user is a throw-away phone number of the scan stack.

## 2. Commands

```bash
# server image from this branch (JDK 21), then the whole scan
cd cetele/server && ./gradlew --offline jibDockerBuild -Djib.to.image=cetele-server:p6zap
cd .. && CETELE_ZAP_SERVER_IMAGE=cetele-server:p6zap ops/zap/run-zap.sh
# what the script runs for ZAP
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e ZAP_AUTH_HEADER_VALUE -e ZAP_AUTH_HEADER=Authorization -e ZAP_AUTH_HEADER_SITE=host.docker.internal \
  -v <work>:/zap/wrk:rw -v cetele/docs/api:/zap/api:ro <image> \
  zap-api-scan.py -t /zap/api/openapi.json -f openapi -I -O http://host.docker.internal:<port> \
  -n api-context.xml -c api-scan.conf -r reports/zap-api.html -J reports/zap-api.json -w reports/zap-api.md \
  -z "-config scanner.threadPerHost=4 -config scanner.maxScanDurationInMins=30"
```

`CETELE_ZAP_FAIL=1` drops `-I` so that FAIL and WARN findings exit non-zero.

## 3. Results

| | Run 1 (all rules WARN, image before the fix) | Run 2 (rule file, image with the fix) |
|---|---|---|
| Wall clock (UTC) | 06:56 to 07:01 | 07:11 to 07:18 |
| URLs in the site tree | 275 | 275 |
| Summary line | `FAIL-NEW: 0 FAIL-INPROG: 0 WARN-NEW: 4 WARN-INPROG: 0 INFO: 0 IGNORE: 0 PASS: 116` | `FAIL-NEW: 0 FAIL-INPROG: 0 WARN-NEW: 1 WARN-INPROG: 0 INFO: 2 IGNORE: 0 PASS: 116` |
| 5xx responses | 1 (`PATCH /v1/me`) | 0 |
| ZAP exit status | 0 (`-I`) | 0 (`-I`) |

The 30 minute active scan cap was not reached in either run (the runs ended after about 5 and 6.5 minutes).

| Alert (rule) | Risk | Run 1 | Run 2 | Where | Assessment |
|---|---|---|---|---|---|
| A Server Error response code was returned (100000) | Low | 1 | 0 | `PATCH /v1/me` | **Fixed**, section 4. |
| Cross-Origin-Resource-Policy header missing or invalid (90004) | Low | 3 | 4 | `GET /v1/me`, `PATCH /v1/me`, `POST /v1/shops`, `POST /v1/auth/reauth/request` (2xx and 202 responses) | **Open**, rule stays WARN. ADR-0010 lists the header baseline and does not include `Cross-Origin-Resource-Policy`; the API answers JSON with a bearer token, no cookie, so the exposure is small. Adding the header is a baseline change that needs an amendment of ADR-0010 (not made here). |
| HTTP Only Site (10106) | Medium | 1 | 1 | `POST /v1/auth/otp/request` | **Accepted** (local relaxation, INFO): the scan stack is plain HTTP; production is HTTPS only. |
| Unexpected Content-Type was returned (100001) | Low | 976 | 976 | 967 are the bare Tomcat 400 page for an encoded slash, NUL or backslash in the path; 9 are the public site root and its static files | **Accepted** (INFO). Checked: `DELETE /v1/shops/%2F` answers `400 text/html` with a body that has no stack trace and no version text, produced by the container before the filter chain. No API handler answered `text/html`. |
| A Client Error response code was returned (100000) | Info | 2643 | 2643 | API routes | Informational, run 2 by status: 404 x1276, 400 x969 (the container 400 above), 422 x313, 429 x43 (rate limits engaged), 415 x31, 401 x10, 405 x1. |
| Non-Storable Content (10049), the header fuzzer (10104) | Info | 5, 5 | 5, 5 | auth and invitation responses | Informational. |

Rules that were never raised (PASS in both runs) are FAIL in `api-scan.conf`, so a later run that raises one of them is reported as `FAIL-NEW`: missing `X-Content-Type-Options` (10021), debug error messages (10023), missing CSP (10038), CRLF injection (40003), server side include (40009), reflected and persistent XSS (40012, 40014), SQL injection and its PostgreSQL time based variant (40018, 40022), path traversal (6), remote file inclusion (7), XSLT injection (90017), server side code injection (90019), OS command injection (90020), application error disclosure (90022), XXE (90023).

## 4. Defect found and fixed

Run 1 raised a 500 on `PATCH /v1/me`. The server log showed `ERROR: invalid byte sequence for encoding "UTF8": 0x00`: a `displayName` containing a NUL character passed `@NotBlank` and `@Size` and reached the `UPDATE users` statement, and PostgreSQL text cannot hold U+0000.

- Fix: `MePatchBody.displayName` now carries the same visible-text pattern as shop names (`TEXT_PATTERN`, no control characters) and answers `422 validation.failed` with `invalid_format`. Commit `fix(server): reject control characters in the display name instead of answering 500`; regression test: the two new cases in `MeTest` (`patch me rejects other properties and invalid names`). `docs/api/openapi.json` gained the `pattern` on `MePatchBody.displayName` (the export and the committed contract must match).
- Same class, found while checking: the sync push put NUL in `customer.name`, `customer.note`, `customer.tag` and `entry.note` through to the database, where the error became a rejected operation with the misleading code `conflict` (HTTP 200, no 500). Now `invalid_format` on the field. Commit `fix(server): reject NUL and control characters in sync text fields as invalid_format`; regression test `SyncValidationTest` (`a NUL character or control characters in text fields are invalid_format, not a conflict`).
- Run 2 on the image built after the fix: 0 server errors.

## 5. Not covered

- The OpenAPI import uses the example ids of the document, so most `/v1/shops/{shopId}/...` operations answered 401, 404 or 422 and the authenticated depth is limited to `/v1/me`, `/v1/shops` and the auth endpoints. A scan with a seeded shop and real ids is **not exercised**.
- The webhooks (`/v1/webhooks/play-rtdn`, `/v1/webhooks/sms-dlr`) need a signed envelope or a push token; the scan only sees their refusals.
- The admin console, the public site and the statement page are outside the OpenAPI document: no ZAP baseline run (**not exercised**).
- The scan stack uses fake adapters: no Play, Netgsm or R2 call was made.
