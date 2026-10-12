# ADR-0028: Object storage interface, phase 2 schema change and background jobs

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, lead foundation

## Context

Phase 2 needs object storage (photos, exports), workers (photo processing, trace retention,
account hard delete, weekly export) and new collaborators that are not available yet in
production (TOTP step-up, RevenueCat). Section 4 names `arq`, `aioboto3`, Pillow, shapely and
networkx; schema changes go through a new Alembic revision only.

## Decision

- `Services` gains `object_store`, `entitlements`, `step_up` and `subscriber_deleter`, all
  optional; `None` fails closed (503 for storage, no Plus, no step-up, deferred erasure).
  `build_services` wires the S3 store when `INECEKVAR_S3_ENDPOINT_URL` is set and
  `SubscriptionEntitlements`; `with_local_defaults` points a local run at the compose MinIO.
- Revision `0003`: `photos.processed_at` and an index on `traces.linked_edit_id`. Line versions
  and line stops were already immutable through the phase 1 triggers, so no new trigger.
- New settings (`docs/ops/env.md`): S3 endpoint, region, keys, buckets, presign lifetime, photo
  size, planner timeout and cache lifetime, PMTiles base URL, trace retention and deletion grace;
  new rate rules `media.presign` (20 per day) and `pack.download` (10 per day).
- Jobs run under `arq` (`uv run arq app.workers.main.WorkerSettings`; the settings class is
  built on first access so importing the module reads no environment): photos every minute,
  trace purge hourly at minute 5, hard delete hourly at minute 20, export Monday 03:00, time zone
  Europe/Istanbul (`tzdata` added so Windows has the zone). Jobs log counts only
  (`docs/ops/background-jobs.md`).
- Tests reach a real S3 API through a Testcontainers MinIO (`s3_endpoint`, `s3_buckets`
  fixtures, fresh buckets per test) unless `INECEKVAR_TEST_S3_URL` is set; CI uses the
  Testcontainers path because a service container cannot pass the MinIO `server` command.
- Dependencies added: `arq` 0.25.0, `boto3`, `networkx` 3.7, `pillow` 12.3.0, `tzdata`; dev:
  `hypothesis`, `boto3-stubs[s3]`, `types-networkx`, `testcontainers[minio]`.

## Evidence

| # | Check | Command or test | Result |
| - | ----- | --------------- | ------ |
| 1 | Migration and model agree | `tests/migrations` (upgrade, downgrade, upgrade; metadata comparison) | passed |
| 2 | Storage contract on MinIO | `tests/core/test_storage.py` (5) | passed |
| 3 | Worker schedule and jobs | `tests/workers/test_main.py` (3) | passed |
| 4 | Compose stack for the phase gate | `docker compose -p inecekvar-p2 up -d --wait postgres redis minio` with host ports 57632 to 57635 (57651 to 57750 are reserved by Windows on this host), then `minio-init` | healthy; buckets created |
| 5 | Worker process | `uv run arq app.workers.main.WorkerSettings --burst` against the compose Redis after enqueueing the four jobs | started for 8 functions (4 jobs, 4 cron entries); `traces_job` 0, `photos_job` 0, `deletion_job` 0, `export_job` 1 export written |

Not exercised:

- `not exercised: cron firing over real time` (burst mode runs enqueued jobs; schedules are asserted in tests).
- `not exercised: R2 and production hosting` (no account, no host; ADR-0002).
