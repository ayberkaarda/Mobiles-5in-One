# ADR-0046: Security workflow without a path filter and one gate

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering, reported to Ayberk (owner)
- Related: ADR-0042; `.github/workflows/kadro-security.yml`, `.github/workflows/kadro-ci.yml`,
  `.gitleaks.toml`

## Context

`Kadro Security` (secret grep, dependency audit, gitleaks over the full history) started only for
pushes and pull requests that touched `kadro/`, a `kadro-*` workflow or `.gitleaks.toml`, plus a
weekly schedule. A check that a branch ruleset requires but whose workflow never starts stays
"Expected — waiting for status" and blocks the merge. ADR-0042 solved this for `Kadro CI` and
noted that `Kadro Security` should not be a required check in its current form.

## Decision

- **No path filter.** `kadro-security.yml` runs on every pull request, every push to `main`, the
  weekly schedule (`17 4 * * 1`) and manual dispatch.
- **Change detection.** A `changes` job (`Detect Kadro changes`) uses the same logic as
  `kadro-ci.yml`: it checks out with `fetch-depth: 0` and takes the exit code of
  `git diff --quiet --no-renames <base> <head> -- kadro/ ':(glob).github/workflows/kadro-*.yml'
.gitleaks.toml` (0 no change, 1 change, anything else counts as a change). The range is the
  merge commit against its first parent for pull requests and the pushed range for pushes. The
  weekly schedule, manual runs, a new branch and an unknown base commit have no usable range and
  report `kadro=true`, so the scheduled scan always runs in full.
- **Jobs.** `gitleaks` (`Gitleaks (full history)`, still `fetch-depth: 0` and `--log-opts="--all"`),
  `audit` (`Dependency audit (high and critical)`) and `secret-grep` (`Secret grep`) need `changes`
  and run only when `kadro=true`. Action pins and the gitleaks checksum are unchanged.
- **Gate.** A final job (check name **`Kadro Security gate`**) runs with `if: always()` and needs
  every other job. It passes only when `changes` succeeded and either reported `kadro=true` with
  all three jobs `success`, or `kadro=false` with all three `skipped`; any other output or result
  (failure, cancelled, empty) fails it. A job added to the workflow has to be added to the gate's
  `needs` and result list.
- **Required checks.** The `main` ruleset should require exactly two checks: `Kadro CI gate` and
  `Kadro Security gate`, not the individual job names. Setting up the ruleset is an owner action
  outside this repository's files.

## Consequences

- Every pull request starts `Kadro Security`; one that does not touch Kadro costs one short
  `changes` job and the gate.
- Pull requests that touch Kadro now also run the full-history gitleaks scan as a merge gate,
  as before for path-matching pull requests.
- The weekly schedule is not affected by the diff logic and always scans everything.
- Both gates always report, so a ruleset that requires them cannot get stuck on a missing check.
