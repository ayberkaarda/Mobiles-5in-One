# ADR-0082: RevenueCat subscriber deletion at hard delete, and `backup.verify`

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §6 items 17, 20 and 21; ADR-0002, ADR-0028, ADR-0032, ADR-0063;
  threat model RR-13, T-DEL-03, T-PLT-09; `docs/release/backup-restore-drill.md`;
  `apps/worker/src/billing/subscriber-delete.ts`, `apps/worker/src/accounts/hard-delete.ts`,
  `apps/worker/src/backup/verify.ts`

## Context

ADR-0032 step 2 deletes the RevenueCat subscriber when an account is hard-deleted, but until now
the job only wrote `revenuecat` into `deletion_requests.external_pending` when the account had
subscription rows, and the REST client issued GET requests only (threat model RR-13). The row that
records the debt no longer references the user after the commit, so nothing could settle it later.

Spec item 20 names a worker job `backup.verify`; the drill document (§4) says it records the result
of the latest backup check. The backups themselves are produced outside the application: a daily
`pg_dump -Fc` on the database host, encrypted with `age` and uploaded to the R2 bucket
`kadro-backups` (ADR-0002). The worker has no access to the dump job or to the `age` identity.

Neither item needs a new table: the existing `external_pending` column, pg-boss job rows and the
structured log/metric lines carry the state.

## Decision

### 1. RevenueCat subscriber deletion

1. **Client.** `RevenueCatClient.deleteSubscriber(userId)` calls REST API v1
   `DELETE /v1/subscribers/{app_user_id}` with `app_user_id = users.id`. 2xx → `deleted`,
   404 → `not_found` (already gone, a success); 401/403 `unauthorized`, 429 `rate_limited`, other
   status `http_status`, plus `timeout` / `network`. Transient: 429, 5xx, timeout, network.
2. **Inside the hard delete.** After the object-storage deletes and before any database change,
   still holding the deletion-request lock (a sign-in that cancels the deletion waits for it, so a
   subscriber is never deleted for an account that stays), the handler calls the client with up to
   3 attempts and exponential backoff from 1 s on transient errors; permanent errors are not
   retried. A failure never throws: the database deletion always proceeds.
3. **Outcome record.**
   - success (`deleted` / `not_found`): `external_pending = {}`;
   - failure: `external_pending = {revenuecat}`, the job enqueues
     `revenuecat.subscriber_delete` with `{ deletionRequestId, appUserId }` and key
     `rc-delete:<deletionRequestId>` in the same transaction, and after the commit the metric
     `revenuecat_delete_failed{stage=hard_delete,reason,status,attempts}` (warn) is written;
   - no `REVENUECAT_API_KEY`: no call; `external_pending = {revenuecat}` only when the account had
     subscription rows (the previous behaviour), outcome `skipped_unconfigured`.

   The `account deleted` log line carries `revenueCat` (`deleted`, `not_found`, `failed_deferred`,
   `skipped_unconfigured`). The `account.deleted` audit metadata is unchanged (ADR-0032).

4. **Follow-up queue `revenuecat.subscriber_delete`.** One call per run; 8 retries, exponential
   from 300 s (up to about 21 h in total), then the dead letter. It runs only for a completed
   request that still lists `revenuecat` and whose account row is gone (`skipped_account_exists` otherwise), so it
   cannot remove the subscriber of a live account. Success removes `revenuecat` from
   `external_pending` with a receipt. Without a key it completes as `skipped_unconfigured`.
5. **Where the id lives.** The follow-up payload holds the deleted account's id, the only way to
   address the subscriber after the commit. It exists only when the inline call failed and is
   removed with the job (completed after 7 days, dead letters after 14). The Phase 6 "no trace of
   the user" proof covers the public schema; a pending follow-up is the documented exception.

### 2. `backup.verify`

1. **Schedule.** Queue `backup.verify` (scheduled payload, key only), cron `20 6 * * 1` in UTC
   (`BACKUP_VERIFY_CRON`, Mondays 06:20), 3 retries exponential from 600 s.
2. **What it checks.** It lists `BACKUP_BUCKET` on `R2_ENDPOINT` with its own read-only key pair
   (`BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY`), keeps keys
   `<BACKUP_PREFIX>YYYYMMDD.dump.age` with a real date, takes the newest by upload time and checks:
   size ≥ `BACKUP_MIN_BYTES` (default 1 024), the first 64 bytes start with the `age` header
   (binary or armored), and age ≤ `BACKUP_MAX_AGE_HOURS` (default 30: daily dump plus slack).
3. **Result.** `ok`, `stale` (older than the threshold) or `failed` (`no_backup`, `too_small`,
   `not_encrypted`, `missing`); a failure outranks staleness. The outcome is the job output
   (`ok`, `stale`, `failed_<reason>`); `ok` logs at `info` with `backup_verified{status=ok}`,
   `stale` and `failed` log at `error` with `backup_check_failed{status,reason}`. A storage error
   counts as `failed` (`storage_error`) and the job retries; after the last retry it dead-letters.
4. **Unconfigured.** Without `BACKUP_BUCKET` the job completes as `skipped_unconfigured` with a
   `warn` line. With a bucket both keys are required, and the bucket must differ from the upload
   buckets (`packages/config`).
5. **Limits, stated plainly.** The check proves that a recent, non-trivial, `age`-encrypted object
   exists. It does not decrypt, read the whole object or restore: the worker has no identity, by
   design. Restorability is proven only by the restore drill (`ops/restore-drill.sh`, and the
   weekly `restore-drill.yml` that is still an owner task).

## Consequences

- RR-13 is closed in code: a deleted account's subscriber is deleted at hard delete, or the debt
  is visible (`external_pending`, `revenuecat_delete_failed`, dead letter) and retried for about a
  day. It is proven against a local fake RevenueCat server only; the real API's behaviour (status
  codes, rate limits) has not been observed (no account, no key).
- `external_pending = {revenuecat}` rows written before this change, or while no key is configured,
  cannot be settled automatically: the user id is gone. Query:
  `select id, completed_at from deletion_requests where 'revenuecat' = any(external_pending)`.
- The drill document's alert "no success recorded for 48 hours" assumes a daily check; with the
  weekly schedule an alert should instead fire on any `backup_check_failed` or on a missing
  `backup_verified` line for 8 days. Moving to daily is a one-line change of `BACKUP_VERIFY_CRON`.
- Tests: `apps/worker/test/revenuecat-delete.test.ts` (real REST client against a local fake
  server, real database and pg-boss) and `apps/worker/test/backup-verify.test.ts` (S3 fake).

## Alternatives considered

- **Only a follow-up job, no inline call.** Simpler, but the account id would sit in a job row for
  every deletion; the inline call keeps it out of the database in the normal case.
- **Fail the hard delete until RevenueCat answers.** A provider outage would keep personal data
  beyond the promised period; rejected (ADR-0032 has the same rule for the confirmation email).
- **A table for pending external cleanups with the RevenueCat id.** Equivalent to the follow-up
  job but needs a migration; rejected while pg-boss can hold the same state.
- **Download and test-decrypt the dump in the worker.** Needs the `age` identity on the server,
  which the backup design keeps offline; rejected.
