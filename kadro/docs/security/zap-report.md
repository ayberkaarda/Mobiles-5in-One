# Kadro — OWASP ZAP scan with a real database and an API scan

| Field      | Value                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-10-26, 12:56 to 13:02 (UTC+3), wall time 6 min 13 s for all five phases                                                                                                                         |
| Tree       | `main` at `9f862e57` (application code as scanned; this change adds only `ops/zap-scan.mjs` and documentation)                                                                                       |
| Scope      | Production build (`next start`, `NODE_ENV=production`) against a disposable PostgreSQL 16 + PostGIS database that is migrated and seeded. Local only, dummy configuration, nothing outside the host. |
| Scanner    | `ghcr.io/zaproxy/zaproxy:stable`, ZAP **2.17.0**, Docker 29.7.2, Node.js 22.23.2, pnpm 12.8.1, Windows 11                                                                                            |
| Result     | **0 FAIL in all five phases. No real vulnerability found; no production code changed.** Two Low observations and the coverage limits are in §5 and §6.                                               |
| Supersedes | The "ZAP against DB-backed flows" and "ZAP full API scan" rows of [`attack-report.md`](attack-report.md) §4. The DB-less baseline in §2 of that report stays as history.                             |
| Repeatable | `node ops/zap-scan.mjs` (see §1)                                                                                                                                                                     |

---

## 1. How it was run

From `kadro/`:

```sh
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@kadro/web --filter=@kadro/worker   # also builds packages/db
node ops/zap-scan.mjs              # all phases; or name some: baseline api-auth ...
```

The script starts and removes everything itself:

1. A uniquely named PostGIS container (`kadro-zap-db-<phase>-<epoch>`, tmpfs data, random loopback port; host port 5432 is
   never used).
2. `packages/db` `dist/cli/migrate.js` and `dist/cli/seed.js` against it: **94 districts and 6 `[ÖRNEK]` sample venues**.
3. The worker (`apps/worker/dist/main.js`) runs only until the pg-boss queues exist (**29 queues**, polled in the database),
   then it is stopped. Migration 0010 creates the schema but not the queues; without them every route that enqueues a job
   (register, forgot-password) answers 500 for an environment reason. No job is processed during a scan.
4. `next start -H 0.0.0.0` on a free port with a run-time configuration: fresh ES256 key pair, random CSRF and hash
   secrets, dummy Apple and Google audiences, `WEB_ORIGIN` = `http://host.docker.internal:<port>`, log transports for
   e-mail and push, access-token lifetime 3600 s (the longest allowed, so a long authenticated scan cannot fall back to
   401s). The RevenueCat webhook secret, the TOTP key and object storage are **not** configured. Rate limits keep their
   production defaults (auth: 5 per 900 s).
5. One ZAP container per scan (`kadro-zap-<phase>-<epoch>`), removed by exact name together with the database container.
   No prune and no volume removal is ever run.

Each phase gets its **own fresh database and server**: rate-limit buckets live in the database, so a shared stack turns the
next phase's requests into 429s.

| Phase               | ZAP command (container arguments)                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseline`          | `zap-baseline.py -t http://host.docker.internal:<port> -m 2 -I`                                                                                           |
| `baseline-venue`    | `zap-baseline.py -t http://host.docker.internal:<port>/saha/ornek-kadikoy-hali-saha-a -m 1 -I`                                                            |
| `baseline-district` | `zap-baseline.py -t http://host.docker.internal:<port>/eksik-var/istanbul/kadikoy -m 1 -I`                                                                |
| `api`               | `zap-api-scan.py -t /zap/spec/openapi.json -f openapi -O http://host.docker.internal:<port> -I` (spec mounted read-only; header `x-kadro-client: mobile`) |
| `api-auth`          | as `api`, plus `Authorization: Bearer <token>` of a user registered through the API at run time                                                           |

Notes that matter when reproducing:

