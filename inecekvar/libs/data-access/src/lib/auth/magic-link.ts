/** `secrets.token_urlsafe(32)` gives 43 characters; allow some room, nothing outside base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Reads `token` from a URL fragment such as `#token=abc`. The API mails the token in the
 * fragment (ADR-0007) so it never reaches a server log or a `Referer` header.
 * Returns `{ present }` whenever a `token` member exists, so the caller strips it even when
 * the value is malformed.
 */
export function readMagicLinkFragment(hash: string): { present: boolean; token: string | null } {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment === '') return { present: false, token: null };
  const params = new URLSearchParams(fragment);
  if (!params.has('token')) return { present: false, token: null };
  const token = params.get('token') ?? '';
  return { present: true, token: TOKEN_PATTERN.test(token) ? token : null };
}

/** The fragment of an absolute or relative URL, including `#`, or ''. */
export function fragmentOf(url: string): string {
  const index = url.indexOf('#');
  return index === -1 ? '' : url.slice(index);
}
