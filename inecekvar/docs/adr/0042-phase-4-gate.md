# ADR-0042: Phase 4 gate

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 4, package 4F (the gate; builds on ADR-0037 to ADR-0041)

## Context

Section 10 closes phase 4 with: Lighthouse at least 90 on five pages, JSON-LD that validates and
the moderation e2e. Phase 4 delivered the TOTP step-up and admin API (4A, ADR-0037), the SSR
foundation (4B, ADR-0038), the programmatic pages and machine files (4C, ADR-0039), the guides,
legal, data and GEO files (4D, ADR-0040) and the moderation and admin UI (4E, ADR-0041), followed
by two review rounds. ADR-0005 governs evidence: done needs executed output; everything else is
written as `not exercised: <reason>`.

## Decision

1. **Shared bypass bucket behind a proxy.** The render limiter for requests that cannot use the
   page cache (`server/bypass-limiter.ts`, 60 burst, 60 per minute) keys on the TCP peer address
   and Express `trust proxy` stays off, so forwarded headers can never pick a bucket. Behind Caddy
   every client therefore shares the proxy's single bucket. This is accepted: the bucket is a
   global ceiling on uncached renders (cookie-carrying requests, duplicate allowlisted
   parameters), cacheable requests and the client-only `/admin` shell never consume it, and a
   busy bucket answers 429 with `Retry-After` and `no-store`. A per-client key would need a
   trusted header from the proxy; that belongs to the hosting work, together with sizing the
   numbers for real traffic (`docs/ops/env.md`).
2. **Lighthouse 12 and later have no PWA category.** The phase 4 run measures performance,
   accessibility, best practices and SEO with Lighthouse 13.5.0 (published 2026-09-18). The PWA
   score of the app was recorded in phase 3 with Lighthouse 11.7.1 (ADR-0036) and is not
   repeated: the web app is not a PWA.
3. **Open Graph images stay SVG, not PNG.** `sharp` is not in the workspace and no dependency
   was added (ADR-0039 item 14). Many social crawlers ignore SVG `og:image`; a PNG step is
   recorded as open work.
4. **The sample city is `noindex`.** Hub, line list, line, stop and route pages of a city with
   `is_sample = true` carry `noindex,follow` and are left out of the sitemaps (ADR-0039). The only
   seeded city is the sample city, so the Lighthouse SEO audit `is-crawlable` fails on those pages
   by design; see the evidence.
5. **Admin origin.** Production should serve `/admin` from a separate origin (for example
   `yonetim.inecekvar.app`) so the staff session cookie (`__Host-iv_session`, `Path=/`) never
   reaches the public SSR process (ADR-0041 item 15). No production proxy configuration exists in
   the repository; this stays a recommendation for the hosting work.
6. **API gaps carried from ADR-0041** (no API change in 4B to 4F): the queue item has no author id
   (own proposals detected through `GET edits`, first 100 only); no presigned read for proposal
   photos; `GET lines` lists published lines only, so a retired line cannot be found for a
   rollback from the versions screen; audit rows carry ids, not names. From ADR-0039: the
   `stop-pairs` IP quota also applies to the SSR server's single address (the web memo in
   `public-api.client.ts` limits the calls; an exemption or sizing is proposed); optional total
   count on `GET lines`.
7. **One gate fix in `apps/web`.** The guide and content page date line (`.meta`) used Yol Grisi
   `#6C757D` on Krem `#FFF8E7`, contrast 4.42:1 (Lighthouse `color-contrast`, accessibility 91 on
   the guide). It now uses the text colour (Lacivert); the same audit passes.
8. **JSON-LD check script.** `docs/seo/lighthouse/check-json-ld.mjs` fetches pages from a running
   server, parses every `application/ld+json` block with `JSON.parse` and checks `@context`,
   `@type` and the properties each type needs. It is a gate tool, not part of CI.

## Lanes

The second writer lane and the read-only review lane were out of usage quota from the evening of
2026-10-12 until 2026-10-18. The 4A review and its fixes ran before that; the review of 4B to 4E
was therefore done by a separate, fresh reviewer session of the lead's lane that had written none
of the code (read-only, report outside the repository, 11 findings). No review of the gate package
itself took place.

