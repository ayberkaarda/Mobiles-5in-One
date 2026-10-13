# ADR-0051: Supply chain and static scans

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 6, package 6A (spec items 15 and 19; evidence for items 1 and 2)

## Context

Section 6 item 15 asks for bound parameters only, checked by `bandit` and a `semgrep` rule that
flags f-strings passed to `text()`/`execute()`; done means "semgrep and bandit clean". Item 19
asks for `pnpm audit --audit-level=high`, `pip-audit` on the `uv.lock` export (fail on High and
Critical), `osv-scanner` on all lockfiles, Renovate and an optional CycloneDX SBOM; done means "CI
workflow + reports". Item 1 needs the gitleaks pre-commit hook and CI scan, item 2 the CI history
scan. Section 12 requires `pnpm audit`, `pip-audit`, `osv-scanner` and `gitleaks` clean. The
sibling projects already run `askida-security.yml`, `kadro-security.yml` and
`cetele-security.yml`; ADR-0005 governs evidence.

## Decision

1. **One security workflow with one gate.** `.github/workflows/inecekvar-security.yml` follows the
   sibling pattern: no path filter on `pull_request` and `push` so the "Inecek Var Security gate"
   always reports; a `changes` job decides from `git diff --quiet` over `inecekvar/`,
   `.github/workflows/inecekvar-*.yml` (this file included), `.gitleaks.toml` and
   `renovate.json`; weekly cron (Monday 05:29 UTC) and `workflow_dispatch` run everything; the
   gate requires every scan job to be `success` when Inecek Var changed and `skipped` otherwise.
   Jobs: `gitleaks`, `pnpm-audit`, `pip-audit`, `osv-scanner`, `bandit`, `semgrep`, `sbom`.
   Permissions `contents: read`, checkouts without persisted credentials.
2. **Everything pinned and verified.** Actions by commit SHA (same SHAs as the siblings);
   gitleaks 8.30.1 and osv-scanner 2.6.0 downloads checked with `sha256sum --check --strict`;
   semgrep 1.179.0 by image digest; bandit, pip-audit and cyclonedx-bom from a hash-locked
   `ops/security/tools/requirements.txt` installed with `--require-hashes`.
3. **pnpm audit covers development dependencies too.** The build and test tool chain runs on
   developer machines and CI runners, so `pnpm audit --audit-level=high` runs without `--prod`.
   The runtime set is clean on its own (`--prod`: no known vulnerabilities).
4. **Transitive fixes through overrides, not upgrades.** The High and Critical advisories came
   from packages that `@nx/angular` and `nx` pull in (undici, webpack-dev-middleware, piscina).
   Same-major overrides in `pnpm-workspace.yaml` move only those versions; an Nx or Angular major
   change is not part of a scan package. Each entry is removed once the parent ships the fix.
5. **Exemptions carry an expiry in the tool.** osv-scanner reads
   `ops/security/osv-scanner.toml` with `ignoreUntil` dates; pnpm reads `auditConfig.ignoreGhsas`.
   Both point to the accepted-risk table in `docs/security/dependency-audit.md` with an owner and
   an expiry (2027-01-13).
6. **pip-audit fails on any vulnerability.** It has no severity filter; failing on every known
   vulnerability is stricter than the High/Critical bar of item 19 and avoids a severity lookup.
7. **Semgrep runs project rules only.** Twelve rules in `ops/security/semgrep/`, each with a
   positive and a negative fixture run by `semgrep --test`; no registry rules, so the result does
   not change when a remote rule pack changes and the run needs no login. The Angular rules repeat
   the existing lint bans (ADR-0032, ADR-0038) as defence in depth over `apps` and `libs`.

