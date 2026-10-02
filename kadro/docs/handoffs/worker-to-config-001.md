# Handoff worker → config 001

- From: `apps/worker` (object storage for `upload.process` and `account.hard_delete`)
- To: owner of `docker-compose.yml`
- Status: open

The worker now requires `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_INCOMING_BUCKET` and `R2_MEDIA_BUCKET` (validated in `workerEnvSchema`, documented in
`.env.example` with the local values `http://localhost:9000`, `kadro-local`,
`kadro-local-storage`, `kadro-uploads-incoming`, `kadro-media`).

Request (already listed in `decisions-to-config-001` §3): a pinned MinIO service bound to
`127.0.0.1:9000` whose root user and password match those local values, a one-shot init that
creates both buckets and a public-read policy on `kadro-media` only, and the worker service
reaching it as `http://minio:9000` (override `R2_ENDPOINT` in its `environment`). Also
`stop_grace_period: 40s` on the worker service. Until then `docs/ops/worker.md` starts a temporary
MinIO container by hand.
