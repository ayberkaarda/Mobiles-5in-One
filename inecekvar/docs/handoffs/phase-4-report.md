# İnecek Var — Phase 4 Report

## Summary (5 lines max)

The Angular SSR web is built: city, line, stop and route pages with server-rendered SVG maps, five guides, FAQ, open-data and legal pages, sitemaps, robots, JSON-LD, OG images (SVG), `llms.txt`, app association files, and the client-only `/admin` with TOTP step-up; the API gained TOTP enrolment, session-bound step-up and the admin routes.
Gate: moderation e2e green against the real API (58 passed); JSON-LD parses with the required properties on 8 page types (18 nodes, 0 failures); Lighthouse 13.5.0 at least 90 in performance, accessibility and best practices on all 5 pages (all 100) and SEO 100 on 2 pages.
Open on the gate: SEO 66 on the three sample-city pages, caused by the intended `noindex` of the sample city (100 with that one audit skipped); no indexable city exists because real line data is not invented.
Workspace gate green: domain 4, data-access 110, ui 39, web 774, mobile 460 tests; API 709 passed, 0 skipped; gitleaks clean on the branch range.
Security matrix after phase 4: 9 done, 10 partial, 4 not-started.

## Files created / modified (grouped by owner, full paths)

Paths are under `inecekvar/`. Package-level lists are in ADR-0037 (4A) to ADR-0041 (4E).

**api (`api/`, package 4A)**: TOTP enrolment, AES-256-GCM secret storage with key rotation (`app/auth/totp*.py`, `python -m app.auth.totp_rotation`), session step-ups, admin routes (users, roles, exports, audit log), bounded stop search, city page data, `stop-pairs` and the sitemap index; migration `alembic/versions/0004_totp_step_up.py`; 9 new and 12 modified test files; dependency `pyotp`. Details: ADR-0037.

**web (`apps/web`, packages 4B to 4E)**: SSR server (`src/server/*`: helmet, per-response CSP nonce, page cache, URL normalization, request guards, bypass limiter, machine files, robots), public data client and SEO/JSON-LD services (`src/app/data`, `src/app/seo`), programmatic pages (`src/app/pages`), content and GEO files (`src/content/*`, `src/app/content/*`), the admin area (`src/app/admin/**`, `src/app/admin-entry.ts`), `scripts/check-public-bundle.mjs`, `eslint.config.mjs`, `project.json`; dependency `helmet` 8.3.0. Gate fix (4F): `src/app/content/site/content.page.ts` (`.meta` colour).

**ui (`libs/ui`)**: `src/lib/safe-svg.ts`, `src/lib/safe-svg.spec.ts`, `src/index.ts`.

**domain (`libs/domain`)**: `src/lib/api.ts` rebuilt from the contract.

**qa (`apps/web-e2e`, new project)**: `playwright.config.ts`, `fake-api.mjs`, `admin-proxy.mjs`, `stack-env.mjs`, `scripts/real-stack.mjs`, 13 specs under `src/`.

**web / seo docs**: `docs/seo/aso.md`, `docs/seo/checklist.md`, `docs/seo/lighthouse/` (check script and trimmed reports, 4F).

**lead / security docs**: `docs/adr/0037-totp-step-up-and-admin-api.md` to `docs/adr/0042-phase-4-gate.md`, `docs/api/openapi.json`, `docs/ops/env.md`, `docs/security/authorization-matrix.md` (4A), `docs/security/verification-matrix.md` (4F), `docs/handoffs/phase-4-report.md`, `docs/screenshots/phase4/*` (18 admin screens), `README.md`, `README.tr.md`, `.env.example`; repository root `README.md` and `README.tr.md` (the Inecek Var rows).

## Decisions & ADRs added

