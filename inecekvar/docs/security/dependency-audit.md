# Inecek Var: dependency audit, static scans, SBOM and secret hygiene

Security checklist items 15 and 19, with the evidence for items 1 and 2 that these checks feed.
This page lists the tools, their pinned versions, the commands, the result of the local run on
2026-10-13 and the accepted risks. The same checks run in `.github/workflows/inecekvar-security.yml`
("Inecek Var Security"); a GitHub run exists only after the branch is pushed, so the CI side is
**not exercised yet**. Decisions: ADR-0051.

## 1. Checks and pinned tools

| Check | Scope | Fails on | Workflow job (all in the gate) |
| --- | --- | --- | --- |
| `gitleaks git --config .gitleaks.toml --log-opts="--all" --redact` | every commit of every ref, repository root config | any finding | `gitleaks` (the same scan also runs in `inecekvar-ci.yml`) |
| `pnpm audit --audit-level=high` | `inecekvar/pnpm-lock.yaml`, **production and development** dependencies (no `--prod`) | High or Critical advisory not listed in `auditConfig.ignoreGhsas` | `pnpm-audit` |
| `pip-audit --strict --disable-pip --no-deps -r <export>` | `uv export --frozen --no-hashes --no-emit-project --all-groups` of `inecekvar/api/uv.lock` (runtime and dev groups) | any known vulnerability (pip-audit has no severity filter; stricter than the High bar) | `pip-audit` |
| `osv-scanner scan --config=ops/security/osv-scanner.toml --lockfile=... --lockfile=...` | `inecekvar/pnpm-lock.yaml` and `inecekvar/api/uv.lock` | any vulnerability not exempted with an expiry | `osv-scanner` |
| `bandit -r api/app -ll` | API sources | Medium or High | `bandit` |
| `semgrep --test ops/security/semgrep` then `semgrep scan --error --config ops/security/semgrep api/app apps libs` | rule fixtures; API, apps and libs sources | a failing fixture or any finding | `semgrep` |
| `pnpm sbom --sbom-format cyclonedx --lockfile-only` and `cyclonedx-py requirements` | npm lockfile; API runtime export (`--no-dev`) | a missing or empty file | `sbom`, artifact `inecekvar-sbom` |
| Renovate | npm, pep621 (uv.lock), GitHub Actions, Gradle and compose under `inecekvar/**` | not a check: opens pull requests | root `renovate.json` |

Pinned versions:

- gitleaks 8.30.1, `gitleaks_8.30.1_linux_x64.tar.gz` SHA-256
  `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` (same as the sibling
  workflows).
- osv-scanner 2.6.0, `osv-scanner_linux_amd64` SHA-256
  `ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108` (from the release's
  `osv-scanner_SHA256SUMS`).
- semgrep 1.179.0, image `semgrep/semgrep:1.179.0@sha256:93963d9295a366f59e4850127b1550400ee7b388f04fe144e4a1f6325d96e01b`.
- bandit 1.9.4, pip-audit 2.10.1, cyclonedx-bom 7.3.0 and their dependencies from
  `ops/security/tools/requirements.txt`, installed with `uv pip install --require-hashes`. The
  file is compiled from `requirements.in` with
  `uv pip compile requirements.in --universal --python-version 3.12 --generate-hashes --no-header -o requirements.txt`.
- uv 0.12.5, Python 3.12, pnpm from `packageManager`, Node.js from `.nvmrc`; actions pinned to
  full commit SHAs.

Triggers: every pull request and push to main (the `changes` job skips the scans unless
`inecekvar/`, an `inecekvar-*` workflow, `.gitleaks.toml` or `renovate.json` changed), every
Monday 05:29 UTC and manual dispatch (both run every job). Permissions: `contents: read` only.

## 2. Local run (2026-10-13)

Windows 11 host, branch `feat/inecekvar-p6`. Python tools from the hash-checked lock (and once
through `uvx` before the lock existed), osv-scanner 2.6.0 Windows build (SHA-256
`e0ed7644118b717b028c249ee9d3515024e55e8510747ca08906eb96765354d6`, matches the release checksum
file), semgrep and actionlint in Docker.

