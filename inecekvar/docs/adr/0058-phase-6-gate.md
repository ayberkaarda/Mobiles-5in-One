# ADR-0058: Phase 6 gate (hardening and release readiness)

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 6 (spec items 2, 16, 19, 20, 22, 23 and the final verification matrix)

## Context

Phase 6 ran as packages 6A to 6G (ADR-0051 to ADR-0057): supply chain and static scans, the
attack suite and stored-XSS sweep, transport and CSP with ZAP and MobSF, backups and the restore
drill, cost guards and degrade mode with the log scrub, release documents and the history-purge
runbook, the web deletion panel and the first-run bootstrap. An independent reviewer that wrote
none of the phase 6 code then reviewed the 6A to 6G diff (15 findings, none rated high). This ADR
records the review fixes, the gate commands with their output, and the final state of the
23-item matrix (`docs/security/verification-matrix.md`).

## Decision

1. **Every review finding is addressed in code or documents, each with a test that is red when
   the fix is reverted** (shell fixes: a negative run of the script). The lead's decisions per
   finding are recorded in the ADR each fix amends; the table below links them.
2. **The two-tier IPv6 limit was implemented** (F8): the limiter takes a rule and a subject, so a
   second window per /64 at 20 times the limit was a small change (ADR-0052 decision 9).
3. **The matrix is final at 15 done, 8 partial, 0 not-started.** No status was raised at this
   gate; the review fixes strengthen rows 5, 10, 14, 20, 21 and 22 without closing the external
   checks that keep eight rows partial (hosting, domain and TLS, R2, provider accounts, GitHub
   runs, macOS and iOS, legal texts and owner decisions).

### Review findings, fixes, tests and revert checks

