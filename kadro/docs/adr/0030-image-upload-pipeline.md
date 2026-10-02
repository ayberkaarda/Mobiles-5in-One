# ADR-0030: Image upload pipeline — presigned PUT with signed length, quarantine bucket, worker re-encode

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §4 (R2), §6 items 7, 22; ADR-0028; authorization matrix §3.7, §4.1, §4.2;
  threat model T-UPL-01..09

## Context

Checklist item 7 allows two uploads, `avatar` and `badge`, straight from the client to Cloudflare
R2, limited to `Content-Length` 1..2 MB and `image/jpeg|png|webp`, re-encoded by the worker with
`sharp` (WebP, max 1024 px, EXIF stripped), rejected by magic bytes, at most 10 per user per day.

A presigned S3 `PUT` signs one exact `Content-Length`; a byte **range** can only be expressed in a
presigned `POST` policy (`content-length-range`). R2's S3 compatibility does not implement
browser `POST` object uploads (`PostObject`); it supports presigned `GET`, `HEAD`, `PUT` and
`DELETE`.

## Decision

### Transport: presigned PUT with a signed exact length

- `POST uploads/presign` takes `{ kind, teamId?, contentType, contentLength }`. The server checks
  `contentType ∈ {image/jpeg, image/png, image/webp}` and `1 ≤ contentLength ≤ 2 097 152`
  (`LIMITS.uploadBytes`); anything else → 400 `validation_failed`. **The range is enforced here.**
- The server presigns a `PUT` whose signed headers include `content-length`, `content-type` and
  `host` (`X-Amz-SignedHeaders`), valid for 300 s. R2 verifies the SigV4 signature, so a body of
  any other length or type fails with 403 at R2. **The exact length is enforced at R2.** A test
  asserts the signed-header list of every issued URL.
- The worker checks the stored object size again (`HEAD`) before reading it: defence in depth if a
  signing library ever stops signing the length.

### Buckets and keys

| Bucket                   | Access                                                                                                      | Lifecycle                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------- |
| `kadro-uploads-incoming` | private; web key: `PutObject` only; worker key: read, delete                                                | objects deleted after 1 day |
| `kadro-media`            | worker key: read, write, delete; public read through the media domain (`MEDIA_PUBLIC_BASE_URL`), no listing | none (deleted explicitly)   |

- Incoming key: `incoming/{kind}/{ownerId}/{uploadId}` with `ownerId` = actor id (avatar) or team
  id (badge). The client never chooses, sees or submits any storage key.
- Published key: `avatars/{userId}/{uploadId}.webp`, `badges/{teamId}/{uploadId}.webp`. Unique per
  upload, so published objects are immutable and served with
  `Cache-Control: public, max-age=31536000, immutable`, `Content-Type: image/webp` and
  `X-Content-Type-Options: nosniff`.
- Unprocessed bytes are never publicly reachable: the incoming bucket has no public domain.

### Upload record and states

Table `uploads`: `id`, `user_id` (uploader), `kind`, `team_id` (badge), `content_type`,
`content_length`, `status`, `reject_reason`, `media_key`, timestamps.

| Status       | Set by                                      | Meaning                                           |
| ------------ | ------------------------------------------- | ------------------------------------------------- |
| `pending`    | presign                                     | URL issued, bytes may or may not be in R2         |
| `processing` | `POST uploads/:id/complete`                 | `upload.process` enqueued                         |
| `ready`      | worker                                      | WebP published and applied to the avatar or badge |
| `rejected`   | worker                                      | `reject_reason` set (list below)                  |
| `deleted`    | worker (replacement, sweep, account delete) | Published object removed                          |

Reject reasons (`upload_reject_reason` in `packages/contracts` and `packages/db`): `missing`,
`size_mismatch`, `not_an_image`, `type_mismatch`, `too_many_pixels`, `decode_failed`, `expired`
(not completed within 1 h) and `not_allowed` (the uploader lost the right to apply the image before
processing finished: avatar → account no longer active; badge → no longer captain or co-captain, or
the team was deleted).

Endpoints (in the `packages/contracts` registry):

