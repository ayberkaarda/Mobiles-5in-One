# Kadro — Phase 6 Attack Report

|               |                                                                                                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | **Phase 6.** Automated attack suite plus an OWASP ZAP baseline scan against the production build. No real vulnerability found; no production code was changed.                                                   |
| Companions    | `docs/security/threat-model.md` (STRIDE rows and `Verify` columns), `docs/security/authorization-matrix.md`, `docs/security/verification-matrix.md`                                                              |
| Method        | Adversarial automated tests driving the shipped Route Handlers against a real PostgreSQL 16 + PostGIS database (disposable Docker container), and a passive/active ZAP baseline against the `next start` build.  |
| Scope         | Owned here: `apps/web/tests/attack/**`, this report, `docs/handoffs/attack-*.md`. Non-test source, other packages, the mobile app, workflows and manifests were not touched.                                     |
| Evidence rule | Every "passed" below is backed by the command and real output captured during this run. Steps that were not run are listed as **not run** with the reason.                                                       |

---

## 1. Automated attack suite (`apps/web/tests/attack`)

Vitest suites that act as the adversary against the real handlers and database. Run:

```
cd apps/web && CI=true pnpm exec vitest run tests/attack
```

Result (real output of this run): **Test Files 5 passed (5), Tests 22 passed (22)**, duration ~11 s. The
disposable PostgreSQL + PostGIS container is started by the suite's global setup; each file migrates
and drops its own database.

| File                          | Tests | What it attacks                                                                                                                                                                                                                                                                                                                                                                      | Threat rows                       |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `anonymous-access.test.ts`    | 3     | BOLA / IDOR sweep **derived from the endpoint registry**: every `auth: required` route is called by an anonymous caller with a fabricated id in each path segment and must answer **401 `unauthenticated`** before loading the resource (54 routes discovered, all rejected). Public routes (`auth: optional / none`) are probed with the same hostile ids and must never 5xx or leak a stack / SQL string. | T-PLT-05, matrix §2 item 4        |
| `credential-bruteforce.test.ts` | 6   | Online brute force on the real `login`: five wrong guesses then **429** per IP+email; a targeted email locks out across many source addresses; spoofed `x-forwarded-for` prefixes do not bypass the limit; `login` / `register` / `forgot` give identical answers for known and unknown addresses (no enumeration).                                                                   | T-AUTH-01/02/03, item 5           |
| `session-replay.test.ts`      | 4     | Refresh-token theft: replaying a rotated token burns the whole family (the legitimate client's fresh token and access JWT die too); a stolen access token stops the instant the victim logs out (that device only) or resets the password (every device); an emailed reset token is single-use.                                                                                       | T-AUTH-05/08/13, item 12          |
| `injection.test.ts`           | 6     | SQL metacharacters in the credential fields, in a public search term (`venues?q=`) and in a pagination cursor (`open-calls?cursor=`, `venues?cursor=`); CRLF in a free-text field (`register.displayName`); a body over the 1 MiB limit; a deeply nested JSON body. All handled as data: 400 / 401 / 413, user table intact, no 5xx and no database error string in any body.         | T-PLT-06/12/18, T-MATCH-09        |
| `webhook-forgery.test.ts`     | 3     | RevenueCat webhook with no / wrong / empty `Authorization` → **401**; the correct shared secret passes the constant-time gate and the body is then validated (no 401 past the gate), proving the signature is the only control and the event is not processed on a forged delivery.                                                                                                     | T-SUB-01, item 17                 |

The cross-user ("as another user") half of the BOLA matrix is owned by `tests/security/idor.test.ts`,
whose route-coverage block fails if any protected route lacks a cross-tenant row; this suite adds the
anonymous half over the whole registry. Rate-limit internals, header/CSP checks and
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

| ZAP alert                                         | Count | Where                                | Severity | Assessment                                                                                                                                                                              |
| ------------------------------------------------- | ----- | ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absence of Anti-CSRF Tokens [10202]               | 5     | `/giris`, `/admin/giris`, `/sifremi-unuttum` | Info (false positive) | Forms are client components that post JSON to the API with the double-submit CSRF cookie + header and `SameSite=Lax` (T-AUTH-09); there are no hidden form tokens for the passive scanner to see. `form-action 'self'` is set. |
| Cross-Origin-Embedder-Policy missing [90004]      | 13    | all pages                            | Low      | COEP / COOP not set. Not required by the app (no cross-origin isolation need). Optional hardening; recorded as a suggestion, not a fix.                                                 |
| Application Error Disclosure [90022]              | 1     | `/sitemap.xml` (500)                 | Info (environment) | The 500 is a no-database artifact (sitemap queries the DB). The 500 body is **empty** — verified with `curl`; no stack, SQL or path disclosed (T-PLT-05 holds).                           |
| Big Redirect Detected [10044]                     | 2     | `/admin`, `/admin/sahalar` (307)     | Info     | Redirect to the sign-in page; no sensitive data in the redirect.                                                                                                                        |
| Content-Type Header Missing [10019]               | 2     | `/admin/`, `/mac/` (308)             | Info     | On 308 redirect responses with no body.                                                                                                                                                 |
| CSP: Failure to Define Directive w/ No Fallback [10055] | 1 | `/api` (404)                         | Info     | The API 404 problem response carries a minimal CSP; not a page surface.                                                                                                                 |
| Non-Storable Content [10049]                      | 6     | redirects + auth pages               | Info     | Expected: these responses are intentionally not cacheable.                                                                                                                              |
| Modern Web Application [10109]                    | 2     | `/admin*`                            | Info     | Informational classification only.                                                                                                                                                      |
| Authentication Request Identified [10111]         | 3     | `/giris`, `/admin/giris`             | Info     | Informational classification only.                                                                                                                                                      |

### 2.2 Confirmed strong controls (spot-checked against the running build)

- Anonymous `GET /api/v1/teams` → `401 unauthenticated` with the generic problem body (matches §1).
- `GET /api/v1/health` → status + build SHA only, no secrets.
- Response headers on `/`: `Strict-Transport-Security … preload`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`,
  `X-Frame-Options: DENY`, and a nonce CSP with `strict-dynamic`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'` (T-PLT-08/15/16).

---

## 3. Findings and severity

**No real vulnerability was found.** All 22 attack cases pass (the controls hold) and ZAP reports 0
failures. The 9 ZAP warnings are informational, by-design (double-submit CSRF), or artifacts of the
no-database scan environment; none require a production code change. Because nothing failed, there are
**no** `docs/handoffs/attack-*.md` entries.

Optional hardening suggestions (not defects, not actioned here): set `Cross-Origin-Opener-Policy` and
`Cross-Origin-Embedder-Policy` on page surfaces if cross-origin isolation is ever needed.

---

## 4. Not run (honest list)

| Item                     | Status  | Reason                                                                                                                                                                       |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MobSF static scan        | **not run** | Needs the MobSF service and a built release APK / IPA; neither is available in this environment. To be run against an EAS release build with findings recorded here.          |
| ZAP against DB-backed flows | **partial** | The baseline server ran without a database, so DB-backed pages and authenticated API flows were not spidered; those flows are covered by the §1 suite against a real database. |
| ZAP full API scan (OpenAPI) | **not run** | The spec's `docs/api/openapi.json` API scan belongs on a CI preview URL with a live database; out of scope for this local run.                                              |
| Dependency audit (`pnpm audit`) | **not run** | Separate Phase 6 workstream; not part of this attack-suite task.                                                                                                       |
| `expo-updates` code-signing verification | **not run** | Mobile release concern; belongs with the MobSF / release step.                                                                                                     |

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