| Tool | Scope | Before fixes (C / H / M / L) | After fixes (C / H / M / L) | Disposition |
| --- | --- | --- | --- | --- |
| pnpm audit 12.8.1 `--audit-level=high` | all npm dependencies | 1 / 4 / 6 / 3, exit 1 | 0 / 0 / 1 / 0, 1 High ignored, exit 0 | fixed with overrides (3.1); braces accepted (4); uuid moderate below the bar (4) |
| pnpm audit `--prod` | runtime npm dependencies | `No known vulnerabilities found` | same | clean |
| pip-audit 2.10.1 | uv.lock export, 241 lines, all groups | `No known vulnerabilities found`, exit 0 | same | clean |
| osv-scanner 2.6.0 | pnpm-lock.yaml (1465 packages), uv.lock (90 packages) | 0 / 3 / 0 / 0 after the overrides (braces 8.7, uuid 7.0.3 and 8.3.2 at 7.5), exit 1 | `Filtered 3 vulnerabilities from output`, `No issues found`, exit 0 | accepted with expiry (4) |
| bandit 1.9.4 `-r api/app -ll` | 9 175 lines | Medium 2 (B104 `"0.0.0.0"` in `core/client_ip.py`), Low 1, exit 1 | Medium 0, High 0, exit 0; Low 1 remains | B104 fixed (3.2); low B105 accepted (4) |
| semgrep 1.179.0 `--test` | 12 rules, 12 fixtures | `12/12: ✓ All tests passed` | same | pass |
| semgrep scan | api/app, apps, libs (443 files) | 6 findings, all `iv-python-secret-compare` on SQLAlchemy `where()` clauses | `Ran 12 rules on 443 files: 0 findings.` exit 0 | rule false positives, rule narrowed with a fixture (3.3) |
| gitleaks 8.30.1 branch range | `origin/main..HEAD` | 10 commits, `no leaks found` | re-run in ADR-0051 after the last commit | clean |
| gitleaks 8.30.1 `--all` | 1137 commits | `leaks found: 1` | same | outside Inecek Var (5) |
| gitleaks 8.30.1 `--remotes HEAD` | 1103 commits | `no leaks found` | same | clean |
| `pnpm sbom` CycloneDX 1.7 | npm lockfile | 1450 components | same | file only, not committed |
| `cyclonedx-py requirements` CycloneDX 1.6 | API runtime export | 58 components | same | file only, not committed |
| actionlint 1.7.12 (Docker, bundles shellcheck 0.11.0) | `inecekvar-security.yml` | no output, exit 0 | same | valid |

Severity columns: C critical, H high, M moderate or medium, L low, as each tool reports them.

## 3. Fixes made