- `POST uploads/presign` → 201 `{ uploadId, url, method: 'PUT', headers, expiresAt }`.
- `POST uploads/:id/complete` → 202 `{ status: 'processing' }`; only the uploader, only from
  `pending`, within 1 h of presign (else 409 `upload_not_pending`).
- `GET uploads/:id` → `{ id, kind, status, rejectReason, url }`; only the uploader (others 404).

### Processing (`upload.process`, payload `{ uploadId }`)

1. Load the upload; continue only when `status = 'processing'`.
2. `HEAD` the incoming object: missing → `missing`; size ≠ `content_length` or outside 1..2 MB →
   `size_mismatch`.
3. Read at most 2 MB. **Magic bytes** must match a supported format and the declared
   `content_type`: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`. Otherwise
   `not_an_image` or `type_mismatch`. No decision is based on the file name or the client's type
   alone.
4. Decode with `sharp` and fixed limits: `limitInputPixels: 25 000 000` (pixel-flood and
   decompression-bomb guard, rejected as `too_many_pixels`), `failOn: 'error'`, first frame only
   (animated WebP is flattened), one libvips thread per job, 20 s timeout. Then `.rotate()` (apply
   EXIF orientation), resize to fit inside 1024 × 1024 without enlargement, encode WebP quality 80.
   `sharp` writes no metadata unless asked, so EXIF, GPS, XMP and ICC comments are dropped.
5. Re-check authorization at apply time: avatar → uploader still active; badge → uploader still
   captain or co-captain of the team and the team still exists. Otherwise `not_allowed`.
6. Put the WebP to the media bucket, then in one transaction: set `users.avatar_key` or
   `teams.badge_key` to the media key, mark the previous upload of the same target `deleted`
   (its object is deleted after commit), set this upload `ready`.
7. Delete the incoming object in every outcome.

### Field updates

- `avatar_key` and `badge_key` are **server-only**: only step 6 writes them. `PATCH me` and
  `PATCH teams/:id` accept `avatar: null` / `badge: null` to remove the image (the worker deletes
  the object through `maintenance.sweep`). A client never submits a storage key. This replaces the
  "key must start with … and be processed" rule of the Phase 1 matrix §4.1 and §4.2.
- Responses expose `avatarUrl` / `badgeUrl` = `MEDIA_PUBLIC_BASE_URL` + key, or `null`.

### Quota and orphans

- Quota: rate-limit group U, 10 presigns per user per rolling 24 h (counted at presign, whether or
  not the upload completes). Badge presigns count against the uploader.
- `maintenance.sweep`: `pending` older than 1 h → `rejected` (`expired`) and incoming object
  deleted; published objects whose upload is `deleted` or no longer referenced are removed from the
  media bucket. The 1-day lifecycle rule on the incoming bucket removes anything the sweep missed.

## Consequences

- An oversized or wrong-type upload is refused at presign (400) or at R2 (403); a lying client
  cannot store more than it declared.
- Everything publicly served is a fresh WebP produced by the worker; polyglots, scripts and
  metadata never reach the public domain.
- Local development uses MinIO with the same two buckets (handoff `decisions-to-config-001`);
  MinIO verifies SigV4 signed headers the same way.
- New table `uploads` (handoff `decisions-to-db-001`); `sharp` and an S3 client in the worker; an
  S3 presigner in the web app.

## Rejected alternatives

- **Presigned POST policy with `content-length-range`.** Not available on R2; moving uploads to
  another object store only for this would add a vendor and a second set of credentials, while the
  signed exact length gives the same guarantee.
- **Upload through the API (multipart to Next.js).** Puts image bytes through the web process and
  the 1 MB JSON body limit path; the spec places bytes on R2 directly.
- **Process on R2 event notifications.** Needs Cloudflare Queues and a consumer outside the
  stack; the explicit `complete` call is simpler and authenticated.
- **Client sets `avatar_key` / `badge_key` after processing.** Adds a write path for storage keys
  that must then be validated against ownership and processing state; letting the worker apply the
  result after its own permission re-check removes that path.
