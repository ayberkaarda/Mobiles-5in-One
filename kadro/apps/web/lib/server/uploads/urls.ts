import { type WebEnv } from '@kadro/config';

/**
 * Public image URLs (ADR-0030): `avatarUrl` / `badgeUrl` = `MEDIA_PUBLIC_BASE_URL` + the stored
 * key. Only keys the upload worker writes are turned into URLs: `avatars/{uuid}/{uuid}.webp` and
 * `badges/{uuid}/{uuid}.webp`. Anything else (no key, an unexpected value, or no configured base
 * URL in local development) yields `null`, so a response never carries a URL built from
 * unvalidated data.
 */

const MEDIA_KEY =
  /^(?:avatars|badges)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

/** Maps a stored media key to its public URL (`null` when there is none). */
export type MediaUrlOf = (key: string | null) => string | null;

/** Joins a media base URL and a stored media key; `null` for a missing or unexpected key. */
export function mediaUrl(baseUrl: string | undefined, key: string | null): string | null {
  if (baseUrl === undefined || key === null || !MEDIA_KEY.test(key)) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, '')}/${key}`;
}

/** Bound to one configuration: `mediaUrlBuilder(runtime.env)(row.avatarKey)`. */
export function mediaUrlBuilder(env: Pick<WebEnv, 'MEDIA_PUBLIC_BASE_URL'>): MediaUrlOf {
  return (key) => mediaUrl(env.MEDIA_PUBLIC_BASE_URL, key);
}
