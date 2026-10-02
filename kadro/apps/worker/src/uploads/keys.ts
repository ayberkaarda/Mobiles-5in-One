import { type Upload } from '@kadro/db';

/**
 * Object keys of ADR-0030. The server derives every key from the upload row; a client never
 * chooses one. `uploads.key` is the published key without its extension.
 */

/** `incoming/{kind}/{ownerId}/{uploadId}`: owner = uploader (avatar) or team (badge). */
export function incomingKey(upload: Pick<Upload, 'id' | 'kind' | 'userId' | 'teamId'>): string {
  const owner = upload.kind === 'avatar' ? upload.userId : upload.teamId;
  if (owner === null) {
    throw new Error('badge upload without a team');
  }
  return `incoming/${upload.kind}/${owner}/${upload.id}`;
}

/** `avatars/{userId}/{uploadId}.webp` or `badges/{teamId}/{uploadId}.webp`. */
export function mediaKey(upload: Pick<Upload, 'key'>): string {
  return `${upload.key}.webp`;
}

export function avatarPrefixes(userId: string): { media: string; incoming: string } {
  return { media: `avatars/${userId}/`, incoming: `incoming/avatar/${userId}/` };
}

export function badgePrefixes(teamId: string): { media: string; incoming: string } {
  return { media: `badges/${teamId}/`, incoming: `incoming/badge/${teamId}/` };
}
