# ADR-0057: Dependency audit, SBOM and update automation

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Security checklist item 19 asks for `composer audit` (failing), `osv-scanner` on the lockfiles,
`flutter pub outdated`, update automation for every ecosystem, committed lockfiles and a CycloneDX
SBOM. The repository already uses Renovate for Kadro and pins tools by version and checksum.

## Decision

- New workflow `.github/workflows/askida-security.yml` ("Askida Security") with a `changes` job and
  a gate job `Askida Security gate` (`if: always()`) that needs `gitleaks`, `composer-audit`,
  `osv-scanner` and `sbom`.
  - `composer audit --locked --abandoned=fail`: fails on any advisory and also on an abandoned
    package.
  - `osv-scanner scan --lockfile=askida/server/composer.lock --lockfile=askida/app/pubspec.lock`
    with the 2.6.0 binary downloaded from the release and checked with
    `sha256sum --check --strict`.
  - `gitleaks` full history, same pinned version and checksum as `askida-ci.yml`.
  - SBOM with `composer CycloneDX:make-sbom` from the dev dependency
    `cyclonedx/cyclonedx-php-composer`, uploaded as an artifact, never committed.
  - `flutter pub outdated --json` (report only) and `zap` (ADR-0055) are informational and stay
    outside the gate.
- Renovate instead of the Dependabot named in the specification, because the repository already
  runs Renovate for Kadro and one tool should own update pull requests. Root `renovate.json`:
  `composer`, `pub` and `gradle` managers scoped to `askida/**`,
  minor and patch updates in one weekly group per manager, majors one pull request each, the shared
  schedule and minimum release age of the Kadro entries. Askida keeps version ranges in
  `composer.json` and `pubspec.yaml` and lets Renovate move only the lockfiles
  (`rangeStrategy: update-lockfile`); Kadro pins exact versions. Including `askida/**` also brings
  the server's npm manifest and the compose image references under the shared rules.
- Exemptions: none. An exemption would be recorded in `docs/security/dependency-audit.md` with the
  advisory id, package, reason, owner and expiry, and in the tool's own ignore list with the same
  expiry.

## Consequences

- Recorded locally: `composer audit` no advisories (exit 0); `osv-scanner` 192 + 195 packages, no
  issues (exit 0); SBOM CycloneDX 1.5 with 192 components; `pub outdated` 16 transitive entries;
  `actionlint` no findings (run without the shellcheck integration).
- `gitleaks --log-opts=--all` on the development checkout also reads local branches that were never
  pushed; it found one `generic-api-key` in a Kadro test file on such a branch, outside Askida. The
  Askida history is clean. The finding is the repository owner's decision.
- Gaps: `npm audit --audit-level=high` from the specification is not run, because
  `askida/server/package.json` has no committed lockfile; CocoaPods auditing needs macOS.
- not exercised: the GitHub runs of the workflow and Renovate (both need the push), CocoaPods.
