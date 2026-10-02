# Handoff worker → web 002

- From: `apps/worker` (`upload.process`, `account.hard_delete`, ADR-0030, ADR-0032)
- To: owner of `apps/web` (uploads endpoints, `DELETE me`)
- Status: open

Both handlers are active. The web side must produce objects and jobs in the shape the worker reads.

## 1. Uploads (ADR-0030)

- `uploads.key` is the published key **without** extension (`avatars/{userId}/{uploadId}`,
  `badges/{teamId}/{uploadId}`, enforced by the `uploads_key_matches_owner` check). The worker
  publishes to `{key}.webp` and writes exactly that value to `users.avatar_key` /
  `teams.badge_key`. Public URLs are `MEDIA_PUBLIC_BASE_URL + avatar_key`.
- The presigned PUT must target the incoming bucket at
  `incoming/{kind}/{ownerId}/{uploadId}` (owner = uploader for `avatar`, team for `badge`); this is
  `incomingKey()` in `apps/worker/src/uploads/keys.ts`. Any other key is reported `missing`.
- `POST uploads/:id/complete` sets `processing` and enqueues `upload.process`
  `{ uploadId, idempotencyKey: 'upload:<uploadId>' }` in the same transaction.
- `GET uploads/:id` reads the outcome: `ready`, or `rejected` with `missing`, `size_mismatch`,
  `not_an_image`, `type_mismatch`, `too_many_pixels`, `decode_failed`, `not_allowed`, `expired`.
- `PATCH me { avatar: null }` / `PATCH teams/:id { badge: null }` only clear the field; the
  hourly `maintenance.sweep` retires the upload and removes the object (objects older than one hour
  that nothing references are deleted).

## 2. Account deletion (ADR-0032)

`DELETE me` enqueues `account.hard_delete` `{ deletionRequestId, idempotencyKey:
'delete:<deletionRequestId>' }` with `startAfter = grace_until`. The worker runs only when the
request is still pending, the grace period is over and `users.deactivated_at` is set; a login that
cancels the deletion (request row deleted or `deactivated_at` cleared) makes the job a no-op. The
`deletion_completed` email is sent by the worker; the web app sends nothing for it.

## 3. Team deletion by staff

`DELETE teams/:id` cascades the team's `uploads` rows; its badge objects are then unreferenced and
removed by `maintenance.sweep` within about two hours. No extra web work is needed.
