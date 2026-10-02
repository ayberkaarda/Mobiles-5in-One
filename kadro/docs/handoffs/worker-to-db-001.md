# Handoff worker → db 001

- From: `apps/worker` (pg-boss bootstrap with real database roles)
- To: owner of `packages/db`
- Status: open

## 1. `kadro_grant_pgboss_send_access()` misses `pgboss.version`

A send-only pg-boss client (`supervise: false`, `schedule: false`, `migrate: false`) still runs
`SELECT version FROM pgboss.version` in `start()` to check the schema version. With only the grants
of migration 0010, `start()` as `kadro_app` fails with `42501 permission denied for table version`,
so the web app cannot enqueue.

Request: a new migration that redefines the function and adds
`EXECUTE 'GRANT SELECT ON pgboss.version TO kadro_app';`. Nothing else is needed: with that grant
the web role starts the client, reads queue metadata, inserts jobs inside its own transaction and
still cannot read `pgboss.job` payloads, `pgboss.schedule` or `job_receipts`.

Evidence: `apps/worker/test/queues.test.ts` ("lets kadro_app enqueue inside its own transaction…")
asserts that the only failure is this permission, applies the single grant, and then proves the
full path. The test keeps passing unchanged once the function includes the grant.

## 2. Migration CLI reads the full worker configuration

`src/cli/migrate.ts` and `createDbClientFromEnv` call `loadWorkerEnv()`. The worker schema now also
requires `WEB_ORIGIN`, and outside local the email and push transports with their credentials
(ADR-0029, ADR-0031). A migration step that runs with a database-only environment will fail
validation. Suggested: a small `loadDatabaseEnv()` in `@kadro/config` (`NODE_ENV`, `APP_ENV`,
`DATABASE_URL`) used by the database CLIs, requested from the config owner.