| # | Finding (severity) | Fix | Test (red when reverted) | Revert check |
| --- | --- | --- | --- | --- |
| F1 | Unauthenticated degrade with amplification (medium) | count only computed plans, current hour only, forced degrade logs `cost.guard.alert`; attack cost in ADR-0054 decision 10, threshold rule in `docs/ops/env.md` | `test_only_the_current_hour_counts_for_the_load`, `test_forced_degrade_is_an_alert_line`, `test_one_hour_of_load_ends_after_one_cool_down`, `test_planner_counts_only_computed_plans_in_the_hour_bucket` | source reverted: 4 failed, 29 passed |
| F2 | IPv4-mapped proxy peer not trusted (medium) | `unwrap_mapped` before the trusted-proxy test in `client_ip.py` and `https.py`; dual-stack note in `docs/ops/env.md` | `test_resolve_client_ip[::ffff:127.0.0.1-...]` and two more cases, `test_effective_scheme[http-::ffff:127.0.0.1-...]`, `test_ipv4_mapped_proxy_peer_is_trusted` | source reverted: 6 failed, 33 passed |
| F3 | Overwrite of dumps undetected, 1-day noncurrent retention (medium) | noncurrent retention 30 days (Object Lock noted as stronger); `backup.verify` alerts `future_stamp`, `stamp_skew` and `changed` (ETag and size per key in Redis) | `test_future_key_stamp_alerts`, `test_stamp_far_from_last_modified_alerts`, `test_changed_etag_or_size_of_a_seen_key_alerts`, `test_seen_listing_is_kept_in_redis_and_alerts_once`, `test_job_lists_a_real_bucket` (real MinIO overwrite reads `changed`) | change check off: 3 failed; stamp checks off: 2 failed |
| F4 | Restore drill replay check could pass vacuously (medium) | the replay exit status is read, state lines must equal list lines, an empty list is `skip` | `checks.test.sh`: the half-way kill negative run (psql stand-in dies on the second of three accounts), `fewer state lines than list lines fail`, `a failed replay fails even with good lines`, `an empty list is a skip` | status ignored: 2 cases red; line count ignored: 2 red; empty passes: 1 red |
| F5 | Scrub bypass for bytes, sets, exceptions and key names (low) | decode bytes, sets and tuples as lists, `Type: message` for exceptions, `str()` otherwise, text rules on every string leaf, secret key families by substring | `test_secret_key_families_are_dropped_by_substring` (10 names), `test_bytes_sets_exceptions_and_other_objects_are_scrubbed`, `test_secret_pairs_inside_text_are_redacted`, `test_exception_and_bytes_never_reach_the_production_stream` | source reverted: 12 failed, 25 passed |
| F6 | Restore picks a planted far-future dump (low) | `restore.sh` reads `LastModified` (`mc stat`), refuses future or skewed stamps, prints the key and requires `--yes` or a typed confirmation unless the target is the drill container | `checks.test.sh`: `dump_time_problem` cases (future, overwritten, unreadable, impossible), `a production target without --yes and without a terminal is refused` | future allowed: 1 red; skew allowed: 1 red; guard off: 1 red |
| F7 | Cancelled-after-dump residual was manual (low) | API logs `auth.account.delete_cancelled` with `user_id`; `replay-deletions.sh` takes a cancellations list (latest event wins, `replay-cancellation.sql` for carried requests); residual stated in `backup-restore.md` and `privacy-labels.md` | `test_login_during_grace_cancels_deletion` (log line asserted); `checks.test.sh`: `a request cancelled later is not re-applied`, `a request made again after a cancellation is still missing`, `a carried request cancelled after the dump must be re-applied`; drill: `d003 cancelled` | log removed: 2 failed; cancellations ignored: 1 red |
| F8 | One /64 shares auth windows (low) | two tiers for IPv6 auth and plan rules, address first then a /64 ceiling at 20 times (ADR-0052 decision 9) | `test_rate_limit_subjects_two_tier_for_ipv6_only`, `test_one_host_on_a_shared_64_cannot_lock_out_its_neighbours`, `test_rotation_inside_one_64_meets_the_ceiling`, `test_ipv6_address_window_mapped_ipv4_alias_and_shared_64_neighbours` | one /64 window again: 4 failed; ceiling checked first: 2 failed |
| F9 | Start commands omitted `--no-proxy-headers` (low) | `--no-proxy-headers --forwarded-allow-ips 127.0.0.1` in README, CONTRIBUTING, env.md, compose header, logging.md, release checklist, web e2e stack and the `main.py` docstring; release checklist smoke check; ADR-0055 wording fixed | `check-release-docs.mjs` check 4 (every uvicorn command carries the flag); executed smoke check straight to uvicorn | flag removed from README: `FAIL README.md: uvicorn command without --no-proxy-headers`; default flags: spoofed proto 404 instead of 403 |
| F10 | Redirect to client Host; production Caddyfile absent (low) | redirects to `INECEKVAR_WEB_CANONICAL_HOST` / `INECEKVAR_APP_CANONICAL_HOST`; `/.well-known/*` out of the SPA rewrite; `Cache-Control: public, max-age=3600` on the association files; release checklist G2 states the production Caddyfile is a pre-release item for item 10 | `ops/security/caddy-check.sh` against the running compose `caddy` (6 checks) | previous Caddyfile: 5 of 6 checks failed |
| F11 | Shellcheck image tag-pinned (low) | pinned by digest `sha256:61862eba...` in `inecekvar-restore-drill.yml` | shellcheck ran clean from the digest | not applicable (a pin, no behaviour) |
| F12 | Stale documents (low) | privacy labels section 4 (M5 resolved), pentest P16 lists `8197119d`, `17ea86d5`, `4da3e910` and the allowlist commits `b999e865`, `5b8d5338`, `6c5883ee`; attack suite count 98 (collected) | `pytest --collect-only tests/security/test_attack_suite.py`: `98 tests collected` | not applicable (documents) |
| F13 | Row 14 wording (low) | "inert scrub helpers, no Sentry SDK in apps" first in matrix row 14 and ADR-0054 decision 8 | not applicable | not applicable |
| F14 | Association responses and `.well-known` space (info) | covered by F10 | `caddy-check.sh` | with F10 |
| F15 | Bootstrap address on the command line, unbounded stdin (info) | `--email-stdin`, `INECEKVAR_BOOTSTRAP_EMAIL`, 1024-character bound per stdin line (ADR-0057 decision 7) | `test_address_from_stdin_or_environment_stays_off_the_command_line`, `test_stdin_lines_are_bounded_and_checked` (4 cases), `test_email_and_email_stdin_are_exclusive` | source reverted: red (failures and errors) |