- `docs/api/openapi.json` (54 paths, 67 operations) names `https://kadro.app` as its server; `-O` replaces it. The ZAP log
  of both API phases shows `Using override, new target: http://host.docker.internal:<port>`, so nothing is sent to the
  production host.
- Replacer rules are passed through a properties file (`-configfile`), because a value with a space (`Bearer ...`) does
  not survive the space-split `-z` option. The key is `matchstr`: with a misspelled key ZAP emits a malformed header line,
  the server rejects every request with 400 and the scan "passes" while testing nothing.
- **Header evidence on the wire.** The script reads the server's own structured request log (one JSON line per Route
  Handler call with route, status, client type and problem code) and prints the mix per phase. In this run 15,276 of
  15,277 (`api`) and 15,577 of 15,578 (`api-auth`) handled requests carried `x-kadro-client: mobile`; the one exception
  in each is the script's own health probe. In `api-auth` the 401 count fell from 11,517 to 2 (both on `auth/login`
  with ZAP's placeholder credentials), so the bearer token was accepted on every protected route.
- **Guard against empty scans.** An API phase fails the run when fewer than 1,000 requests reach the handlers, when no
  request carries the client header, when nothing answers below 400, or (for `api-auth`) when a quarter or more answer 401. Any 500 also fails the run.
- **Windows host ports.** Every scanner request is a new TCP connection through Docker's port proxy, and one API scan
  leaves about 16,000 sockets in `TIME_WAIT` (the dynamic range has 16,384). A first run on the same day started
  `api-auth` right after `api`: the server could not reach its own database (`connect EADDRINUSE`, five 500s) and ZAP's
  active scan stopped after 96 requests. That run was discarded. The script now waits until fewer than 2,000 sockets are
  in `TIME_WAIT` before each phase (here it waited about two minutes before `api-auth`).
- The bearer token is created at run time (register, mark the e-mail verified in the disposable database, log in), kept
  in memory and in a properties file in the temporary report directory, and deleted at the end. It is never committed.
- `api` and `api-auth` are **active** scans. Point them only at the disposable server the script starts.
- Reports (HTML, JSON, ZAP and server logs) go to a temporary directory printed at the end, not into the repository.

---

## 2. Results

| Phase               | FAIL | WARN | PASS | Exit | URLs in ZAP tree | Requests handled by Route Handlers |
| ------------------- | ---- | ---- | ---- | ---- | ---------------- | ---------------------------------- |
| `baseline`          | 0    | 8    | 60   | 0    | 59               | 3                                  |
| `baseline-venue`    | 0    | 8    | 60   | 0    | 65               | 3                                  |
| `baseline-district` | 0    | 8    | 60   | 0    | 65               | 3                                  |
| `api`               | 0    | 3    | 119  | 0    | 181              | 15,277                             |
| `api-auth`          | 0    | 3    | 119  | 0    | 180              | 15,578                             |

Status mix of the API phases, from the server log (exact, 2xx included):

| Status | `api` (anonymous)                                                | `api-auth`                                                                 |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2xx    | 40: `districts`, `health`, `open-calls`, `venues`, `auth/forgot` | 64: the same plus `me`, `me/stats`, `teams`, `auth/login`, `auth/register` |
| 400    | 3,197 `validation_failed`                                        | 14,802 `validation_failed`                                                 |
| 401    | 11,517 `unauthenticated` (every protected route denies)          | 2 (`auth/login`, `invalid_credentials`)                                    |
| 403    | 0                                                                | 180 `forbidden` (admin routes for an ordinary user)                        |
| 404    | 3 (`venues/[slug]`)                                              | 5 (`venues/[slug]`, `venues/[slug]/reviews/mine`)                          |
| 422    | 1 (`auth/register`, `password_breached`)                         | 0                                                                          |
| 429    | 293 (`auth/login` 199, `auth/register` 90, `auth/forgot` 4)      | 299 (`auth/login` 202, `auth/register` 92, `auth/forgot` 5)                |
| 500    | 0                                                                | 0                                                                          |
| 503    | 226 (`webhooks/revenuecat`, secret not configured)               | 226 (same)                                                                 |

