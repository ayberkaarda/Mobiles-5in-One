import { type WebEnv } from '@kadro/config';

/**
 * Web session cookies (security checklist item 12, ADR-0014). Both names carry the `__Host-`
 * prefix (enforced by `@kadro/config`), so browsers require `Secure`, `Path=/` and no `Domain`.
 *
 * - Session cookie: opaque token of a `refresh_tokens` row with `client = 'web'`; HttpOnly,
 *   SameSite=Lax, rolling 7-day lifetime.
 * - CSRF cookie: signed double-submit token (`@kadro/auth` `createCsrfService`); readable by the
 *   page so it can echo the value in `x-csrf-token`, SameSite=Lax, same lifetime.
 */

export type CookieEnv = Pick<WebEnv, 'SESSION_COOKIE_NAME' | 'CSRF_COOKIE_NAME'>;

export type CookieLookup =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'present'; readonly value: string };

/**
 * Reads one cookie from a `Cookie` header. A name that appears more than once (cookie tossing)
 * is reported as `ambiguous` so the caller can reject the request instead of guessing.
 */
export function readCookie(header: string | null, name: string): CookieLookup {
  if (header === null) {
    return { kind: 'absent' };
  }
  const values: string[] = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      values.push(part.slice(separator + 1).trim());
    }
  }
  if (values.length === 0) {
    return { kind: 'absent' };
  }
  if (values.length > 1) {
    return { kind: 'ambiguous' };
  }
  return { kind: 'present', value: values[0] ?? '' };
}

const COOKIE_VALUE = /^[A-Za-z0-9_-]{1,256}$/;

function serialize(name: string, value: string, maxAgeSeconds: number, httpOnly: boolean): string {
  if (!COOKIE_VALUE.test(value) && value !== '') {
    throw new RangeError('cookie value must be base64url');
  }
  const attributes = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    'Secure',
    'SameSite=Lax',
  ];
  if (httpOnly) {
    attributes.push('HttpOnly');
  }
  return attributes.join('; ');
}

export function sessionCookie(env: CookieEnv, token: string, maxAgeSeconds: number): string {
  return serialize(env.SESSION_COOKIE_NAME, token, maxAgeSeconds, true);
}

export function csrfCookie(env: CookieEnv, token: string, maxAgeSeconds: number): string {
  return serialize(env.CSRF_COOKIE_NAME, token, maxAgeSeconds, false);
}

/** Expires both cookies (logout, revoked session). */
export function clearedSessionCookies(env: CookieEnv): string[] {
  return [
    serialize(env.SESSION_COOKIE_NAME, '', 0, true),
    serialize(env.CSRF_COOKIE_NAME, '', 0, false),
  ];
}
