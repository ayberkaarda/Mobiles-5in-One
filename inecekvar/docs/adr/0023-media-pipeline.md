# ADR-0023: Photo upload and processing pipeline

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, package 2B

## Context

Section 6.7: photos only (`image/jpeg|image/webp`, at most 4 MB) through a presigned R2 PUT bound
by `Content-Length`; a worker re-encodes with Pillow (WebP, 1600 px, metadata stripped) after a
magic-byte check and quarantines failures; 20 uploads per user per day; traces are JSON, never
file uploads. Proof asked: MIME spoof and oversize rejected, stored objects carry no EXIF.

## Decision

- Object storage sits behind `app.core.storage.ObjectStore` (boto3 S3 client in a worker
  thread; MinIO locally and in tests, R2 in production). Keys are built from server ids only:
  `incoming/<photo_id>`, `photos/<photo_id>.webp`, `quarantine/<photo_id>`. Without a configured
  store the media routes answer `503 storage.unavailable`.
- `POST media/presign` needs `propose_edit` (licence accepted), the `media.presign` quota (20 per
  day), `content_type` in the two allowed types and `byte_size` up to 4 MiB (422 above); it
  creates a `photos` row (`pending`) and returns a 5 minute presigned PUT that signs
  `Content-Type` and `Content-Length`, so the store refuses any other size or type.
- The worker (`app/workers/media.py`, every minute) reads at most 4 MiB, checks the magic bytes
  against the declared type, opens with a 40 megapixel limit and decompression-bomb warnings as
  errors, verifies, applies the EXIF orientation, converts to RGB, scales to at most 1600 px and
  saves WebP quality 80 without EXIF, ICC or XMP; it writes `photos/<id>.webp`, deletes the
  incoming object and records `processed_at` (migration 0003). Any failure copies the original
  to `quarantine/<id>`, deletes the incoming object and marks the row `quarantined`. A missing
  upload waits until the presign window passed.
- Edits accept `photo_id` only for the author's processed, non-quarantined photo; the photo id is
  kept in `edits.photo_id`, never in the public payload. Photos are not public in phase 2.

## Consequences

- boto3 replaces aioboto3 named in the specification: presigning is local computation and the
  few blocking calls run in threads; the typed stubs (`boto3-stubs[s3]`) keep `mypy --strict`.
- A photo is not reviewable until the next worker run (at most a minute).

## Evidence

Command: `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/media tests/core/test_storage.py` (11 and 5 tests against a Testcontainers MinIO `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, all passed).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Presigned PUT binds length and type | `tests/core/test_storage.py::test_presigned_put_accepts_exact_length`, `test_presigned_put_rejects_other_length_or_type` (longer, shorter, other type: 403), `tests/media/test_media.py::test_upload_longer_than_presigned_length_refused` | passed |
| 2 | Stored object has no metadata | `test_presign_put_and_process_strips_exif` (JPEG with EXIF GPS, 3000 px in; WebP out, empty EXIF, no ICC or XMP, longest side 1600) | passed |
| 3 | MIME spoof and bombs | `test_mime_spoof_is_quarantined`, `test_decompression_bomb_quarantined` | passed |
| 4 | Oversize | `test_oversize_rejected_at_presign` (4 MiB + 1 is 422) | passed |
| 5 | Quota and licence | `test_presign_quota_20_per_day`, `test_presign_requires_licence` | passed |
| 6 | Attachment rules | `test_photo_attachment_is_private`, `test_photo_attachment_requires_owner_and_nonquarantined`, `test_missing_upload_waits_until_ttl` | passed |

Not exercised:

- `not exercised: Cloudflare R2` (no account; MinIO is the S3 stand-in, ADR-0005).
- `not exercised: human photo moderation` (phase 4 admin UI).