Compared with the DB-less baseline of `attack-report.md` §2 (FAIL 0 / WARN 9 / PASS 58), `Application Error Disclosure`
is no longer raised: `/sitemap.xml` answers 200 (12 URLs on a direct request). The pages that need the database answered
200 on direct requests before the scans: `/sitemap.xml`, `/`, `/ozellikler`, `/sss`, `/blog`, `/gizlilik`,
`/kvkk-aydinlatma`, `/iletisim`, `/saha/ornek-kadikoy-hali-saha-a` and `/eksik-var/istanbul/kadikoy`.

---

## 3. Triage — site baseline (the three `baseline*` phases report the same 8 WARN rules)

| Alert (ZAP id)                                            | Where                                                         | Class                      | Assessment                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Absence of Anti-CSRF Tokens [10202]                       | `/giris`, `/sifremi-unuttum`; theme form on every page        | False positive / by design | The sign-in forms are client components that post JSON to the API with the double-submit CSRF cookie and header. The footer theme form posts to `/tema`, which accepts same-origin posts only (`theme-request.ts`, `tests/marketing/theme-route.test.ts`) and only sets the `kadro-theme` cookie. |
| CSP: Failure to Define Directive with No Fallback [10055] | `/api` (404)                                                  | By design                  | The API surface sends `default-src 'none'; frame-ancestors 'none'`; the rule wants more directives on a non-page response.                                                                                                                                                                        |
| Big Redirect Detected [10044]                             | `/admin`, `/admin/sahalar` (redirect to sign-in)              | By design                  | Unauthenticated staff routes redirect to sign-in; ZAP flags only the body size.                                                                                                                                                                                                                   |
| COEP / COOP / CORP missing [90004]                        | pages, `/sitemap.xml`, `/robots.txt`, static CSS, font        | Hardening suggestion (Low) | No cross-origin isolation need today. Optional, see §5.                                                                                                                                                                                                                                           |
| Authentication Request Identified [10111]                 | `/giris`, `/admin/giris`                                      | Informational              | Classification only.                                                                                                                                                                                                                                                                              |
| Content-Type Header Missing [10019]                       | `/admin/`, `/api/`, `/mac/` (308)                             | By design                  | Body-less trailing-slash redirects.                                                                                                                                                                                                                                                               |
| Modern Web Application [10109]                            | `/admin`, `/admin/sahalar`                                    | Informational              | Classification only.                                                                                                                                                                                                                                                                              |
| Non-Storable / Storable (Non-)Cacheable Content [10049]   | redirects, auth pages, `/mac`, static assets, robots, sitemap | By design                  | Auth pages and redirects are `no-store`; hashed bundles are `max-age=31536000`; `robots.txt`, `sitemap.xml` and the font are `max-age=0`.                                                                                                                                                         |

No alert in this group is a real finding.

---

## 4. Triage — API scans (`zap-api-scan.py`, 78 URLs imported from the OpenAPI document)

| Alert (ZAP id)                            | `api` | `api-auth` | Class                          | Assessment                                                                                                                                                                                                               |
| ----------------------------------------- | ----- | ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server Error response code [100000]       | 2     | 2          | Environment artifact           | `POST /api/v1/webhooks/revenuecat` (with and without trailing slash) answers 503: the webhook secret is not configured, so the route fails closed. The secret path is covered by `tests/attack/webhook-forgery.test.ts`. |
| Unexpected Content-Type [100001]          | 49    | 49         | Observation (Low, consistency) | Unknown paths under `/api/**` (`/api/v1/<random>`, `/api/v1/matches/id/payments`, cloud metadata probes, ...) get the Next.js not-found page as `text/html` with 404, not `application/problem+json`. See §5.            |
| CORP missing [90004]                      | 3     | 5          | Hardening suggestion (Low)     | `Cross-Origin-Resource-Policy` is absent on public JSON responses (`/health`, `/districts`, `/auth/forgot`, and with a token `/me`, `/me/stats`). Optional.                                                              |
| Client Error response code [100000]       | 205   | 198        | Informational                  | Status mix in §2: denials, validation failures and rate limits as designed.                                                                                                                                              |
| Authentication Request Identified [10111] | 1     | 1          | Informational                  | `POST /auth/login`.                                                                                                                                                                                                      |
| Non-Storable Content [10049]              | 5     | 5          | By design                      | API responses are `no-store`.                                                                                                                                                                                            |