| Package | Written by | Reviewed by | Gated by |
| ------- | ---------- | ----------- | -------- |
| 4A TOTP, step-up, admin API, stop search, page data | not recorded per package in the repository (single commit author, no handoff file) | the read-only review lane (white-box, 8 findings and one side note, ADR-0037 review round) | lead lane |
| 4A review fixes | the second writer lane, from a written brief (it could not run tests) | lead lane (compiled, ran the suite, revert-checked each fix, ADR-0037) | lead lane |
| 4B SSR foundation | not recorded in ADR-0038 | independent fresh reviewer session (findings 1 to 6, 11) | lead lane |
| 4C programmatic pages, machine files | parts 1 to 3 the writing lane, e2e part the lead lane (ADR-0039) | independent fresh reviewer session (findings 1, 5, 7, 11) | lead lane |
| 4D content and GEO files | not recorded in ADR-0040 | independent fresh reviewer session (findings 9, 11) | lead lane |
| 4E moderation and admin UI | not recorded in ADR-0041 | independent fresh reviewer session (findings 2, 8, 10, 11) | lead lane |
| Review fixes for 4B to 4E (commits `58c43364` to `0cdba6bd`) | lead lane | not re-reviewed; each fix has a named test and a mutation (ADR-0038 to ADR-0041) | lead lane |
| 4F gate, `.meta` contrast fix, JSON-LD script, these documents | lead lane | none | lead lane |

## Evidence

Run on 2026-10-13 on the owner's Windows 11 machine, branch `feat/inecekvar-p4` (34 commits over
`origin/main`, which already contains phase 3, PR #123).