| Rule | Catches |
| --- | --- |
| `iv-python-sql-string-built` | f-string, `%`, `.format()` or `+` as the first argument of `text()`, `.execute()`, `.exec_driver_sql()`, directly or through a name assigned just before |
| `iv-python-subprocess-shell` | `subprocess.*(shell=True)`, `os.system`, `os.popen`, `create_subprocess_shell` |
| `iv-python-yaml-unsafe-load` | `yaml.load`/`load_all` without `SafeLoader`/`CSafeLoader`, `unsafe_load`, `full_load` |
| `iv-python-eval-exec` | `eval`, `exec` |
| `iv-python-weak-hash` | `hashlib.md5`/`sha1`/`new("md5"/"sha1")` without `usedforsecurity=False` |
| `iv-python-random-token` | `random.*` assigned to, or inside a function named like, a token, secret, nonce, salt, password, OTP, key, session or CSRF value |
| `iv-python-tls-verify-disabled` | `verify=False` on httpx and requests, `session.verify = False`, unverified ssl contexts, `CERT_NONE`, `check_hostname = False` |
| `iv-python-secret-compare` | `==`/`!=` with an operand named like a signature, digest, HMAC, secret, token or CSRF value (heuristic; skips `None`, literals, `len()`, constants and SQLAlchemy `where`/`filter`/`and_`/`or_` clauses) |
| `iv-python-response-user-content-type` | taint from request headers, query, path, cookie or FastAPI `Query`/`Header`/`Path`/`Cookie`/`Form`/`Body` parameters into a `Response` media type or `Content-Type` header |
| `iv-angular-bypass-security-trust` | `bypassSecurityTrust(Html\|Style\|Script\|Url\|ResourceUrl)` |
| `iv-angular-html-sink` | `innerHTML`/`outerHTML` writes, `insertAdjacentHTML`, `document.write`, `Renderer2.setProperty(..., 'innerHTML')`, `@HostBinding('innerHTML')` |
| `iv-angular-template-html-binding` | `[innerHTML]`, `[outerHTML]`, `[srcdoc]`, `attr.` and `bind-` forms in templates and inline templates |

8. **SBOMs from lockfile data.** `pnpm sbom --lockfile-only` (CycloneDX 1.7) and `cyclonedx-py
   requirements` over the runtime export (CycloneDX 1.6) are uploaded as the `inecekvar-sbom`
   artifact for 30 days; neither installs packages nor runs lifecycle scripts.
9. **Key files are ignored.** `inecekvar/.gitignore` ignores keystores, `.jks`, `.p8`, `.p12`,
   `google-services.json` and `GoogleService-Info.plist` (item 1: signing keys outside the
   repository).
10. **Line endings.** The root `.gitattributes` already normalised all text to LF
    (`* text=auto eol=lf`); explicit `*.sh`, `*.sql` and `*.conf` `text eol=lf` lines were
    appended so these files are always treated as text in Linux CI and containers.

## Evidence

Run on 2026-10-13, Windows 11 host, Docker Desktop 29.7.2. Output tails as printed.

