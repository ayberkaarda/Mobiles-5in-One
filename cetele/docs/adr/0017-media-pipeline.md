# ADR-0017: Media pipeline

- Status: Accepted
- Date: 2026-10-06
- Deciders: Ayberk (owner)

## Context

An entry can carry one photo of a handwritten note or a receipt (spec section 3, story 4; asset A8
of the [threat model](../security/threat-model.md)). Photos may contain names and amounts, come from
a phone camera with location metadata, and arrive from a client the server does not trust. Spec item
7 asks for a size limit at presign, a check of the real content type, a re-encode and a quota.
Multipart is turned off on the server (`spring.servlet.multipart.enabled=false`), so bytes never
pass through the API.

## Options considered

- Upload through the API as multipart: the server buffers untrusted bytes in the request path and
  the body limit of 1 MiB ([ADR-0010](0010-security-headers-csp-and-https.md)) would have to be
  lifted. Rejected.
- Presigned `PUT` straight to object storage, then an explicit completion call that processes the
  object in the request: chosen. A queue and a worker would add a second moving part for a step
  that takes milliseconds on a 1.2 MB image.

## Decision

### Presign

`POST /v1/shops/{shopId}/media/presign` (`MEDIA_PRESIGN`; decision D-4 of the
[authorization matrix](../security/authorization-matrix.md) is settled here: `STAFF` may presign,
because story 4 lets staff create entries with a photo) takes
`{contentType: "image/jpeg" | "image/webp", contentLength: 1..1200000}` and answers 201
`{mediaId, uploadUrl, method: "PUT", headers, expiresAt, photoKey}`. The signature covers
`Content-Type` and `Content-Length`, so storage refuses an upload with another length. The URL lives
10 minutes and points at `uploads/<shopId>/<mediaId>`. `photoKey` is the future processed key
`media/<shopId>/<mediaId>.jpg`, so a device can store the entry offline before completion. Bucket
`media.presign.user`, 60 per 10 minutes.

- `MediaPresignTest`: `signed headers upload and a changed length is refused`
- `MediaPresignTest`: `invalid lengths and types carry field codes`

### Quota

Under `ShopLocks.mediaQuota`, the `READY` and `PENDING` objects of the shop created this month
(`Europe/Istanbul`) are counted; at `PlanLimits.photosPerMonth` (FREE 200, PRO 2000,
[ADR-0014](0014-ledger-model.md)) the answer is `409 plan.photo_limit`
(`MediaPresignTest`: `pending and ready slots count toward the monthly quota`). Counting `PENDING`
objects keeps an abandoned presign from being free; the sweeper releases them.

### Completion

`POST /v1/shops/{shopId}/media/{mediaId}/complete` (`MEDIA_PRESIGN`, bucket `media.complete.user`)
runs the processing inside the request:

1. The row must be `PENDING` and belong to the path shop, else 404 (an already `READY` row answers
   200 with the same body, so a retry is safe). The object must exist (`409 media.not_uploaded`).
2. A length above the declared length or above 1 200 000 bytes is `413 media.too_large`; the object
   is deleted and the row is `FAILED`.
3. Apache Tika detects the type from the bytes, whatever was declared: only `image/jpeg` and
   `image/webp` pass, anything else (a renamed PDF) is `422 media.invalid`, the object is deleted
   and the row is `FAILED` with a `failure_code`. Dimensions are read from the image header before
   any pixel decode, and more than 6000 by 6000 pixels is `media.invalid`.
4. The image is decoded (WebP through TwelveMonkeys `imageio-webp`), scaled so the longest side is
   at most 1600 pixels and re-encoded as JPEG at quality 0.85 with Thumbnailator. No metadata is
   carried over, so EXIF and location are gone. The output is always JPEG.
5. The result is written to `media/<shopId>/<mediaId>.jpg`, the upload object is deleted and the
   row becomes `READY` with `width`, `height`, `bytes` and `ready_at`. The response is
   `{mediaId, photoKey, status, width, height, bytes}`.

- `MediaCompleteTest`: `renamed pdf and undecodable images fail persistently and delete originals`
- `MediaCompleteTest`: `image dimensions are checked before decode`
- `MediaCompleteTest`: `missing upload stays pending and an oversized upload fails`
- `MediaCompleteTest`: `large jpeg is resized without exif and completion is idempotent`
- `MediaCompleteTest`: `webp is decoded and stored as jpeg`

### Keys and shop prefix

Every object key starts with the shop id, so one prefix delete removes a shop's data
([ADR-0018](0018-account-and-shop-deletion.md)). A ledger entry may reference only a `photo_key`
that matches `^media/<path shop id>/<uuid>.jpg$` (regex at push, constraint in the database), so a
key of another shop can never be referenced. `media_objects.photo_key` is unique.

### Download

`GET /v1/shops/{shopId}/media/{mediaId}` (`LEDGER_READ`, bucket `media.download.user`, 300 per 10
minutes) answers `{mediaId, status, photoKey, downloadUrl, expiresAt}` with a presigned `GET` valid
10 minutes, only for a `READY` object (`409 media.not_ready` otherwise, 404 for another shop,
identical to a missing id). A leaked download or upload URL works until its expiry; the residual
risk is in threat model 4.12.

- `MediaDownloadTest`: `only ready objects have a working ten minute download`
- `MediaIsolationTest`: `foreign complete and download have the same not found body as missing media`

### Sweeper

`MediaSweeper` runs hourly behind `cetele.jobs.enabled` under `JobLocks`. A `PENDING` row whose
`upload_expires_at` is more than 24 hours old gets its upload object deleted and becomes `EXPIRED`
(`MediaSweeperTest`: `only pending uploads older than the full grace are expired`). `FAILED` and
`EXPIRED` rows are removed after 7 days by the retention job.

### Storage

`MediaStore` is the only code that touches storage; `S3MediaStore` uses the AWS SDK v2 (BOM 2.55.11,
`s3` with the URL-connection client) with path-style addressing and the endpoint from
`cetele.s3.*`. Storage is mandatory from Phase 2: startup fails when the endpoint or the credentials
are empty. The region defaults to `auto` (what Cloudflare R2 expects) in `application.yml`, compose
and `.env.example`, and MinIO accepts it with Signature V4; an earlier test override (`us-east-1`)
was dropped so tests and compose use the same value. Other resolved versions: Tika core 4.1.0,
Thumbnailator 0.4.21, TwelveMonkeys `imageio-webp` 3.15.2, Testcontainers MinIO from the Spring
Boot managed Testcontainers BOM (2.0.5). `MediaStore.get` refuses more than 1 200 000 bytes.

## Consequences

- A bad image is rejected after upload, not at presign: the declared type is only a claim and the
  real check is the Tika detection plus a full decode. A decode bomb is cut by the size and
  dimension checks before the pixel buffer exists.
- Processing runs in the request thread. At 1.2 MB and 1600 pixels that is acceptable; a larger
  limit would need a queue.
- Original bytes are not kept: the processed JPEG is the only copy.
- Evidence: `MediaPresignTest`, `MediaCompleteTest`, `MediaDownloadTest`, `MediaIsolationTest`,
  `MediaPermissionTest`, `MediaSweeperTest`, `MediaLogSampleTest`, `V5ServicesSchemaTest`, all
  against a MinIO Testcontainer. Not exercised: Cloudflare R2 itself
  (`not exercised: no R2 account`, [ADR-0004](0004-portfolio-delivery-scope.md) G5), and a real phone
  camera upload (Phase 3).
