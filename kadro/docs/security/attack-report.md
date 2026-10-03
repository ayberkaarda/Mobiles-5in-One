# Kadro — Phase 6 Attack Report

|               |                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status        | **Phase 6.** Automated attack suite (11 files) plus an OWASP ZAP baseline scan against the production build. No vulnerability found in the categories exercised (see §4 for categories not covered); no production code was changed. |
| Companions    | `docs/security/threat-model.md` (STRIDE rows and `Verify` columns), `docs/security/authorization-matrix.md`, `docs/security/verification-matrix.md`                                                                                  |
| Method        | Adversarial automated tests driving the shipped Route Handlers against a real PostgreSQL 16 + PostGIS database (disposable Docker container), and a passive/active ZAP baseline against the `next start` build.                      |
| Scope         | Owned here: `apps/web/tests/attack/**`, this report, `docs/handoffs/attack-*.md`. Non-test source, other packages, the mobile app, workflows and manifests were not touched.                                                         |
| Evidence rule | Every "passed" below is backed by the command and real output captured during this run. Steps that were not run are listed as **not run** with the reason.                                                                           |

---

## 1. Automated attack suite (`apps/web/tests/attack`)

Vitest suites that act as the adversary against the real handlers and database. Run:

```
cd apps/web && CI=true pnpm exec vitest run tests/attack
```

Result (real output of this run, all 11 files): **Test Files 11 passed (11), Tests 153 passed + 1 expected fail (154)**. The expected fail is the negative control in `edge-csrf.test.ts` (`it.fails`). The
disposable PostgreSQL + PostGIS container is started by the suite's global setup; each file migrates
and drops its own database.

