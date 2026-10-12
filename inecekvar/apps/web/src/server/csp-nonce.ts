import { randomBytes } from 'node:crypto';
import { NONCE_PLACEHOLDER } from '../app/csp-nonce-placeholder';

export { NONCE_PLACEHOLDER } from '../app/csp-nonce-placeholder';

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

export function applyNonce(html: string, nonce: string): string {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(nonce)) {
    throw new Error('Invalid CSP nonce');
  }
  // Anchored to an attribute inside a start tag: the server renderer escapes `<` and `>` in text
  // but leaves quotes raw, so a text node can spell `nonce="…"` yet never sits inside `<tag …>`.
  return html.replace(
    new RegExp(
      `(<[a-z][a-z0-9-]*[^<>]*?\\s(?:nonce|ngcspnonce)=")${NONCE_PLACEHOLDER}("(?=\\s|/?>))`,
      'gi',
    ),
    (_, prefix: string, suffix: string) => `${prefix}${nonce}${suffix}`,
  );
}
