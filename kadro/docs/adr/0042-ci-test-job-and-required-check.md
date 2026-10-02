# ADR-0042: CI test job, no silent skips and one required check

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering, decided by Ayberk (owner)
- Related: ADR-0001, ADR-0021, ADR-0040; `.github/workflows/kadro-ci.yml`, `kadro/turbo.json`,
  `apps/web/tests/support/prerequisite.ts`

## Context

`Kadro CI` ran lint, typecheck and build only; the test suites (web, worker, db, auth, contracts,
config and the rest) ran on developer machines. Four web suites need something outside the test
process and skipped themselves when it was missing: the production-build suites
(`built-server`, `pages/built-pages`, the build-backed block of `security/headers-check`) and the
browser suite (`pages/browser`, a local Chrome or Edge). A skipped suite reports green, so a CI
run without a build or a browser would have looked like a pass.

The workflow also had a `paths:` filter. A check that is required by a branch ruleset but whose
workflow never starts (a pull request that does not touch `kadro/`) stays "Expected — waiting for
status" and blocks the merge.

## Decision

- **Test job.** `kadro-ci.yml` gets a `test` job on `ubuntu-latest` with `CI=true`:
  `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`.
  - Database: the DB-backed suites (`apps/web`, `apps/worker`, `packages/db`) already start their
    own disposable PostgreSQL 16 + PostGIS container (`postgis/postgis:16-3.5-alpine`, tmpfs data
    directory, random loopback port, test-only credentials) through the Docker CLI in their
    vitest `globalSetup` and run the migrations themselves. They read no database URL from the
    environment, so the job uses the runner's Docker engine and no service container; the image
    is pulled in its own step so a registry failure is reported as such.
  - Browser: the browser suite drives Chrome over the DevTools protocol, without Playwright. The
    job points `KADRO_TEST_BROWSER` at the Chrome preinstalled on the runner and, before the
    tests, starts it once headless with its default sandbox (`--dump-dom` of a small page) and
    prints its stderr. No `--no-sandbox` is passed; whether the runner needs it is to be checked
    on the first real run, from that step's output.
- **A skip in CI is a failure.** The four suites gate on `prerequisite()`
  (`apps/web/tests/support/prerequisite.ts`): locally a missing build or browser skips the suite
  and says so on stderr; with `CI=true` it throws and the test file fails. A scan of the test
  trees found no other `skip`, `skipIf`, `todo` or `runIf`; new gated suites use the same helper.
- **Turbo.** `test` tasks are never cached (`cache: false`): their result depends on Docker, the
  browser and the database, which are not task inputs, so a cache hit could replay a green run
  that did not happen. `@kadro/web#test` also depends on its own `build`, so the build-backed
  suites always have `.next`. `CI`, `KADRO_TEST_BROWSER`, `DOCKER_HOST` and `DOCKER_CONTEXT` pass
  through to the test tasks.
- **No path filter, one gate.** The workflow runs on every pull request and every push to `main`.
  A `changes` job diffs the pull request (merge commit against its first parent) or the pushed
  range against `kadro/`, `.github/workflows/kadro-*.yml` and `.gitleaks.toml`; `verify` and
  `test` run only when that matches. The decision is the exit code of
  `git diff --quiet --no-renames <base> <head> -- <pathspecs>` (0 no change, 1 change, anything
  else runs every job), so a file moved out of `kadro/` counts as a deletion inside it and
  quoted or non-ASCII file names are never parsed. A missing or unknown base commit runs every
  job. A final `gate` job (check name **`Kadro CI gate`**) runs with `if: always()` and needs
  every other job. It passes only when `changes` succeeded and either reported `kadro=true` with
  `verify` and `test` both `success`, or `kadro=false` with both `skipped`; any other output or
  result (failure, cancelled, empty) fails it.
- **Required check.** The `main` ruleset should require only `Kadro CI gate`, not the individual
  job names, so adding or renaming jobs does not change the ruleset. Setting up the ruleset is an
  owner action outside this repository's files.

## Consequences

- Every pull request starts `Kadro CI`; one that does not touch Kadro costs one short `changes`
  job and the gate.
- The test job builds once more than `verify` does and has a 30-minute limit.
- A missing build or browser in CI now fails loudly instead of passing silently; locally the
  suites still skip so `pnpm test` works without Chrome or a prior build.
- `Kadro Security` keeps its path filter and is not covered by the gate; it should not be made a
  required check in its current form.
- A job added to `kadro-ci.yml` has to be added to the gate's `needs` and result list, otherwise
  the gate ignores it.