- ADR-0037 TOTP step-up and admin API; ADR-0038 SSR foundation; ADR-0039 programmatic pages and machine files; ADR-0040 content and GEO files; ADR-0041 moderation and admin UI; ADR-0042 the phase 4 gate.
- Gate decisions (ADR-0042): the cache-bypass render bucket keys on the TCP peer, so behind one proxy all clients share it (accepted as a global ceiling); Lighthouse 12+ has no PWA category (the web is not a PWA; the app's PWA score stays in ADR-0036); OG images stay SVG (no `sharp`); the sample city stays `noindex`; production should serve `/admin` from its own origin; the API gaps from ADR-0041 are listed for the API owner.
- Lanes: 4A was reviewed by the read-only review lane and its fixes written by the second writer lane; both lanes were out of quota from 2026-10-12 to 2026-10-18, so 4B to 4E were reviewed by a separate fresh reviewer session that wrote none of the code (11 findings, all fixed with named tests). The gate package had no independent review.

## Security checklist status

| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
| - | ---- | ------------------------------------- | ------------------------------ |
| 1 | Remove secrets from source | partial | env-only API secrets; web reads public `IV_WEB_*` values only; gitleaks 32 commits on the range, no leaks (ADR-0042); pre-commit and CI scan not exercised |
| 2 | Purge secrets from history | not-started | phase 6 |
| 3 | Define authorization rules | done | `test_policy_matrix.py` (ADR-0011, admin cells ADR-0037) |
| 4 | Enforce authorization on server | done | `test_idor.py` incl. 3 admin cases, `test_admin_routes.py`; UI guards UX only (ADR-0041) |
| 5 | Rate limit entry points | done | earlier tests plus TOTP, `stop-pairs`, export quotas (ADR-0037) and the SSR bypass bucket (`normalize.spec.ts`) |
| 6 | Validate input | partial | API tests; app mirrors; SSR URL guards and normalization (ADR-0038, ADR-0039) |
| 7 | Constrain uploads | done | `tests/media` (ADR-0023); R2 not exercised |
| 8 | Lock down CORS | done | `tests/core/test_cors.py`; the admin is same-origin through the proxy |
| 9 | Set security headers | done | `headers.spec.ts` "production security headers and per-response script nonces", `test_api_security_headers` (ADR-0042) |
| 10 | Require HTTPS | partial | native config (ADR-0036), SSR HSTS preload and `upgrade-insecure-requests`; public certificate, proxy redirect and iOS ATS not exercised |
| 11 | Hash passwords | partial | argon2id tests; TOTP AES-256-GCM tests (ADR-0037); live HIBP not exercised, dump test does not scan `totp_secret_enc` |
| 12 | Secure cookies | partial | cookie tests and client strategies; native secure storage against an API not exercised |
| 13 | Limit error details | done | `test_forced_exception_returns_generic_body`; generic SSR 500 page (`security-headers.spec.ts`); admin code mapping (ADR-0041) |
| 14 | Sanitize logs | partial | phase 1 and 2 log tests; TOTP secret log test (ADR-0037); Sentry phase 6 |
| 15 | Parameterize queries | partial | bound parameters, ruff S rules, stop-search injection mutation (ADR-0037); bandit and semgrep phase 6 |
| 16 | Escape against XSS | partial | lint bans, SVG and JSON-LD escaping, e2e "stored markup in line data renders as text"; payload sweep phase 6 |
| 17 | Verify webhook signatures | not-started | phase 5 |
| 18 | Assign admin roles | done | `test_admin_routes.py`, `tests/totp`, audit tests (ADR-0037); `moderation.spec.ts` against the real API (ADR-0042) |
| 19 | Audit packages | not-started | phase 6 |
| 20 | Automate backups | not-started | phase 6 |
| 21 | Delete accounts | partial | API and in-app flow; `/hesap-silme` web page without a form (ADR-0040); RevenueCat REST phase 5 |
| 22 | Set spending alerts | partial | application caps incl. export and bypass limits; cost guard phase 6 |
| 23 | Test as an attacker | partial | 4A white-box review and 4B to 4E independent review, all findings fixed; attack suite, ZAP, MobSF phase 6 |

Details: `docs/security/verification-matrix.md`. The authorization matrix was updated in 4A for the admin and step-up rules; 4B to 4F changed no rule (the web shows what the API decides).

## SEO/GEO status (Phase 4+)

| Item | Status |
| ---- | ------ |
| SSR city, line list, line, stop and route pages with SVG maps, no map JS until a click | done (ADR-0039; e2e `pages-no-js.spec.ts`, `line-map.spec.ts`) |
| Answer-first line summary 40 to 60 words | done (`line-summary.spec.ts`, e2e 49 words on the real sample line in ADR-0039) |
| Five guides of at least 600 words, `/sss` 15 Q&A, `/veri`, legal pages | done (ADR-0040; `content.spec.ts`) |
| Titles at most 60, descriptions at most 155, canonical, `hreflang tr-TR` + `x-default` | done (tests in ADR-0039, ADR-0040); `hreflang en`: none (no English pages) |
| Sitemap index, per-city sitemaps with API `lastmod`, `/sitemap-pages.xml`, robots | done (ADR-0039, ADR-0040) |
| JSON-LD `Organization`, `WebSite` + `SearchAction`, `BreadcrumbList`, `BusTrip`, `BusStop`, `Dataset`, `FAQPage`, `Article`, `WebApplication`, `MobileApplication` | done: 18 nodes on 8 pages pass `check-json-ld.mjs` (ADR-0042); external validator not exercised |
| OG images per line | partial: SVG only, no PNG |
| `llms.txt`, `llms-full.txt` | done (ADR-0040) |
| AASA and `assetlinks.json` | done in code, absent without the signing values; verification not exercised |
| Route pages `noindex` under 50 published lines; sample city `noindex` | done (ADR-0039) |
| Lighthouse at least 90 on 5 pages | performance, accessibility, best practices 100 on all 5 (mobile and desktop); SEO 100 on 2, 66 on 3 sample-city pages (`is-crawlable`, by design) |
| Search Console, Rich Results, live hreflang and canonical checks | not exercised: no public host |

## Tests executed (command + result counts)

| Command | Result |
| ------- | ------ |
| `pnpm nx run-many -t lint test build --skip-nx-cache` | exit 0, 5 projects; domain 4, data-access 110, ui 39, web 774, mobile 460 passed; lint clean (run twice, before and after the gate fix) |
| `uv run ruff check . && uv run ruff format --check . && uv run mypy --strict app tests alembic && uv run pytest -q` (Docker) | clean, 196 files; 709 passed in 410 s, 0 skipped |
| OpenAPI and API types freshness, tokens, Prettier, compose config | no diff; in sync; clean; valid |
| `pnpm nx run web:bundle-check` | "Public web bundle clean: 60 files, 5 markers" |
| CI placeholder and banned-word greps | no match |
| `gitleaks git ... --log-opts="origin/main..HEAD" .` | 32 commits, no leaks |
| `gitleaks git ... --config .gitleaks.toml --log-opts=--all .` | 1125 commits, 1 finding on a local-only Kadro branch (`feat/rc-delete-backup`); remote refs plus HEAD: 1091 commits, no leaks |
| `pnpm nx run web-e2e:e2e` (fake API) | 57 passed, 1 skipped (moderation needs the stack); 57 passed again after the fix |
| `real-stack.mjs up`, `IV_E2E_REAL_API=1 ... web-e2e:e2e`, `down -v` | 58 passed, moderation scenario 11.7 s |
| `npx lighthouse@13.5.0`, 5 pages, mobile and desktop, behind a local TLS proxy | see ADR-0042 table |
| `node docs/seo/lighthouse/check-json-ld.mjs` on 8 pages | 18 nodes, 0 failures |
| Mutations M1 (stop-pairs memo), M2 (unanchored nonce), M3 (bypass bucket) | 3, 2 and 1 named tests red; restored, hashes identical |

## Known gaps / risks

- SEO 66 on sample-city pages; Lighthouse SEO on an indexable city has not been measured.
- Performance scores are simulated on loopback with a local certificate and no CDN.
- Behind one proxy all clients share the cache-bypass bucket: a busy signed-in staff member or a crawler of bypassed URLs can exhaust it for everyone (429).
- The staff session cookie reaches the public SSR process while `/admin` shares the origin.
- `stop-pairs` IP quota applies to the SSR server's single address (memo in place; exemption proposed).
- No PNG OG images; no English pages; no external schema validation; no real authenticator app; Chromium only.

## Open questions / proposals (scope, cost, legal)

- API: author id on queue items; a presigned read for proposal photos; retired lines reachable for rollback; actor and target names on audit rows; exempt or size the SSR caller in the `stop-pairs` quota; a total count on `GET lines`.
- Hosting: an admin origin such as `yonetim.inecekvar.app`; a trusted client-address header from the proxy for the bypass bucket; production Caddy with compression and TLS; Lighthouse CI on a stable host.
- Cost: a PNG renderer (`sharp` or a worker) for OG images.
- Legal: KVKK notice, privacy text and the data licence remain drafts pending review (ADR-0003, ADR-0040); `/kullanim-kosullari` has no draft.

## Proposed Conventional Commits (not executed)

Packages 4A to 4E and both review rounds are committed locally (see `git log origin/main..HEAD`). The gate adds:

- `fix(web): use the text colour for the content page date line`
- `docs: record the phase 4 gate, the report, the security matrix and the readme status`

## Next phase preview (3 lines)

Phase 5: RevenueCat webhook with reconciliation and server-side pack entitlement gating.
Resend webhook with Svix signature checks and the suppression list.
Nightly jobs; gate: webhook and entitlement tests green.

STOPPED — waiting for "devam".