| File                             | Tests | What it attacks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Threat rows                |
| -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `anonymous-access.test.ts`       | 3     | BOLA / IDOR sweep **derived from the endpoint registry**: every `auth: required` route is called by an anonymous caller with a fabricated id in each path segment and must answer **401 `unauthenticated`** before loading the resource (54 routes discovered, all rejected). Public routes (`auth: optional / none`) are probed with the same hostile ids and must never 5xx or leak a stack / SQL string.                                                                                                                                          | T-PLT-05, matrix §2 item 4 |
| `credential-bruteforce.test.ts`  | 6     | Online brute force on the real `login`: five wrong guesses then **429** per IP+email; a targeted email locks out across many source addresses; spoofed `x-forwarded-for` prefixes do not bypass the limit; `login` / `register` / `forgot` give identical answers for known and unknown addresses (no enumeration).                                                                                                                                                                                                                                  | T-AUTH-01/02/03, item 5    |
| `session-replay.test.ts`         | 4     | Refresh-token theft: replaying a rotated token burns the whole family (the legitimate client's fresh token and access JWT die too); a stolen access token stops the instant the victim logs out (that device only) or resets the password (every device); an emailed reset token is single-use.                                                                                                                                                                                                                                                      | T-AUTH-05/08/13, item 12   |
| `injection.test.ts`              | 6     | SQL metacharacters in the credential fields, in a public search term (`venues?q=`) and in a pagination cursor (`open-calls?cursor=`, `venues?cursor=`); CRLF in a free-text field (`register.displayName`); a body over the 1 MiB limit; a deeply nested JSON body. All handled as data: 400 / 401 / 413, user table intact, no 5xx and no database error string in any body.                                                                                                                                                                        | T-PLT-06/12/18, T-MATCH-09 |
| `webhook-forgery.test.ts`        | 3     | RevenueCat webhook with no / wrong / empty `Authorization` → **401**; the correct shared secret passes the constant-time gate and the body is then validated (no 401 past the gate), proving the signature is the only control and the event is not processed on a forged delivery.                                                                                                                                                                                                                                                                  | T-SUB-01, item 17          |
| `tenant-bola.test.ts`            | 73    | Authenticated cross-user and cross-team BOLA / IDOR sweep driven by the endpoint registry, as a stranger and as the captain of another team. 32 of the 35 id-bearing routes covered; invite preview, invite accept and applying to a public open call are exempt by design. Each attempt must get the matrix status, never a 2xx, no victim data, the same status and body as with unknown ids, and the victim's rows unchanged. A coverage test fails if an id route has no case; a negative control proves the harness flags a permissive handler. | T-PLT-05, matrix §2 item 4 |
| `tenant-mass-assignment.test.ts` | 23    | Every params / query / body schema of all 54 routes walked at every depth: no object accepts unknown keys (exception: the RevenueCat `event`, loose on purpose and never stored). On 18 write routes a real user sends a valid body plus one extra field (`role`, `isPro`, `userId`, `status`, `teamId`, `createdBy`, `entitlements`, `stepUpUntil`, route specific ones): all 400 `validation_failed`, rows unchanged; the same body without the field succeeds. Negative control included. Admin write routes covered by the schema walk only.     | matrix §2                  |
| `edge-csrf.test.ts`              | 9     | Forged cookie-auth mutations (PATCH / DELETE `/me`, team creation, logout, refresh) rejected with 403 `csrf_failed` for missing, empty or mismatched header, tokens of another session, cross-site `Origin` with `Sec-Fetch-Site: cross-site`; form posts and requests claiming to be the mobile client; every GET route leaves the database unchanged. Negative control (`it.fails`).                                                                                                                                                               | T-AUTH-09                  |
| `edge-host-header.test.ts`       | 5     | Spoofed `Host`, `X-Forwarded-Host/Proto/Port`, `Forwarded` never appear in redirects, links, canonical, robots, sitemap or the invite page; protocol-relative, backslash and `next=` paths do not redirect off site; API invite links use the configured origin. Email links are built by the worker and are not covered here.                                                                                                                                                                                                                       | T-PLT                      |
| `edge-admin-escalation.test.ts`  | 11    | Player, staff without step-up, expired step-up (and the exact-expiry edge), moderator on admin-only routes, demoted or deactivated admin with an open window, smuggled fields; two admins deactivating each other and three demoting in a ring always leave one admin.                                                                                                                                                                                                                                                                               | ADR-0064/0066/0067         |
| `edge-totp.test.ts`              | 11    | A code cannot be reused across endpoints or in parallel; 12 parallel wrong codes count exactly 5 attempts and get 7x 429; one budget per account across sessions and IPs; window edges; 19 malformed shapes spend no attempts.                                                                                                                                                                                                                                                                                                                       | ADR-0066                   |

The existing `tests/security/idor.test.ts` keeps its route-coverage block; this suite adds the anonymous
half and the registry-driven cross-tenant sweep over the whole registry. Rate-limit internals, header/CSP checks and
webhook replay/duplicate handling remain covered by `tests/ratelimit.test.ts`,
`tests/security/headers-check.test.ts` and `tests/billing/webhook.test.ts`.

---

## 2. OWASP ZAP baseline scan

Image pulled: `ghcr.io/zaproxy/zaproxy:stable` (pull succeeded). The production build was produced with
`pnpm turbo run build --filter=@kadro/web` and started with `next start -H 0.0.0.0 --port 3137` under a
a disposable test configuration (`NODE_ENV=production`). Command:

```
docker run --rm --name kadro-zap-baseline-<epoch> ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:3137 -m 2 -I
```

Result (real): **FAIL-NEW 0 · WARN-NEW 9 · INFO 0 · PASS 58**, process exit 0. Container removed by
`--rm`; no image or volume was pruned.

> **Coverage limit (stated honestly):** the baseline server ran **without a database** (`DATABASE_URL`
> pointed at a non-existent server, as in the unit harness). Public marketing / SEO / auth-form pages,
> the health probe and the API error envelopes were exercised; database-backed pages and authenticated
> API flows were not. The automated suite in §1 covers those flows against a real database.

### 2.1 Triage of the 9 warnings

| ZAP alert                                               | Count | Where                                        | Severity              | Assessment                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ----- | -------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Absence of Anti-CSRF Tokens [10202]                     | 5     | `/giris`, `/admin/giris`, `/sifremi-unuttum` | Info (false positive) | Forms are client components that post JSON to the API with the double-submit CSRF cookie + header and `SameSite=Lax` (T-AUTH-09); there are no hidden form tokens for the passive scanner to see. `form-action 'self'` is set. |
| Cross-Origin-Embedder-Policy missing [90004]            | 13    | all pages                                    | Low                   | COEP / COOP not set. Not required by the app (no cross-origin isolation need). Optional hardening; recorded as a suggestion, not a fix.                                                                                        |
| Application Error Disclosure [90022]                    | 1     | `/sitemap.xml` (500)                         | Info (environment)    | The 500 is a no-database artifact (sitemap queries the DB). The 500 body is **empty** — verified with `curl`; no stack, SQL or path disclosed (T-PLT-05 holds).                                                                |
| Big Redirect Detected [10044]                           | 2     | `/admin`, `/admin/sahalar` (307)             | Info                  | Redirect to the sign-in page; no sensitive data in the redirect.                                                                                                                                                               |
| Content-Type Header Missing [10019]                     | 2     | `/admin/`, `/mac/` (308)                     | Info                  | On 308 redirect responses with no body.                                                                                                                                                                                        |
| CSP: Failure to Define Directive w/ No Fallback [10055] | 1     | `/api` (404)                                 | Info                  | The API 404 problem response carries a minimal CSP; not a page surface.                                                                                                                                                        |
| Non-Storable Content [10049]                            | 6     | redirects + auth pages                       | Info                  | Expected: these responses are intentionally not cacheable.                                                                                                                                                                     |
| Modern Web Application [10109]                          | 2     | `/admin*`                                    | Info                  | Informational classification only.                                                                                                                                                                                             |
| Authentication Request Identified [10111]               | 3     | `/giris`, `/admin/giris`                     | Info                  | Informational classification only.                                                                                                                                                                                             |

### 2.2 Confirmed strong controls (spot-checked against the running build)

- Anonymous `GET /api/v1/teams` → `401 unauthenticated` with the generic problem body (matches §1).
- `GET /api/v1/health` → status + build SHA only, no secrets.
- Response headers on `/`: `Strict-Transport-Security … preload`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`,
  `X-Frame-Options: DENY`, and a nonce CSP with `strict-dynamic`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'` (T-PLT-08/15/16).

---

## 3. Findings and severity

**No vulnerability was found in the exercised categories.** All 153 attack cases pass (plus one expected-fail negative control) and ZAP reports 0
failures. The 9 ZAP warnings are informational, by-design (double-submit CSRF), or artifacts of the
no-database scan environment; none require a production code change. Because nothing failed, there are
**no** `docs/handoffs/attack-*.md` entries.

Optional hardening suggestions (not defects, not actioned here): set `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` on page surfaces if cross-origin isolation is ever needed.

---

## 4. Not run, partial and known gaps (honest list)

| Item                                              | Status                     | Reason                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MobSF static scan                                 | **run (Android APK only)** | Android release APK scanned with MobSF 4.5.4, score 48/100; one real finding in our config (unneeded storage and overlay permissions). Details: [mobsf-report.md](mobsf-report.md). Not covered: iOS IPA, an EAS-signed build (the APK used the template debug key). |
| ZAP against DB-backed flows                       | **partial**                | The baseline server ran without a database, so DB-backed pages and authenticated API flows were not spidered; those flows are covered by the §1 suite against a real database.                                                                                       |
| ZAP full API scan (OpenAPI)                       | **not run**                | The spec's `docs/api/openapi.json` API scan belongs on a CI preview URL with a live database; out of scope for this local run.                                                                                                                                       |
| Dependency audit (`pnpm audit`)                   | **see report**             | Run in the final verification: see `docs/security/dependency-audit.md`.                                                                                                                                                                                              |
| `expo-updates` code-signing verification          | **not run**                | Mobile release concern; belongs with the MobSF / release step.                                                                                                                                                                                                       |
| Admin write routes: runtime mass-assignment probe | **partial**                | Covered by the schema walk only; a step-up staff harness for per-route runtime probes was not built.                                                                                                                                                                 |
| Presign upload success path                       | **not run**                | The harness has no storage configured (503).                                                                                                                                                                                                                         |
| Origin / `Sec-Fetch-Site` as a CSRF layer         | **observation**            | CSRF protection relies on the double-submit token only; checking `Origin` and `Sec-Fetch-Site` would add a second layer (not a defect).                                                                                                                              |
| Step-up window after demote and re-promote        | **not tested**             | A window may survive a demotion and re-promotion within 15 minutes; not exercised.                                                                                                                                                                                   |
| Email link construction                           | **not covered**            | Built by the worker package; the host-header tests are web only.                                                                                                                                                                                                     |

---

## 5. How to reproduce

```
# Attack suite (starts its own disposable PostgreSQL + PostGIS via Docker)
cd apps/web && CI=true pnpm exec vitest run tests/attack

# ZAP baseline against the production build
pnpm turbo run build --filter=@kadro/web
PORT=3137 node <launcher starting `next start -H 0.0.0.0 --port 3137` with a test config>
docker run --rm --name kadro-zap-baseline-<epoch> ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:3137 -m 2 -I
```
