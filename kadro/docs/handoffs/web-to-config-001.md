# Handoff web → config 001

- From: `apps/web` uploads endpoints (ADR-0030)
- To: owner of `docker-compose.yml`, CI workflows and deployment configuration
- Status: open

## New web configuration keys

`webEnvSchema` (`packages/config`) now reads:

| Key                                                                             | Local                                                                        | Preview / production                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------ |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_INCOMING_BUCKET` | optional, all four together; without them `POST uploads/presign` answers 503 | required; endpoint non-loopback `https://` |
| `MEDIA_PUBLIC_BASE_URL`                                                         | optional; without it every image URL is `null`                               | required; non-loopback `https://`          |

The names match the worker's keys, but the web app needs its **own** key pair with `PutObject` on
the incoming bucket only (ADR-0030); it never reads `R2_MEDIA_BUCKET`. `.env.example` documents
`MEDIA_PUBLIC_BASE_URL` with the local value `http://localhost:9000/kadro-media`.

## Compose: the presign endpoint must be reachable by the client

The presigned URL is built from `R2_ENDPOINT`, and the phone or browser sends the PUT to it. The
worker inside compose may use the internal name (`http://minio:9000` in `worker-to-config-001`),
but the **web** service must keep a host the client can reach (`http://localhost:9000` for a
simulator, the machine's LAN address for a physical device). Do not copy the worker's internal
override to the web service. `MEDIA_PUBLIC_BASE_URL` follows the same rule.