| # | Command or check | Result |
| - | ---------------- | ------ |
| 1 | `pnpm nx run-many -t lint test build --skip-nx-cache` in `inecekvar/` | exit 0, "Successfully ran targets lint, test, build for 5 projects" (web-e2e and mobile-e2e have none of these targets); tests domain 4, data-access 110, ui 39, web 774, mobile 460, all passed; lint "All files pass linting" for all five; web initial 351.00 kB raw, 99.75 kB transfer; mobile initial 717.36 kB raw, 180.53 kB transfer. Re-run after the `.meta` fix: same counts, exit 0 |
| 2 | `uv run ruff check . && uv run ruff format --check . && uv run mypy --strict app tests alembic && uv run pytest -q` in `api/` with `INECEKVAR_REQUIRE_DOCKER=1` (Testcontainers PostGIS, Redis, MinIO) | "All checks passed!", "196 files already formatted", "Success: no issues found in 196 source files", "709 passed in 410.41s"; JUnit report: 709 cases, 0 `<skipped` |
| 3 | `INECEKVAR_ENV=test uv run python -m app.contract` then `git diff --exit-code -- ../docs/api/openapi.json` | contract written, no diff |
| 4 | `node libs/domain/scripts/build-api-types.mjs` then `git diff --exit-code -- libs/domain/src/lib/api.ts`; `node brand/scripts/build-tokens.mjs --check` | no diff; "libs/ui/src/styles/tokens.css matches brand/tokens.json" |
| 5 | `pnpm exec prettier --check .` | "All matched files use Prettier code style!" (also after the gate files were added) |
| 6 | `pnpm nx run web:bundle-check --skip-nx-cache` | "Admin chunks (lazy, browser only): chunk-BzXT-4Js.js; initial browser chunks: 3; marked chunks: 1." and "Public web bundle clean: 60 files, 5 markers." |
| 7 | The "Placeholder markers" step of `inecekvar-ci.yml` (both `git grep` calls, the workflow's pathspecs and exclusions) | no match |
| 8 | CI banned-word grep (case-insensitive, workflow pathspecs) | "No banned words found." (re-run after these documents) |
| 9 | `docker compose -f inecekvar/docker-compose.yml config --quiet` | exit 0 |
| 10 | `gitleaks git --no-banner --redact --log-opts="origin/main..HEAD" .` (8.30.1, repository root) | "32 commits scanned", "no leaks found", exit 0 |
| 11 | `gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts=--all .` | "1125 commits scanned", "leaks found: 1", exit 1: rule `generic-api-key` in `kadro/apps/worker/test/backup-verify.test.ts`, commit `33361dd7`, reachable only from the local branch `feat/rc-delete-backup` (not on the remote, not Inecek Var). The same scan over what CI checks out, `--log-opts="--remotes HEAD"`: "1091 commits scanned", "no leaks found", exit 0. The local branch is outside this package and was left untouched |
| 12 | `pnpm nx run web-e2e:e2e --skip-nx-cache` (fake API) | "57 passed (19.2s)", "1 skipped" (the moderation scenario names the missing stack); after the `.meta` fix: 57 passed (20.7 s), 1 skipped |
| 13 | `node apps/web-e2e/scripts/real-stack.mjs up` (compose project `iv4e`, fresh database, migrations 0001 to 0004, "Sample seed: created=41"), `IV_E2E_REAL_API=1 pnpm nx run web-e2e:e2e --skip-nx-cache`, then `down -v` | "58 passed (33.2s)", no skip; `moderation.spec.ts` "moderation and admin flow against the real API (11.7s)"; volumes and network removed |
| 14 | Lighthouse, see the table below | all four categories at least 90 on all five pages except SEO 66 on the three sample-city pages (`is-crawlable`, by design) |
| 15 | JSON-LD, see below | 18 nodes on 8 pages, 0 failures |
| 16 | Mutation M1: stop-pairs memo never hits (`hit.expires > this.now()` changed to `hit.expires < 0` in `StopPairsCache.load`) | 3 red in `public-api.client.spec.ts` "stop pairs memoization": "shares one request between concurrent server calls", "expires after ten minutes on a fake clock", "keeps a failure for at most 30 seconds and then recovers"; restored, file hash `db3d80f0…` identical. These red tests had not been captured when the memo was added |
| 17 | Mutation M2: CSP nonce substitution unanchored again (the pre-review expression `((?:nonce\|ngcspnonce)=")PLACEHOLDER(")`) | 2 red: `csp-nonce.spec.ts` "never puts the live nonce into text nodes, whose quotes the server renderer leaves raw", `security-headers.spec.ts` "replaces only exact raw attributes and preserves escaped content"; restored, hash `a3bca7cb…` identical |
| 18 | Mutation M3: bypass bucket always grants (`tokens < 1` changed to `tokens < -1`) | 1 red: `normalize.spec.ts` "cache-bypass renders > limits bypass renders per client and answers 429 without rendering"; restored, hash `410ae8f2…` identical |

### Lighthouse

Setup: the production web build (`dist/apps/web/server/server.mjs`, `INECEKVAR_ENV=production`,
`IV_WEB_CANONICAL_ORIGIN=https://inecekvar.app`) on 127.0.0.1:58110 against the real API
(uvicorn 127.0.0.1:57947 on the freshly seeded `iv4e` stack), behind a local Caddy 2.11.7
container (`tls internal`, `encode zstd gzip`, published on 127.0.0.1:58114) as a stand-in for the
production proxy. Chrome resolved `inecekvar.app` to that port:

```
npx --yes lighthouse@13.5.0 https://inecekvar.app<path> \
  --only-categories=performance,accessibility,best-practices,seo --output=json \
  --chrome-flags="--headless=new --no-first-run --ignore-certificate-errors --host-resolver-rules=\"MAP inecekvar.app 127.0.0.1:58114\""
```

Mobile is the default (Moto G Power emulation, simulated slow 4G); desktop adds `--preset=desktop`.
Scores are performance / accessibility / best practices / SEO.

| Page | Path | Mobile | Desktop | Mobile FCP / LCP / TBT / CLS |
| ---- | ---- | ------ | ------- | ---------------------------- |
| Home | `/` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 1.4 s / 1.4 s / 50 ms / 0 |
| Sample city hub | `/ornek-test-sehri` | 100 / 100 / 100 / 66 | 100 / 100 / 100 / 66 | 1.4 s / 1.4 s / 30 ms / 0 |
| Line | `/ornek-test-sehri/hat/ornek-hat-1` | 100 / 100 / 100 / 66 | 100 / 100 / 100 / 66 | 1.4 s / 1.4 s / 30 ms / 0 |
| Stop | `/ornek-test-sehri/durak/ornek-durak-1-1` | 100 / 100 / 100 / 66 | 100 / 100 / 100 / 66 | 1.4 s / 1.4 s / 50 ms / 0 |
| Guide | `/rehber/dolmus-ve-minibus-hatti-nasil-okunur` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 1.4 s / 1.4 s / 40 ms / 0 |

- SEO 66 on the three sample-city pages: the only failing weighted audit is `is-crawlable`
  (`<meta name="robots" content="noindex,follow">`, decision 4). The same three pages with
  `--only-categories=seo --skip-audits=is-crawlable` score 100, so every other SEO audit passes.
  A non-sample city with published lines would be indexable; none exists, because real line data
  is not invented (section 0.4). The gate item "at least 90 on 5 pages" is therefore met on two
  pages for SEO and on all five for the other three categories.
- Before the fix (first run, `INECEKVAR_ENV=test` over plain HTTP through a gzip proxy): the guide
  had accessibility 91 (`color-contrast` on `.meta`, 4.42:1); every page had SEO 66 because the
  test environment's `robots.txt` is `Disallow: /` (by design outside production), and performance
  99. The TLS run above replaced it.
- The performance figures are simulated (Lantern) on this host, over loopback with a local
  certificate and no CDN; they are not field data.
- Reports (trimmed to versions, settings, category scores and audit scores, without screenshots
  and request lists) are in `docs/seo/lighthouse/`: `mobile-*.json`, `desktop-*.json`,
  `nocrawl-*.json` and `before-fix-mobile-guide.json`.

### JSON-LD

`node docs/seo/lighthouse/check-json-ld.mjs http://127.0.0.1:58115 <paths>` against a second
instance of the same build (`INECEKVAR_ENV=test`, same real API):

```
/  HTTP 200, 1 JSON-LD block(s)            ok Organization, ok WebSite, ok BreadcrumbList
/ornek-test-sehri                          ok BreadcrumbList
/ornek-test-sehri/hat/ornek-hat-1          ok BreadcrumbList, ok BusTrip
/ornek-test-sehri/durak/ornek-durak-1-1    ok BreadcrumbList, ok BusStop
/rehber/dolmus-ve-minibus-hatti-nasil-okunur  ok BreadcrumbList, ok Article
/sss                                       ok BreadcrumbList, ok FAQPage (15 questions)
/veri                                      ok BreadcrumbList, ok Dataset
/hakkinda                                  ok BreadcrumbList, Organization, WebApplication, MobileApplication
18 node(s) on 8 page(s), 0 failure(s)      exit 0
```

Negative check: an unknown line path (404, no block) prints `FAIL no structured data`, exit 1.
`npx structured-data-testing-tool@4.5.0 --url http://127.0.0.1:58115/sss` (and `/`, `/veri`, the
line page) ran offline but recognised 0 schema.org schemas in the one JSON-LD block it counted and
ran 0 pass/fail tests, so it validated nothing and is not counted:
`not exercised: an external schema validator`.

## Not exercised

- `not exercised: real TLS and HSTS preload` (local `tls internal` certificate only; the HSTS
  header value is asserted by the e2e, the preload list submission needs the domain).
- `not exercised: Search Console and the Rich Results Test` (no public host).
- `not exercised: iOS universal links` and verified Android App Links (no Apple team id, no
  release signing certificate, no public association files).
- `not exercised: a real authenticator app` (the e2e and the API tests compute codes with an
  RFC 6238 helper and `pyotp`).
- `not exercised: hosted Caddy` (the local Caddy container above and the e2e proxy have the same
  routing shape; no production configuration exists).
- `not exercised: a CDN` in front of the SSR pages and the static files.
- `not exercised: Lighthouse CI` (no CI step; the runs above are manual) and the CI run itself
  (branch not pushed at the time of writing).
- `not exercised: PNG Open Graph images`, axe (no package), Firefox and Safari.
- `not exercised: an indexable city in Lighthouse SEO` (only the sample city exists).

## Consequences

- Phase 4 gate: moderation e2e green against the real API; JSON-LD parses and carries the
  required properties on every page type; Lighthouse at least 90 in all four categories on two
  pages and in three categories on all five, with SEO 66 on the sample-city pages from the
  intended `noindex`.
- Open for the hosting work: admin origin, per-client bypass key through a trusted proxy header,
  production Caddy with compression and TLS, Lighthouse CI on a stable host.
- Open for the API owner: the gaps in decision 6.
