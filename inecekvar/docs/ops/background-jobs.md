# Background jobs

Run the worker with `uv run arq app.workers.main.WorkerSettings`. It connects to Redis using `INECEKVAR_REDIS_URL`; Redis also holds the planner cache.

| Job | Schedule | Work |
| --- | --- | --- |
| Trace retention purge | Hourly | Delete raw traces after `delete_after` passes: 30 days after the derived version is published, or 30 days after upload if never published. |
| Photo processing | Every minute | Check magic bytes, re-encode valid photos as WebP at 1600 px without metadata, and quarantine failures. |
| Weekly city export | Monday 03:00 Europe/Istanbul | Create one GeoJSON export per city at `exports/<city>/<version>.geojson`; serve the latest export at `GET /v1/export/{city}/latest.geojson`. |
| Account hard delete | Hourly | Process deletion requests whose 7-day grace period has ended. Remove subscribers at the billing provider first; defer deletion when that is not possible. |

Every job logs counts and ids only. Logs never include coordinates, email addresses or points.
