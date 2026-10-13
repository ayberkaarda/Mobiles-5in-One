# Background jobs

Run the worker with `uv run arq app.workers.main.WorkerSettings`. It connects to Redis using `INECEKVAR_REDIS_URL`; Redis also holds the planner cache.

| Job | Schedule | Work |
| --- | --- | --- |
| Trace retention purge | Hourly | Delete raw traces after `delete_after` passes: 30 days after the derived version is published, or 30 days after upload if never published. |
| Photo processing | Every minute | Check magic bytes, re-encode valid photos as WebP at 1600 px without metadata, and quarantine failures. |
| Weekly city export | Monday 03:00 Europe/Istanbul | Create one GeoJSON export per city at `exports/<city>/<version>.geojson`; serve the latest export at `GET /v1/export/{city}/latest.geojson`. |
| Account hard delete | Hourly | Process deletion requests whose 7-day grace period has ended. Remove the RevenueCat subscriber first (the account id, which the app identifies for every signed-in user, and any other stored app user id; 404 counts as removed); defer deletion when that is not possible or no REST key is set for an account with subscription rows. |
| RevenueCat event job | Enqueued by `POST /v1/webhooks/revenuecat` | Apply one stored webhook event to `subscriptions` (ADR-0050 items 4 to 6). |
| Pending webhook sweep | Every 5 minutes at :30 | Process stored RevenueCat events older than one minute whose enqueue was lost or whose processing failed; the fifth failed attempt closes the event as `failed`. |
| Subscription reconciliation | Daily 04:10 Europe/Istanbul | Fetch every stored subscriber from RevenueCat REST and repair drift, including downgrades when the Plus entitlement no longer names a product (ADR-0050 item 8). One failing subscriber is counted and skipped; a refused key (401/403) stops the run; a 429 backs off exponentially (2 s doubling, 60 s cap, 4 retries) and stops the run when it persists. Skipped without `INECEKVAR_REVENUECAT_API_KEY`. |
| Expired entitlement sweep | Daily 04:40 Europe/Istanbul | Mark entitling rows whose `expires_at` has passed as `expired` (bookkeeping; `has_plus` already denies by date). |
| Retention purge | Daily 04:50 Europe/Istanbul | Delete processed `webhook_events` after 30 days and bounce suppressions after 365 days; complaints and manual entries are kept until an admin removes them (`DELETE /v1/admin/suppressions`). |
| Pack download roll-up | Daily 05:00 Europe/Istanbul | Count `pack_downloads` rows older than 90 days per city and day into `pack_download_stats` and delete them, except the earliest row of each account. |
| Backup verify (`backup.verify`) | Daily 07:30 Europe/Istanbul | List the backup prefix with the list-only identity and check the newest dump: missing, older than 26 hours, empty, under 4 KiB or without its `.sha256` sidecar logs one `backup.verify.alert` line at error level; the result is kept in Redis (`inecekvar:ops:backup-verify:last`, 8 days). Honours the dry run. ADR-0053, `docs/ops/backup-restore.md`. |
| Cost guard (`cost.guard`) | Every 15 minutes (:07, :22, :37, :52) | Count today's (UTC) mails, pack downloads, presigns, export runs and planner calls against `INECEKVAR_COST_GUARD_*`; a count at or above its threshold logs one `cost.guard.alert` at error level once per resource and day. When the hourly planner load reaches its threshold, set the planner degrade flag (`inecekvar:ops:planner-degrade`) for the cool-down, re-arm it while the load holds and clear it a cool-down after the last re-arm; an operator flag is never touched. Database or Redis errors are logged by class and never stop the run. Honours the dry run. ADR-0054, `docs/ops/cost-alerts.md`. |

The phase 5 jobs are idempotent and honour `INECEKVAR_JOBS_DRY_RUN` or a `dry_run` job argument, which wins; a dry run logs the counts it would change.

Email suppressions (ADR-0050 item 12): only a `Permanent` Resend bounce suppresses, a later `email.delivered` clears it, and an admin with a fresh TOTP step-up lifts any entry with `DELETE /v1/admin/suppressions` and the address in the JSON body (`{"email": "..."}`); the audit row `admin.suppression_removed` keeps only the keyed digest. Sign-in links to an address that bounced more than 30 days ago are tried again, at most 3 per address per day.

Every job logs counts and ids only. Logs never include coordinates, email addresses or points (`docs/ops/logging.md`).

Manual planner degrade switch: `uv run python -m app.ops.planner_degrade on --minutes 60 --reason cpu_alert --operator <slug>`, `off`, `status` (ADR-0054).
