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

| Job ID    | Check name               | Runs                                                                   |
| --------- | ------------------------ | ---------------------------------------------------------------------- |
| `changes` | `Detect Kadro changes`   | always; decides whether Kadro files changed                            |
| `verify`  | `Lint, typecheck, build` | on Kadro changes                                                       |
| `test`    | `Test`                   | on Kadro changes; `CI=true`, build, then all suites (Docker + Chrome)  |
| `gate`    | `Kadro CI gate`          | always; fails if any job failed or was cancelled, skipped counts as ok |

Mark only `Kadro CI gate` as the required status check of the `main` ruleset. With `CI=true` a
suite that cannot find the production build or a browser fails instead of skipping; locally it
skips and prints why. Reproduce the test job on a machine with Docker and Chrome or Edge:

```sh
CI=true pnpm install --frozen-lockfile
CI=true pnpm build
CI=true pnpm test
```

## Runbooks in this directory

| Document            | Scope                                                | Delivered in |
| ------------------- | ---------------------------------------------------- | ------------ |
| `README.md`         | This overview                                        | Phase 0      |
| `worker.md`         | Worker queues, configuration, local run, recovery    | Phase 2      |
| `backup-restore.md` | `pg_dump` + `age` + R2, restore drill                | Phase 6      |
| `cost-alerts.md`    | Spend thresholds and application kill-switches       | Phase 6      |
| `deploy.md`         | VPS provisioning, Caddy, compose deploy and rollback | Phase 6      |

Log retention: 30 days for application logs on the host (`docker` `local` log driver rotation),
configured in the production compose file.