Nothing from the review is left unaddressed. What stays open is external (see the matrix and
the final report): the production Caddyfile, hosting, R2, provider accounts and owner decisions.

## Evidence

Workstation (Windows 11, Docker Desktop, Git Bash, uv, Python 3.12, Node 22, pnpm 12), branch
`feat/inecekvar-p6`, 2026-10-13.

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
| 11 | gitleaks | from the repository root with `.gitleaks.toml`: `gitleaks git --no-banner --redact --log-opts="origin/main..HEAD" .` and `--log-opts="--remotes HEAD"` (8.30.1), rerun after the last commit of this gate | @@GITLEAKS@@ |
| 12 | Backups | `bash ops/backup/checks.test.sh`; shellcheck from the digest-pinned image; `bash ops/backup/drill-e2e.sh` with the age 1.3.2 binaries of the earlier package (`INECEKVAR_BACKUP_AGE_BIN`, `INECEKVAR_DRILL_AGE_KEYGEN_BIN`; nothing installed globally) on ports 58791 and 58792; the six `INECEKVAR_DRILL_MUTATION` runs | `checks: 90 passed, 0 failed`; shellcheck exit 0; `deletions_after_dump_reapplied pass replayed 1, carried 0, absent 0, cancelled 1 of 2`, `RESULT: restore drill passed`, `RESULT: end-to-end drill passed`; corrupt-dump `restore: FAIL checksum mismatch`, wrong-identity `restore: FAIL age could not decrypt`, drop-stop `published_line_at_least_2_stops FAIL`, plain-totp `totp_secret_still_ciphertext FAIL`, empty-table `required_tables_not_empty FAIL`, skip-replay `deletions_after_dump_reapplied FAIL replay-deletions.sh exited 1`, each exit 1 |
| 13 | Caddy | `docker compose -p iv6c up -d caddy` (ports 58180, 58181, 58543, 58544) with a stub upstream, `bash ops/security/caddy-check.sh` | `caddy checks passed` (6 ok); with the previous Caddyfile 5 of 6 failed; project removed |
| 14 | Placeholder and banned words | the two `git grep` commands of the `Inecek Var checks` job in `inecekvar-ci.yml` | placeholder markers: no match (exit 1 of `git grep`, i.e. clean); `lorem`: no match; banned words: no match |
| 15 | Release documents | `node ops/release/check-release-docs.mjs` | `env keys: 67 named, 67 in docs/ops/env.md, 0 only elsewhere`, `uvicorn start commands: 10, all with --no-proxy-headers`, `release docs check passed (6 warnings)` (the owner's 2.22 screenshot ratio; title 36 characters reported as an owner decision) |

## Lanes

| Work | Written by | Reviewed by | Gates run by |
| --- | --- | --- | --- |
| 6A to 6G (ADR-0051 to ADR-0057) | the lead lane (the second writer lane was out of quota until 2026-10-18) | the independent read-only review lane: a fresh reviewer session that wrote none of the phase 6 code (15 findings) | lead lane |
| Review fixes F1 to F15, this ADR, the final matrix and report | the lead lane (one worker session) | not re-reviewed; each fix has a named test and a revert check (table above) | lead lane |

## Consequences

- Phase 6 code is complete for what can be built and executed without a host; the matrix is
  final at 15 done, 8 partial. The open rows need the owner's infrastructure and decisions.
- Two privacy statements changed with the review fixes: encrypted backups live up to about 60
  days (30 current, 30 as a noncurrent version) and the cancellation residual is stated; the
  public content pages were not changed (owner decision with the legal texts).

## Not exercised

Production hosting, the public domain, real TLS and HSTS preload, the production Caddyfile,
Cloudflare R2 (versioning, Object Lock), real RevenueCat, Resend and Sentry accounts, a CPU
alert, GitHub runs of `inecekvar-security.yml` and `inecekvar-restore-drill.yml` (branch not
pushed), iOS (no macOS host), store submissions, legal texts.
