# Askıda: dependency audit, SBOM and update automation

Security checklist item 19. This page lists what checks the dependencies, the commands, the
result of the local run on 2026-10-05 and the exemptions. The same checks run in
`.github/workflows/askida-security.yml` ("Askida Security"); results of GitHub runs are recorded
only after the branch is pushed, so the CI side is **not exercised yet**.

## 1. Checks

| Check | Scope | Fails on | Where |
|---|---|---|---|
| `composer audit --locked --abandoned=fail` | `askida/server/composer.lock` (runtime and dev packages) | any advisory, any abandoned package | job `composer-audit` (gate) |
| `osv-scanner scan --lockfile=askida/server/composer.lock --lockfile=askida/app/pubspec.lock` | both lockfiles, OSV database (GitHub advisories, Packagist, pub.dev) | any vulnerability | job `osv-scanner` (gate) |
| `gitleaks git --config .gitleaks.toml --log-opts="--all" --redact` | every commit of every ref | any finding | job `gitleaks` (gate); the same scan also runs in `askida-ci.yml` |
| `composer CycloneDX:make-sbom --output-format=JSON --output-file=sbom.cdx.json` | server packages (`cyclonedx/cyclonedx-php-composer`, dev dependency) | a missing or empty file | job `sbom` (gate), uploaded as the `askida-server-sbom` artifact |
| `flutter pub outdated --json` | app packages | never (report only) | job `pub-outdated` (informational), artifact `askida-pub-outdated` |
| Renovate | `composer`, `pub` and `gradle` managers under `askida/**` | not a check: opens pull requests | root `renovate.json` |

Pinned tools: gitleaks 8.30.1 (SHA-256 `551f6fc8…f2470eb`, same as `askida-ci.yml`), osv-scanner
2.6.0 (`osv-scanner_linux_amd64`, SHA-256
`ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108`, from the release's
`osv-scanner_SHA256SUMS`). Both downloads are checked with `sha256sum --check --strict` before
use. Actions are pinned to full commit SHAs.

The "Askida Security gate" job needs `changes`, `gitleaks`, `composer-audit`, `osv-scanner` and
`sbom`; with no Askida change all four are skipped and the gate passes. `pub-outdated` and `zap`
are informational and stay out of the gate. Scheduled (Monday 04:41 UTC) and manual runs run
every job; `zap` runs only on those two events.

## 2. Local run (2026-10-05)

Run on branch `feat/askida-p6-scan` after the CycloneDX plugin was added. Composer and PHP ran in
the `askida-server:local` container (Composer 2.10.3, PHP 8.3.35); osv-scanner 2.6.0 (Windows
build, SHA-256 `e0ed7644118b717b028c249ee9d3515024e55e8510747ca08906eb96765354d6`, matches the
release checksum file).

| Command | Result |
|---|---|
| `composer audit --locked --no-interaction --abandoned=fail` | `No security vulnerability advisories found.` exit 0 |
| `osv-scanner scan --lockfile=askida/server/composer.lock --lockfile=askida/app/pubspec.lock` | `composer.lock`: 192 packages, `pubspec.lock`: 195 packages, `No issues found`, exit 0 |
| `composer CycloneDX:make-sbom --output-format=JSON --output-file=<tmp>/sbom.cdx.json` | exit 0; CycloneDX 1.5, 192 components, 494 019 bytes (not committed; `/sbom.cdx.json` is ignored in `askida/server/.gitignore`) |
| `flutter pub outdated --json` | 16 entries, all transitive; no direct dependency behind its latest resolvable version |
| `gitleaks git --config .gitleaks.toml --log-opts="--all" --redact --no-banner .` | see section 3 |
| `actionlint` 1.7.12 on `askida-security.yml` | no findings (run without the shellcheck integration: shellcheck is not installed on this machine) |

## 3. Secret scan of the history

`--log-opts="--all"` reads every local ref of the checkout, which on the development machine
includes branches that were never pushed. Run on 2026-10-05 over 661 commits:

- Askida history (`feat/askida-p6` and the Phase 6 branches): no finding.
- One finding (`generic-api-key`, redacted) in a Kadro test file on the local branch
  `feat/rc-delete-backup`, which no remote-tracking branch contains. It is outside Askida and not
  part of any pushed history. It is reported to the repository owner; nothing was changed here
  (the gitleaks allowlist has its own owner).

The GitHub job scans the refs of the pushed clone only; its result is recorded after the push.

## 4. Exemptions

None. No advisory, vulnerability or abandoned package is ignored, and the workflow has no
ignore list. If an exemption is ever needed it is added here with the advisory id, the package,
the reason, the owner and an expiry date, and in the tool's own ignore mechanism with the same
expiry.

## 5. Update automation

`renovate.json` (repository root) now includes `askida/**`:

- `composer` (askida/server) and `pub` (askida/app): minor and patch updates in one weekly group
  each; `rangeStrategy: update-lockfile` keeps the ranges in `composer.json` and `pubspec.yaml`
  and moves only the lockfiles.
- `gradle` (askida/app/android): one weekly group (Play Integrity and the build plugins).
- Major updates of all three open one pull request each.
- Shared settings from the Kadro entries apply: Monday before 06:00 Europe/Istanbul, three days
  minimum release age, no automerge, security alerts at any time with the `security` label.

Including `askida/**` also brings the npm manager (`askida/server/package.json`) and the
docker-compose image references under the existing shared rules. Renovate runs against the
pushed repository only, so the new rules are **not exercised** until the push. Locally the file
parses as JSON and uses only keys already used by the Kadro entries plus `matchFileNames` and
`rangeStrategy`; `renovate-config-validator` was not run (not installed).
