import { LIMITS } from '@kadro/contracts';

/**
 * Email-link token handling (ADR-0040 "Token handling", threat model T-WEB-01). The token travels
 * only in the URL fragment (`#token=<base64url>`), which browsers never send to the server. These
 * helpers read it once, take it out of the address bar and the history entry, and hand it back to
 * the caller, which keeps it in memory only.
 *
 * Everything here is pure or works on injected `location` / `history` objects so it runs in Node
 * tests without a DOM.
 */

export type FragmentToken =
  | { readonly kind: 'valid'; readonly token: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOKEN_KEY = 'token';

/** True for a string that has the shape of an email token (contracts `opaqueTokenSchema`). */
export function isWellFormedToken(value: string): boolean {
  return (
    value.length >= LIMITS.opaqueToken.min &&
    value.length <= LIMITS.opaqueToken.max &&
    TOKEN_PATTERN.test(value)
  );
}

/**
 * Parses a `location.hash` value. Exactly one `token=` pair with a well-formed value is valid;
 * no fragment or no `token` key is `missing`; a repeated key, an empty or malformed value or any
 * percent-encoding is `malformed`. Other keys are ignored. The value is never decoded, so an
 * encoded token cannot smuggle characters past the format check.
 */
export function parseFragmentToken(hash: string): FragmentToken {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment === '') {
    return { kind: 'missing' };
  }
  let found: string | undefined;
  let seen = 0;
  for (const pair of fragment.split('&')) {
    const separator = pair.indexOf('=');
    const key = separator < 0 ? pair : pair.slice(0, separator);
    if (key !== TOKEN_KEY) {
      continue;
    }
    seen += 1;
    found = separator < 0 ? '' : pair.slice(separator + 1);
  }
  if (seen === 0) {
    return { kind: 'missing' };
  }
  if (seen > 1 || found === undefined || !isWellFormedToken(found)) {
    return { kind: 'malformed' };
  }
  return { kind: 'valid', token: found };
}

/** The parts of `window.location` this module reads. */
export interface LocationLike {
  readonly hash: string;
  readonly pathname: string;
}

/** The part of `window.history` this module calls. */
export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/**
 * Reads the fragment and, when there is one, replaces the current history entry with the bare
 * path, so the token leaves the address bar, the history entry and any later bookmark or share.
 * The query string is dropped as well: the token pages take no parameters. The fragment is
 * removed whatever its content, including a malformed one.
 */
export function takeFragmentToken(location: LocationLike, history: HistoryLike): FragmentToken {
  const hash = location.hash;
  const result = parseFragmentToken(hash);
  if (hash.length > 0) {
    history.replaceState(null, '', location.pathname);
  }
  return result;
}
