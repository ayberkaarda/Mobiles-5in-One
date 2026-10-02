import { newId } from '@kadro/db';
import { describe, expect, it } from 'vitest';

import { incomingKey, mediaKey, publishedKey } from '../../lib/server/uploads/keys';
import { mediaUrl, mediaUrlBuilder } from '../../lib/server/uploads/urls';

/** Object keys and public image URLs (ADR-0030, handoff worker-to-web-002). */

describe('upload keys', () => {
  it('derives the incoming, published and media keys from kind, owner and upload id', () => {
    const ownerId = newId();
    const uploadId = newId();
    expect(incomingKey({ kind: 'avatar', ownerId, uploadId })).toBe(
      `incoming/avatar/${ownerId}/${uploadId}`,
    );
    expect(incomingKey({ kind: 'badge', ownerId, uploadId })).toBe(
      `incoming/badge/${ownerId}/${uploadId}`,
    );
    expect(publishedKey({ kind: 'avatar', ownerId, uploadId })).toBe(
      `avatars/${ownerId}/${uploadId}`,
    );
    expect(publishedKey({ kind: 'badge', ownerId, uploadId })).toBe(
      `badges/${ownerId}/${uploadId}`,
    );
    expect(mediaKey(`avatars/${ownerId}/${uploadId}`)).toBe(`avatars/${ownerId}/${uploadId}.webp`);
  });
});

describe('mediaUrl', () => {
  const key = `badges/${newId()}/${newId()}.webp`;

  it('joins the base URL and a worker-written key, with or without a trailing slash', () => {
    expect(mediaUrl('https://media.kadro.app', key)).toBe(`https://media.kadro.app/${key}`);
    expect(mediaUrl('https://media.kadro.app/', key)).toBe(`https://media.kadro.app/${key}`);
    expect(mediaUrl('http://localhost:9000/kadro-media', key)).toBe(
      `http://localhost:9000/kadro-media/${key}`,
    );
    expect(mediaUrlBuilder({ MEDIA_PUBLIC_BASE_URL: 'https://media.kadro.app' })(key)).toBe(
      `https://media.kadro.app/${key}`,
    );
  });

  it('returns null without a key, without a base URL, and for anything the worker never writes', () => {
    expect(mediaUrl('https://media.kadro.app', null)).toBeNull();
    expect(mediaUrl(undefined, key)).toBeNull();
    expect(mediaUrlBuilder({ MEDIA_PUBLIC_BASE_URL: undefined })(key)).toBeNull();
    for (const bad of [
      key.replace('.webp', ''),
      key.replace('.webp', '.png'),
      `incoming/avatar/${newId()}/${newId()}`,
      `avatars/${newId()}/../${newId()}.webp`,
      `https://evil.example/${key}`,
      `/${key}`,
      `${key}?x=1`,
    ]) {
      expect(mediaUrl('https://media.kadro.app', bad), bad).toBeNull();
    }
  });
});
