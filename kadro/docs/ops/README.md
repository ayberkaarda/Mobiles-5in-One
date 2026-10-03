# Operations

Hosting model: Docker Compose on a Linux VPS behind Caddy (see
[ADR-0002](../adr/0002-hosting.md)). Environments: `local`, `preview`, `production`.

## Local stack

```sh
cp .env.example .env
docker compose up --build        # Postgres 16 + web (http://localhost:3000) + worker
```

Database only, apps on the host with hot reload:

```sh
docker compose up -d postgres
pnpm dev                         # web + worker; both load ../../.env when present
```

Health check: `GET http://localhost:3000/api/v1/health` returns status, environment and build SHA.

## Configuration

- `packages/config` validates environment variables at boot and exits with a list of the missing
  or invalid keys (values are never printed).
- `.env.example` documents every key with a local dummy value. Preview and production values are
  set in the server's compose `.env` file, readable only by the deploy user, never committed.
- `BUILD_SHA` is set to the git commit SHA by the deploy pipeline.

## Images

| Image  | Dockerfile               | Runs as           | Entry                                          |
| ------ | ------------------------ | ----------------- | ---------------------------------------------- |
| web    | `apps/web/Dockerfile`    | `node` (uid 1000) | `node apps/web/server.js` (Next.js standalone) |
| worker | `apps/worker/Dockerfile` | `node` (uid 1000) | `node dist/main.js`                            |

Both images build from the repository root as context.

## Continuous integration

`.github/workflows/kadro-ci.yml` runs on every pull request and every push to `main`
([ADR-0042](../adr/0042-ci-test-job-and-required-check.md)):

| Job ID    | Check name               | Runs                                                                  |
| --------- | ------------------------ | --------------------------------------------------------------------- |
| `changes` | `Detect Kadro changes`   | always; decides whether Kadro files changed                           |
| `verify`  | `Lint, typecheck, build` | on Kadro changes                                                      |
| `test`    | `Test`                   | on Kadro changes; `CI=true`, build, then all suites (Docker + Chrome) |
| `gate`    | `Kadro CI gate`          | always; Kadro change: verify and test passed, else: both skipped      |

`.github/workflows/kadro-security.yml` runs on every pull request, every push to `main`, weekly and
on demand, also without a path filter ([ADR-0046](../adr/0046-security-workflow-gate.md)):

| Job ID        | Check name                             | Runs                                                                |
| ------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `changes`     | `Detect Kadro changes`                 | always; the weekly and manual runs always report Kadro changes      |
| `gitleaks`    | `Gitleaks (full history)`              | on Kadro changes; all commits of all refs                           |
| `audit`       | `Dependency audit (high and critical)` | on Kadro changes                                                    |
| `secret-grep` | `Secret grep`                          | on Kadro changes                                                    |
| `gate`        | `Kadro Security gate`                  | every run; Kadro change: three jobs passed, else: all three skipped |

Mark exactly two status checks as required in the `main` ruleset: `Kadro CI gate` and
`Kadro Security gate`, not the individual job names. A gate that stays `cancelled` (a newer push
cancelled that run) has to be re-run before it counts. With `CI=true` a
suite that cannot find the production build or a browser fails instead of skipping; locally it
skips and prints why. Reproduce the test job on a machine with Docker and Chrome or Edge:

```sh
CI=true pnpm install --frozen-lockfile
CI=true pnpm build
CI=true pnpm test
```

Two more workflows exist: the `lighthouse` job in `kadro-ci.yml` (`Lighthouse (informational)`,
[ADR-0059](../adr/0059-web-quality-gates.md)) is not part of `Kadro CI gate` and is not a required
check, and `.github/workflows/kadro-mobile-e2e.yml` (`Maestro on Android emulator`,
[ADR-0076](../adr/0076-mobile-maestro-e2e.md)) runs only on manual dispatch.

## Runbooks and operations documents

| Document                                                                       | Scope                                                                                               | Status                                                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `README.md`                                                                    | This overview                                                                                       | Written                                                                        |
| [`worker.md`](worker.md)                                                       | Worker queues, configuration, local run, recovery                                                   | Written                                                                        |
| [`admin-recovery.md`](admin-recovery.md)                                       | Staff lockout, TOTP loss, deactivated admin, last-admin protection; operator SQL as document only   | Written, never executed; operator script and TOTP reset not implemented        |
| [`../release/backup-restore-drill.md`](../release/backup-restore-drill.md)     | `pg_dump` restore drill (`ops/restore-drill.sh`) and the draft production restore with `age` and R2 | Drill script written; production backup path not built                         |
| [`../release/cost-alerts.md`](../release/cost-alerts.md)                       | Spend thresholds per service and the `cost.guard` design                                            | Proposals only; nothing configured at providers, `cost.guard` built (ADR-0081) |
| [`../release/history-purge-runbook.md`](../release/history-purge-runbook.md)   | Release-time checklist for a leaked secret in Git history                                           | Document only; not executed                                                    |
| [`../security/history-purge-runbook.md`](../security/history-purge-runbook.md) | Rotation table and rewrite procedure for a committed `.env`                                         | Document only; not executed                                                    |
| `deploy.md`                                                                    | VPS provisioning, Caddy, compose deploy and rollback                                                | Not written (ADR-0002 describes the model)                                     |

The restore drill script lives at `ops/restore-drill.sh` (repository path `kadro/ops/`); run it with
`bash ops/restore-drill.sh` from `kadro/`. A history rewrite or a force-push needs the owner's
explicit approval whichever of the two purge documents is followed.

Log retention: 30 days for application logs on the host (`docker` `local` log driver rotation),
configured in the production compose file.
