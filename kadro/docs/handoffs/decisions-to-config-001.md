# Handoff decisions → config 001

- From: Phase 2 decisions (`docs/adr/0028` … `0031`)
- To: owner of `packages/config`, `.env.example` and `docker-compose.yml`
- Status: open

## 1. Worker environment (`workerEnvSchema`)

Add: `WEB_ORIGIN`; `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM` (same rules as today in the
web schema: `log` only with `APP_ENV=local`); `PUSH_TRANSPORT` (`log | expo`, same local-only
rule), `EXPO_ACCESS_TOKEN` (required for `expo`); `PUSH_HOURLY_CAP` (int 1..100 000, default
5 000); `R2_ENDPOINT` (https outside local), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_INCOMING_BUCKET`, `R2_MEDIA_BUCKET`, `MEDIA_PUBLIC_BASE_URL` (https outside local).

## 2. Web environment (`webEnvSchema`)

Remove `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM` once the web app stops sending email
(ADR-0029, same release). Add `R2_ENDPOINT`, `R2_UPLOAD_ACCESS_KEY_ID`,
`R2_UPLOAD_SECRET_ACCESS_KEY` (a key limited to writing the incoming bucket),
`R2_INCOMING_BUCKET`, `MEDIA_PUBLIC_BASE_URL`. A check refuses the web upload key being equal to
the worker key when both are present in one environment file.

## 3. `.env.example` and local stack

- Document every new key with a local dummy value.
- `docker-compose.yml`: an S3-compatible storage service (MinIO, pinned image) bound to
  `127.0.0.1`, with a one-shot init that creates `kadro-uploads-incoming` and `kadro-media`, and a
  public-read policy on `kadro-media` only. Worker service `stop_grace_period: 40s` (ADR-0028).

## 4. Secret rotation list

`docs/security/history-purge-runbook.md` already lists `EXPO_ACCESS_TOKEN` and both R2 key pairs
under the names above; keep the variable names identical when implementing.

Acceptance: config tests cover each new rule (local-only transports, https outside local, required
keys per transport, distinct R2 keys); `pnpm --filter @kadro/config test` green.