1. **Dependency overrides** in `inecekvar/pnpm-workspace.yaml` (`overrides`), with the lockfile
   updated using `pnpm install --lockfile-only`:
   - `undici` 7.30.1 (nx): GHSA-w293-vg96-wgc3, GHSA-rfgv-xxqx-mfg5,
     GHSA-xjj6-f33q-929c and lower advisories.
   - `webpack-dev-middleware` 8.3.0 (@nx/angular > @angular-devkit/build-angular):
     GHSA-g84c-rxfj-3j2c.
   - `piscina` 5.3.2 (@nx/angular > @angular/build and build-angular): GHSA-67c8-pqhq-4rmx.
   - `vite` 8.3.5 and 8.1.6 (@angular/build 22.2.2 and 22.1.9): GHSA-587h-7wmj-h5pm
     and five lower advisories.
   - `zod` 4.6.7 (@angular/cli and @angular/forms): GHSA-mrhx-c7xc-m3w5.
   - `body-parser` 2.4.0 and 1.20.9 (Express 5 and webpack-dev-server's Express 4):
     GHSA-27r3-jxmh-p828.
   - `serialize-javascript` 7.1.4 (copy-webpack-plugin): GHSA-m5mm-p8h7-m29v.
   - `fast-uri` 3.1.9 (ajv): GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr and two lower
     advisories.
   - API dependency pins: Pillow 13.0.0 and certifi 2026.10.23, to use patched releases.

   Each npm override moves the vulnerable version to a patched release in its major. The
   GHSA-vfj7-8cjw-p6xm braces exemption is now reported unused by osv-scanner and remains kept.
   Remove an override once its parent depends on the patched release.
2. **bandit B104** (`api/app/core/client_ip.py`): the missing-peer rate-limit key was the literal
   `"0.0.0.0"` with a ruff `noqa`. It is now `UNKNOWN_PEER = ip_address(0).compressed` (same
   value, no listen-on-all literal, no suppression comment). Tests:
   `tests/core/test_client_ip.py::test_resolve_client_ip` (cases `None` and `"invalid"` expect the
   sentinel) 13 passed; `tests/core` 100 passed; ruff, ruff format and `mypy --strict app` clean.
3. **semgrep rule narrowing**: `iv-python-secret-compare` flagged
   `UserSession.token_hash == token_hash(cookie)` and five other column comparisons inside
   `select(...).where(...)` and `delete(...).where(...)`. Those build a SQL predicate with a bound
   parameter (lookup by the SHA-256 of a random token); Python compares nothing. The rule now
   skips comparisons inside `.where()`, `.filter()`, `and_()` and `or_()`, with a negative fixture.
4. **Keystore hygiene** (item 1): `inecekvar/.gitignore` now ignores `*.keystore`, `*.jks`, `*.p8`,
   `*.p12`, `google-services.json` and `GoogleService-Info.plist`; before, none of them was ignored
   (the Capacitor template leaves its keystore lines commented out).

## 4. Accepted risks

| Id | Package | Tool and severity | Reason | Owner | Expiry |
| --- | --- | --- | --- | --- | --- |
| GHSA-vfj7-8cjw-p6xm | braces 3.0.3 (15 paths, all under @nx/angular > @angular-devkit/build-angular > webpack-dev-server, chokidar, micromatch) | pnpm audit High, osv 8.7 | No patched release exists. Stack exhaustion from deeply nested brace patterns; the patterns come from build configuration, not from users, and the webpack builders are not used by any project executor (`@angular/build:*` only). Same decision as Kadro ADR-0078. Listed in `pnpm-workspace.yaml` `auditConfig.ignoreGhsas` and in `ops/security/osv-scanner.toml`. | Project owner (Ayberk Arda) | 2027-01-13 |
| GHSA-w5hq-g745-h8pq | uuid 7.0.3 (xcode via @capacitor/cli), 8.3.2 (sockjs via webpack-dev-server) | pnpm audit moderate (below the bar), osv 7.5 | Fixed only in the 11.x major, which the parents do not accept. The advisory needs `v3`/`v5`/`v6` with a caller buffer; both callers use `uuid.v4()` without arguments (`xcode/lib/pbxProject.js` line 90, `sockjs/lib/transport.js` line 37, read in the installed packages). Build and dev tooling only. Exempted in `ops/security/osv-scanner.toml`. | Project owner (Ayberk Arda) | 2027-01-13 |
| bandit B105 | `api/app/main.py` `LOCAL_S3_PASSWORD = "inecekvar_local_dev"` | bandit Low (not failing with `-ll`) | The documented MinIO default of the local compose stack, used only when `INECEKVAR_ENV=local`; already marked for ruff. | Project owner (Ayberk Arda) | 2027-01-13 |

On or before the expiry the entry is reviewed: a patched release in the parent's range removes
it; otherwise it is renewed here with a new date. osv-scanner fails the job again automatically
after `ignoreUntil`; the pnpm exemption has no built-in expiry, so the weekly run and this table
carry it.

## 5. Secret scans of the history (items 1 and 2)

- `gitleaks git --no-banner --redact --config .gitleaks.toml --log-opts="origin/main..HEAD" .`:
  no leaks (counts in ADR-0051).
- `--log-opts="--all"` reads every local ref, including branches never pushed: 1137 commits, one
  `generic-api-key` finding (redacted) in `kadro/apps/worker/test/backup-verify.test.ts`, commit
  `33361dd7`, contained only in the local Kadro branch `feat/rc-delete-backup`. It is outside
  Inecek Var and not in any pushed history; it was already reported in ADR-0042 and Askida's audit
  page. Nothing was changed here and no allowlist was widened.
- `--log-opts="--remotes HEAD"` (what a fresh clone holds): 1103 commits, no leaks. The phase 5
  finding in commit `8197119d` is covered by the existing commit-scoped allowlist entry in
  `.gitleaks.toml` (the public Svix documentation example).
- The history purge runbook (`docs/security/history-purge-runbook.md`) is not part of this
  package; item 2 stays partial until it exists.

## 6. Pre-commit hook (item 1)

Run in a throwaway clone (`git clone --no-local --depth 1` of this worktree into the temp
directory, deleted afterwards), with lefthook 2.1.15 (the version pinned in `kadro/package.json`)
installed into a separate temp folder:

```text
$ lefthook install
sync hooks: ✔️(pre-commit, commit-msg)

# staged scratch-clean.txt ("plain note")
$ lefthook run pre-commit
INF scanned ~11 bytes (11 bytes) in 123ms
INF no leaks found
✔️ gitleaks (0.36 seconds)
exit 0

# staged scratch-hook-check.txt with a random 36-character ghp_ token created at run time
$ git commit -m "chore: hook check"
WRN leaks found: 1
🥊 gitleaks (0.34 seconds)
exit 1   (HEAD unchanged; the file was unstaged and deleted, the clone removed)
```

The other pre-commit commands were skipped (`no files for inspection`). The dummy value was
never written to this repository. On this machine the hooks are not installed in the main
checkout; installing them stays the repository owner's step (`lefthook.yml` header).

## 7. Environment file and key hygiene (item 1)

Commands run from the repository root on 2026-10-13:

| Check | Command | Result |
| --- | --- | --- |
| `.env` files are ignored | `git check-ignore -v inecekvar/.env inecekvar/.env.local inecekvar/api/.env inecekvar/apps/web/.env.production` | all four matched by `inecekvar/.gitignore` lines 9 (`.env`) and 10 (`.env.*`) |
| only the example is tracked | `git ls-files inecekvar \| grep -iE '(^\|/)\.env'` | `inecekvar/.env.example` only |
| the example holds documented dummies | read `inecekvar/.env.example` | ports, `inecekvar_local_dev` local passwords marked local-dev-only; every real secret is named with "no example value" |
| no keys or native service files tracked | `git ls-files inecekvar \| grep -iE '\.(keystore\|jks\|p8\|p12\|pfx\|pem\|key)$\|google-services\.json\|GoogleService-Info\.plist'` | no output |
| none ever committed | `git log --all --format= --name-only -- 'inecekvar/*' \| grep -iE '(^\|/)\.env($\|\.)\|\.(keystore\|jks\|p8\|p12)$\|google-services\.json'` | `inecekvar/.env.example` only |
| keys are now ignored | `git check-ignore -v` on `release.jks`, `upload.keystore`, `AuthKey_X.p8`, `google-services.json`, `GoogleService-Info.plist` paths | all matched by the new `inecekvar/.gitignore` lines |
| nothing tracked is ignored | `git ls-files -ci --exclude-standard inecekvar` | no output |

## 8. Keeping it fresh

- Renovate (`renovate.json`) covers `inecekvar/**`: npm groups (Angular and Nx, Ionic and
  Capacitor, minor and patch), pep621 with `rangeStrategy: update-lockfile` (only `uv.lock`
  moves), Gradle, compose images, and GitHub Actions digests; security alerts open pull requests
  at any time with the `security` label, nothing merges automatically. A pull request from it
  changes `inecekvar/` and therefore runs this workflow. `ops/security/tools/requirements.txt` is
  not a manager Renovate reads; it is compiled again by hand when a tool version changes (same
  command as section 1). CocoaPods is not used: the iOS project is not committed.
- The weekly scheduled run (Monday 05:29 UTC) runs every job against the current advisory
  databases, so a new advisory against an unchanged lockfile fails the gate within a week.
- When an override in `pnpm-workspace.yaml` becomes unnecessary (the parent depends on the fixed
  version), remove it; `pnpm audit` and osv-scanner prove the result.