| Command | Result |
| --- | --- |
| `uvx bandit -r inecekvar/api/app -ll` (bandit 1.9.4), before the fix | `Medium: 2` (B104 at `core/client_ip.py:15` and `:19`), `Low: 1`, `High: 0` |
| same, after `b2657c7d` (and with the hash-locked install) | `Total lines of code: 9176`, `Low: 1`, `Medium: 0`, `High: 0`, exit 0 |
| `uv run pytest -q tests/core/test_client_ip.py` / `tests/core` | `13 passed` / `100 passed`; `ruff check .` `All checks passed!`; `mypy --strict app` `Success: no issues found in 105 source files` |
| `uv export --frozen --no-hashes --no-emit-project --all-groups` then `pip-audit --strict --disable-pip --no-deps -r <export>` (2.10.1) | `No known vulnerabilities found`, exit 0 |
| `pnpm audit --audit-level=high` in `inecekvar/`, before the overrides | `14 vulnerabilities found` `Severity: 3 low \| 6 moderate \| 4 high \| 1 critical`, exit 1 |
| same, after `222e72af` | `1 vulnerabilities found` `Severity: 1 moderate` `1 ignored: 1 high`, exit 0 |
| `pnpm audit --audit-level=high --prod` | `No known vulnerabilities found` |
| `pnpm install --frozen-lockfile` then `pnpm nx run-many -t lint test build` | `Successfully ran targets lint, test, build for 5 projects`; tests 4, 110, 39, 774, 460 passed |
| `osv-scanner scan --lockfile=inecekvar/pnpm-lock.yaml --lockfile=inecekvar/api/uv.lock` (2.6.0), no config | `1465 packages`, `90 packages`, `Total 3 packages affected by 3 known vulnerabilities (0 Critical, 3 High, 0 Medium, 0 Low, 0 Unknown)`, exit 1 |
| same with `--config=inecekvar/ops/security/osv-scanner.toml` | `Filtered 3 vulnerabilities from output` `No issues found`, exit 0 |
| `docker run ... semgrep/semgrep@sha256:9396...e01b semgrep --test ops/security/semgrep` | `12/12: ✓ All tests passed` |
| `semgrep scan --error --config ops/security/semgrep api/app apps libs`, first run | `6 Code Findings`, all `iv-python-secret-compare` on SQLAlchemy `where()` column comparisons, exit 1 |
| same after narrowing the rule | `Ran 12 rules on 443 files: 0 findings.` exit 0 |
| mutation: a copy of `cities/router.py` with `text(f"SELECT set_config('statement_timeout', '{timeout}', true)")` | semgrep `iv-python-sql-string-built` at line 179, `Findings: 1`, exit 1; bandit `-ll` on the same copy: `Medium: 0`, `High: 0` (B608 matches only SELECT ... FROM shapes) |
| `gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="origin/main..HEAD" .` (8.30.1) | before the package: `10 commits scanned.` `no leaks found`; after the documents commit `931df99d`: `16 commits scanned.` `no leaks found` |
| same with `--log-opts="--all"` | `1137 commits scanned.` `leaks found: 1` (local-only Kadro branch, dependency-audit.md section 5) |
| same with `--log-opts="--remotes HEAD"` | `1103 commits scanned.` `no leaks found` |
| lefthook 2.1.15 in a throwaway clone: `lefthook install`; dummy token staged; `git commit` | `sync hooks: ✔️(pre-commit, commit-msg)`; `WRN leaks found: 1`, `🥊 gitleaks`, commit exit 1; clean file: `no leaks found`, exit 0 |
| `pnpm sbom --sbom-format cyclonedx --lockfile-only --sbom-type application` / `cyclonedx-py requirements <runtime export>` | CycloneDX 1.7, 1450 components / CycloneDX 1.6, 58 components |
| `docker run rhysd/actionlint:1.7.12 .github/workflows/inecekvar-security.yml` (image bundles shellcheck 0.11.0) | no output, exit 0 |

## Not exercised

- The workflow itself has not run on GitHub: the branch is not pushed, so the gate, the
  `changes` decision on a real pull request, the artifact upload and the scheduled run are
  untested. actionlint with shellcheck is the only check of the file.
- Linux-only paths: the `curl | sha256sum` installers, `docker run -v "$PWD/inecekvar:/src:ro"`
  on the runner, `$RUNNER_TEMP/scan-tools/bin` on `GITHUB_PATH` and the Linux wheels of the tool
  lock. Locally the same tools ran as the Windows osv-scanner build, the Windows virtual
  environment and Docker Desktop.
- Renovate runs only against the pushed repository; the existing `inecekvar/**` rules are
  unchanged by this package.
- A clean `pip-audit` with the `--require-hashes` export variant (the brief asks for the
  `--no-hashes` export; pip-audit warns about it and still audits every pinned line).
- The history purge runbook and credential rotation list of item 2 (not in this package).
- The gitleaks pre-commit hook in the developer's own checkout (hooks are not installed in the
  main checkout; the run used a throwaway clone).

## Consequences

- Items 15 and 19 have executed local evidence; item 19 stays **partial** until the workflow has
  run on GitHub and its reports exist. Item 15 is done locally (bandit and semgrep clean, the rule
  proven on a mutation).
- Two advisories without a usable fix are accepted until 2027-01-13; the weekly run and the
  osv-scanner expiry force a review.
- The overrides have to be removed when Nx and Angular depend on the fixed versions; Renovate
  updates of `@nx/*` should be checked against them.
