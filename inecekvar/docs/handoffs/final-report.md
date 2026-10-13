# İnecek Var — Phase 6 Report (FINAL REPORT)

## Summary (5 lines max)

Phases 0 to 6 are built: API core and dual auth, domain and planner, the Ionic app and PWA, the SSR web with SEO/GEO pages and the admin, webhooks and entitlements, and the phase 6 hardening.
Merged into `main`: all phases 0 to 6 (PRs #118, #119, #120 and #121, #123, #126, #127 and #128), followed by the test flake fix #129, the README gallery and branded web home #130 and the visual redesign #131.
Phase 6 gate: API 1195 passed, 0 skipped; Nx lint, test and build green (web 797, mobile 472 tests); web e2e 64 and mobile e2e 10 passed on the real stack; scans, audits, gitleaks and the restore drill with six negative runs clean.
Final security matrix: 15 done, 8 partial, 0 not-started. **This is not 23 of 23**: the partial rows need hosting, the domain and TLS, R2, provider accounts, GitHub runs, macOS and iOS, legal texts and owner decisions.
An independent review of phase 6 found 15 issues (none high); all are addressed, each with a test that is red when the fix is reverted (ADR-0058).

## Files created / modified (grouped by owner, full paths)

Paths are under `inecekvar/`.

### What was built, phase by phase

| Phase | Built | PR | State |
| --- | --- | --- | --- |
| 0 Foundation | Nx workspace (`apps/mobile`, `apps/web`, `libs/`), `api/` with uv, `CONTRIBUTING.md`, ADR-0001 to ADR-0005, brand, `docker-compose.yml`, `ops/Caddyfile`, CI skeleton | #118 | merged |
| 1 API core and security baseline | Alembic schema with PostGIS, sample city seed, password and magic-link auth in cookie and bearer mode, CSRF, refresh rotation, rate limits, validation, headers and CORS, problem details, log masking, policy table, IDOR harness (ADR-0006 to ADR-0012) | #119 | merged |
| 2 Domain | cities, lines, stops, versions, edits and moderation, traces, photos, favorites, planner, packs, weekly export and sitemaps, deletion flow, OpenAPI and TS types (ADR-0020 to ADR-0029) | #120, #121 | merged |
| 3 Ionic app | design system, search and map, line and stop pages, planner UI, offline packs, contributor tools, auth strategies, favourites, settings and deletion, deep links, Plus paywall, tr and en (ADR-0030 to ADR-0036) | #123 | merged |
| 4 SSR web and admin | city, line, stop and route pages with SVG maps, guides, legal pages, sitemaps, JSON-LD, OG, `llms.txt`, association files, moderation and admin UI with TOTP step-up (ADR-0037 to ADR-0042) | #126 | merged |
| 5 Webhooks and entitlements | RevenueCat and Resend webhooks, reconciliation, Plus entitlement, suppression list, nightly jobs (ADR-0050) | #127 | merged |
| 6 Hardening and release readiness | security workflow and scans, attack suite and XSS sweep, transport and CSP with ZAP and MobSF, backups and restore drill, cost guards and degrade mode, release documents and purge runbook, web deletion and bootstrap, review fixes, final matrix (ADR-0051 to ADR-0058) | #128 | merged |

### Phase 6 files

**api**: `api/app/core/{client_ip,https,logging,deps,settings}.py`, `api/app/planner/{degrade,service}.py`, `api/app/workers/{cost_guard,backup_verify,main}.py`, `api/app/ops/{bootstrap,planner_degrade}.py`, `api/app/me/deletion.py`, `api/app/core/url_guard.py`, `api/app/auth/{router,totp_router}.py`, `api/app/main.py`; tests under `api/tests/security/`, `api/tests/core/`, `api/tests/workers/`, `api/tests/planner/`, `api/tests/ops/`, `api/tests/deletion/`.

**ops**: `ops/backup/*` (backup, bucket setup, restore, restore drill, deletion and cancellation replay, drill e2e, shell checks), `ops/Caddyfile`, `ops/security/{zap,mobsf,semgrep,tools}/`, `ops/security/caddy-check.sh`, `ops/release/check-release-docs.mjs`, `docker-compose.yml`, `.github/workflows/inecekvar-security.yml`, `.github/workflows/inecekvar-restore-drill.yml`.

**apps**: `apps/mobile` (PWA CSP check, Android cleartext and backup guards, inert error scrub), `apps/web` (client-only deletion panel on `/hesap-silme`, bundle check, inert error scrub), `apps/web-e2e` (XSS sweep, deletion scenario, `iv6g` stack), `apps/mobile-e2e` (XSS sweep, CSP spec).

**docs**: `docs/adr/0051` to `0058`, `docs/security/{verification-matrix,attack-report,xss-sweep,input-constraints,pentest-report,dependency-audit,history-purge-runbook,threat-model}.md`, `docs/security/scan-reports/`, `docs/ops/{backup-restore,cost-alerts,logging,env}.md`, `docs/release/*`, `docs/seo/{aso,checklist}.md`, this report; `README.md`, `README.tr.md` and the root README rows.

## Decisions & ADRs added

- ADR-0051 supply chain and static scans; ADR-0052 attack suite and XSS sweep (amended: two-tier IPv6 limits); ADR-0053 backups and restore drill (amended: 30-day noncurrent retention, tamper checks, strict replay check, safer restore, cancellations list); ADR-0054 cost guards, degrade mode and log scrub (amended: computed plans of the current hour, forced degrade alert and attack cost, scrub of every value type); ADR-0055 transport, CSP and dynamic scans (amended: `--no-proxy-headers` everywhere with a smoke check, fixed redirect hosts, closed `.well-known` space); ADR-0056 release documents and purge runbook; ADR-0057 web deletion and bootstrap (amended: address from stdin or the environment); ADR-0058 the phase 6 gate.

### Lanes and reviews per phase

The second writer lane and the read-only review lane were out of usage quota from the evening of 2026-10-12 to 2026-10-18; where they were missing, the lead lane wrote and a fresh reviewer session that wrote none of the code reviewed.

| Phase | Written by | Reviewed by |
| --- | --- | --- |
| 0 to 2 | not recorded per package in the repository (single commit author, no handoff files) | white-box reviews of the phase 1 API and the phase 2 diff, fixes with named tests (ADR-0020 to ADR-0026) |
| 3 | writer lanes for bulk code and the lead lane for gates; 3G by the lead lane with some unit specs from the second writer lane (ADR-0036) | review rounds per package (ADR-0031 to ADR-0035) |
| 4 | 4A not recorded per package; 4A fixes by the second writer lane; 4B to 4E partly the writing lane (ADR-0039); 4F the lead lane | 4A by the read-only review lane (8 findings); 4B to 4E by a fresh reviewer session (11 findings) (ADR-0042) |
| 5 | the lead lane (writer lanes out of quota) | an independent review lane, 12 findings fixed with revert-checked tests (ADR-0050) |
| 6 | 6A to 6G and the review fixes by the lead lane (second writer lane out of quota) | the read-only review lane in a fresh session, 15 findings, all addressed (ADR-0058); the fixes were not re-reviewed, each has a named test and a revert check |

Gates of every phase were run by the lead lane.

## Security checklist status

| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
| --- | --- | --- | --- |
| 1 | Remove secrets from source | partial | env-only secrets, gitleaks range and `--remotes HEAD` clean at the gate; CI history scan not run on GitHub |
| 2 | Purge secrets from history | partial | `history-purge-runbook.md`; purge not executed by design (owner decision) |
| 3 | Define authorization rules | done | `test_policy_matrix.py` (ADR-0011) |
| 4 | Enforce authorization on server | done | `test_idor.py`, `test_admin_routes.py` |
| 5 | Rate limit entry points | done | per IP and per email; IPv4-mapped peers; IPv6 two tiers (ADR-0052 decision 9) |
| 6 | Validate input | done | `input-constraints.md`, `test_field_bounds_are_refused` |
| 7 | Constrain uploads | done | `tests/media` (ADR-0023) |
| 8 | Lock down CORS | done | `tests/core/test_cors.py` |
| 9 | Set security headers | done | API, SSR and PWA CSP tests (ADR-0055) |
| 10 | Require HTTPS | partial | local Caddy and API refusal tested; public TLS, production Caddyfile and iOS missing |
| 11 | Hash passwords | done | Argon2id, `pg_dump` scan (ADR-0052) |
| 12 | Secure cookies | done | `test_cookie_attributes` (ADR-0008) |
| 13 | Limit error details | done | `test_forced_exception_returns_generic_body` |
| 14 | Sanitize logs | done | inert scrub helpers, no Sentry SDK in apps; log scans and scrub tests (ADR-0054) |
| 15 | Parameterize queries | done | bandit and semgrep clean at the gate |
| 16 | Escape against XSS | done | XSS sweep (ADR-0052) under the PWA CSP |
| 17 | Verify webhook signatures | done | `tests/webhooks/*` (ADR-0050) |
| 18 | Assign admin roles | done | `test_admin_routes.py`, TOTP step-up (ADR-0037) |
| 19 | Audit packages | partial | pnpm audit, pip-audit, osv-scanner clean at the gate; workflow not run on GitHub; accepted risks expire 2027-01-13 |
| 20 | Automate backups | partial | `drill-e2e.sh` and six negative runs at the gate; no PITR, R2, key custody, host |
| 21 | Delete accounts | partial | in-app and web deletion, replay of deletions and cancellations; real RevenueCat, contact channel, legal texts missing |
| 22 | Set spending alerts | partial | `cost.guard` and degrade mode; no CPU alert, provider budgets or collector |
| 23 | Test as an attacker | partial | attack suite, ZAP, MobSF, pentest report, independent review; no CI scans, IPA or hosted target |

Full evidence and residuals per row: `docs/security/verification-matrix.md`.

## SEO/GEO status (Phase 4+)

SSR city, line, stop and route pages with SVG maps, five guides, FAQ, open-data and legal pages, sitemaps with honest `lastmod`, robots, JSON-LD (18 nodes on 8 page types pass `check-json-ld.mjs`), `llms.txt` and `llms-full.txt`, association files: done (ADR-0039, ADR-0040, ADR-0042). Lighthouse 100 in performance, accessibility and best practices on 5 pages; SEO 66 on the `noindex` sample-city pages by design. Phase 6 added the ASO notes, store copy in tr and en and the privacy labels (ADR-0056); the PWA host now serves the association files with an hour of caching (ADR-0055 decision 11). Needs a public URL: Search Console, Rich Results, external validators. OG images are SVG only.

## Tests executed (command + result counts)

Phase 6 gate, 2026-10-13, branch `feat/inecekvar-p6` (full commands and tails in ADR-0058):

| # | Gate | Command | Tail |
| --- | --- | --- | --- |
| 1 | API | in `api/`: `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run ruff check . && uv run ruff format --check . && uv run mypy --strict app tests && uv run pytest -q` | `All checks passed!`, `243 files already formatted`, `Success: no issues found in 236 source files`, `1195 passed in 636.31s (0:10:36)`, 0 skipped (1121 at ADR-0054, 943 at phase 5) |
| 2 | Nx workspace | `pnpm nx run-many -t lint test build --skip-nx-cache` (every project with these targets: domain, data-access, ui, web, mobile; the two e2e projects have only `e2e`) | `Successfully ran targets lint, test, build for 5 projects and 1 task they depend on`; tests: domain 4, data-access 110, ui 39, web 797 (48 files), mobile 472 (26 files); both production builds ran; every lint `All files pass linting` |
| 3 | Bundle boundary | `pnpm nx run web:bundle-check` | `deletion panel chunks (lazy, browser only): chunk-BtheHg7O.js; initial browser chunks: 4; marked chunks: 3.` `Public web bundle clean: 63 files, 6 markers.` |
| 4 | Web e2e, real stack | `IV_E2E_STACK=iv6g node apps/web-e2e/scripts/real-stack.mjs up` (compose project `iv6g` on 127.0.0.1 58951-58956, fresh database, migrations, sample seed, Redis flushed), then `IV_E2E_STACK=iv6g IV_E2E_REAL_API=1 pnpm nx run web-e2e:e2e --skip-nx-cache` (uvicorn on 58957 with `--no-proxy-headers`) | `64 passed (1.3m)` |
| 5 | Mobile e2e, real stack | fresh `iv6g` stack again, Redis flushed, uvicorn on 58957 (`--no-proxy-headers --forwarded-allow-ips 127.0.0.1`) and the `arq` worker with `INECEKVAR_PRESIGN_TTL_SECONDS=30` (ADR-0035), then `IV_E2E_API=http://127.0.0.1:58957 IV_E2E_MAIL=http://127.0.0.1:58956 IV_E2E_PSQL_CONTAINER=iv6g-postgres-1 IV_E2E_ORIGIN=http://localhost:8100 IV_E2E_UPLOAD_ORIGIN=http://127.0.0.1:58953 IV_E2E_PORT=58990 pnpm nx run mobile-e2e:e2e --skip-nx-cache` | `PWA CSP check passed: 1 inline script hash(es) match ops/Caddyfile`, `10 passed (2.8m)`. Earlier attempts in this session failed for setup reasons, recorded honestly: missing `IV_E2E_MAIL`/`IV_E2E_ORIGIN` (sign-in 403 from the origin check), a reused database after web e2e (pack at version 3), an API process that kept Redis connections across a stack reset (500), and the presign window not shortened (photo never processed). Each was a run setup issue, not a code change; the screenshots the specs rewrite were restored from git. Everything stopped afterwards (`real-stack.mjs down`, processes stopped by command line, no container left) |
| 6 | semgrep | `docker run semgrep/semgrep:1.179.0@sha256:9396... semgrep --test ops/security/semgrep` and `semgrep scan --error --config ops/security/semgrep api/app apps libs` | `12/12: ✓ All tests passed`; `Ran 12 rules on 467 files: 0 findings.` exit 0 |
| 7 | bandit | `bandit -r api/app -ll` (1.9.4 from the hash-locked `ops/security/tools/requirements.txt`) | `No issues identified.` Medium 0, High 0, Low 1 (accepted B105), exit 0 |
| 8 | pip-audit | `pip-audit --strict --disable-pip --no-deps -r <uv export --frozen --no-hashes --no-emit-project --all-groups>` (2.10.1, 241 lines) | `No known vulnerabilities found`, exit 0 |
| 9 | pnpm audit | `pnpm audit --audit-level=high`; `pnpm audit --prod` | `1 vulnerabilities found`, `Severity: 1 moderate`, `1 ignored: 1 high`, exit 0; `--prod`: `No known vulnerabilities found` |
| 10 | osv-scanner | `osv-scanner scan --config=ops/security/osv-scanner.toml --lockfile=pnpm-lock.yaml --lockfile=api/uv.lock` (2.6.0, SHA-256 `e0ed7644...` as in `dependency-audit.md`) | `Filtered 3 vulnerabilities from output`, `No issues found`, exit 0 |
| 11 | gitleaks | from the repository root with `.gitleaks.toml`: `gitleaks git --no-banner --redact --log-opts="origin/main..HEAD" .` and `--log-opts="--remotes HEAD"` (8.30.1), rerun after the last commit of this gate | branch range `68 commits scanned.` `no leaks found`; `--remotes HEAD` `1161 commits scanned.` `no leaks found` (before the commit that wrote these numbers; rerun after it, same result) |
| 12 | Backups | `bash ops/backup/checks.test.sh`; shellcheck from the digest-pinned image; `bash ops/backup/drill-e2e.sh` with the age 1.3.2 binaries of the earlier package (`INECEKVAR_BACKUP_AGE_BIN`, `INECEKVAR_DRILL_AGE_KEYGEN_BIN`; nothing installed globally) on ports 58791 and 58792; the six `INECEKVAR_DRILL_MUTATION` runs | `checks: 90 passed, 0 failed`; shellcheck exit 0; `deletions_after_dump_reapplied pass replayed 1, carried 0, absent 0, cancelled 1 of 2`, `RESULT: restore drill passed`, `RESULT: end-to-end drill passed`; corrupt-dump `restore: FAIL checksum mismatch`, wrong-identity `restore: FAIL age could not decrypt`, drop-stop `published_line_at_least_2_stops FAIL`, plain-totp `totp_secret_still_ciphertext FAIL`, empty-table `required_tables_not_empty FAIL`, skip-replay `deletions_after_dump_reapplied FAIL replay-deletions.sh exited 1`, each exit 1 |
| 13 | Caddy | `docker compose -p iv6c up -d caddy` (ports 58180, 58181, 58543, 58544) with a stub upstream, `bash ops/security/caddy-check.sh` | `caddy checks passed` (6 ok); with the previous Caddyfile 5 of 6 failed; project removed |
| 14 | Placeholder and banned words | the two `git grep` commands of the `Inecek Var checks` job in `inecekvar-ci.yml` | placeholder markers: no match (exit 1 of `git grep`, i.e. clean); the filler-text check: no match; banned words: no match |
| 15 | Release documents | `node ops/release/check-release-docs.mjs` | `env keys: 67 named, 67 in docs/ops/env.md, 0 only elsewhere`, `uvicorn start commands: 10, all with --no-proxy-headers`, `release docs check passed (6 warnings)` (the owner's 2.22 screenshot ratio; title 36 characters reported as an owner decision) |

Per-package evidence of 6A to 6G: ADR-0051 to ADR-0057; earlier gates: ADR-0029, ADR-0036, ADR-0042, ADR-0050.

## Known gaps / risks

Not exercised, by reason:

- No host or domain: public TLS, HSTS preload, the production Caddyfile (release checklist G2), a CPU alert, log retention on a collector, the backup host, its cron and alert rule, headers through a CDN.
- No provider accounts: Cloudflare R2 (versioning, Object Lock, lifecycle over real time), RevenueCat, Resend and Sentry with real payloads, provider budgets, the live HIBP API, Search Console.
- Branch not pushed: GitHub runs of `inecekvar-security.yml` and `inecekvar-restore-drill.yml`, ZAP and MobSF in CI.
- No macOS host: iOS build, ATS, universal links, MobSF on an IPA, CocoaPods audit.
- Not on a device: native secure storage against a real API, payloads in native WebViews, a real authenticator app, store submissions.
- Residuals stated in the documents: two attacker addresses at the plan limit can force a degrade with the default threshold; rotation inside one IPv6 /64 buys up to 20 times one address's auth quota; a cancellation after a dump is re-applied only when its record survives; re-applying a carried request's cancellation has not run against a real database.

## Open questions / proposals (scope, cost, legal)

Decisions for the owner:

1. Store title: the specification title is over the 30-character store limit; pick one of the options in `docs/release/store-listing.tr.md`.
2. Legal texts: KVKK notice and privacy policy are drafts (`docs/release/legal-open-items.md`); the backup retention wording changed to "up to 60 days" with the review fixes.
3. Signing certificate fingerprints and the Apple team id for the association files (`IV_WEB_ANDROID_CERT_SHA256`, `IV_WEB_IOS_TEAM_ID`).
4. A contact channel (support address) for the store listing and for deletion requests from people who cannot sign in (L6).
5. The production Caddyfile (or the hosting configuration) importing the same snippets, reviewed in the repository before item 10 is done.
6. Accepted risks with expiry 2027-01-13 (braces, uuid, bandit B105; `docs/security/dependency-audit.md` section 4): renew or remove.
7. Whether to run the history purge (no finding requires it; it rewrites every project's history).
8. Hosting, R2 with Object Lock, the production age identity custody, provider accounts and budgets, and the planner load threshold for the expected attacker size.

## Proposed Conventional Commits (not executed)

The phase 6 work is committed locally on `feat/inecekvar-p6`; nothing was pushed. Proposed pull request: `Inecek Var phase 6: hardening, release readiness and the final verification matrix`, after #127 merges (the branch contains the phase 5 commits).

## Next phase preview (3 lines)

Merge #127, push `feat/inecekvar-p6`, open the phase 6 pull request and watch the first runs of the security and restore drill workflows.
Owner infrastructure: host, domain, production Caddyfile, R2 with Object Lock, provider accounts; then rerun the matrix rows that wait on them.
Release: legal texts, store title and contact channel, signing values, iOS on a macOS host.

STOPPED — waiting for "devam".