No SQL injection, XSS, path traversal, command injection, SSRF, server-side template injection or remote-file-inclusion
rule raised an alert in either API scan (119 PASS each), and no request produced a 500.

---

## 5. Findings and follow-ups

**No real vulnerability. No production code was changed and no `docs/handoffs/zap-<n>-to-owner.md` was created.**

1. **Unknown `/api/**` paths return an HTML 404** (Low, consistency). The documented error contract is
   `application/problem+json`; a client that parses every `/api` error as JSON gets HTML instead. No sensitive data was
   seen (the evidence is the content type of the generic not-found page). Not fixed here: a catch-all API route has to go
   through `route()`, the endpoint registry, the OpenAPI document and `tests/route-coverage.test.ts`, which is more than a
   small change. Follow-up: a problem-details 404 for unmatched `/api/v1/**` paths, or a proxy-level rewrite.
2. **COOP / COEP / CORP headers** (Low, optional): only needed if cross-origin isolation is ever wanted. Same suggestion as
   in `attack-report.md` §3.

---

## 6. Honest coverage limits

- **Most API requests stop at input validation.** ZAP fills path parameters with placeholders (`id`, `slug`, `code`),
  which fail the UUID and slug schemas, so most authenticated requests answer 400 before any database work: 10 operations
  answered 2xx with a token, 5 without. Deep flows (create team, match lifecycle, payments, reviews) remain covered by the
  Vitest attack suite, not by ZAP.
- **Rate limits.** The auth endpoints keep their production limit (5 per 900 s), so 293 and 299 attack requests to
  `auth/login`, `auth/register` and `auth/forgot` answered 429 and did not reach the handler. Raising the limit does not
  help (the configuration allows at most 100 per 60 s). Injection on those bodies is covered by
  `tests/attack/injection.test.ts`.
- **The authenticated user is an ordinary user.** No staff account with a TOTP step-up was provisioned (and the TOTP key is
  not configured), so admin routes answered 403 or 401; they were not exercised as a moderator or administrator.
- **No web-client pass.** The API scans use `x-kadro-client: mobile` and a bearer token. The cookie + CSRF flow of the web
  client was not scanned; it is covered by `tests/attack/edge-csrf.test.ts` and the CSRF unit tests.
- **Public site crawl.** The spider reaches only linked pages (59 URLs from the home page). The seeded sample venues are
  `noindex` and not linked, so the venue and district pages were scanned by starting the spider on them. Only 6 sample
  venues and no open call exist, so list and detail variants with real content (reviews, calls) are not covered.
- **Environment differences from production:** HTTP instead of HTTPS (no HSTS evaluation, `__Host-` cookies not
  exercised), no Caddy edge, no RevenueCat webhook secret, no TOTP key, no object storage, no mail or push provider, worker
  not running during scans.
- ZAP's alpha rules (`-a`) and the AJAX spider were not enabled. The scan is manual and not part of CI. MobSF and the other
  rows of `attack-report.md` §4 are unchanged.

---

## 7. Cleanup evidence

Every container is removed by exact name by the script (`docker rm --force <name>`). `docker ps -a` filtered on
`kadro-zap` returned no rows after the run. No `prune`, `system` or `volume` command was used.
