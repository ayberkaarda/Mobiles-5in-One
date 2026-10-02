import { type UploadKind } from '@kadro/contracts';

/**
 * Object keys of ADR-0030, derived on the server from the upload row; a client never chooses,
 * sees or submits one. They match `apps/worker/src/uploads/keys.ts` and the
 * `uploads_key_matches_owner` database check (handoff worker-to-web-002).
 *
 * - owner: the uploader for `avatar`, the team for `badge`;
 * - `uploads.key`: published key without extension, `avatars/{userId}/{uploadId}` or
 *   `badges/{teamId}/{uploadId}`; the worker publishes `{key}.webp`;
 * - incoming key: `incoming/{kind}/{ownerId}/{uploadId}` in the private incoming bucket, the
 *   only object the presigned PUT can write.
 */

export interface UploadKeyInput {
  readonly kind: UploadKind;
  /** Uploader (avatar) or team (badge). */
  readonly ownerId: string;
  readonly uploadId: string;
}

export function publishedKey(input: UploadKeyInput): string {
  const prefix = input.kind === 'avatar' ? 'avatars' : 'badges';
  return `${prefix}/${input.ownerId}/${input.uploadId}`;
}

export function incomingKey(input: UploadKeyInput): string {
  return `incoming/${input.kind}/${input.ownerId}/${input.uploadId}`;
}

/** Media object of a processed upload: `{uploads.key}.webp` (the value of `avatar_key` / `badge_key`). */
export function mediaKey(key: string): string {
  return `${key}.webp`;
}
