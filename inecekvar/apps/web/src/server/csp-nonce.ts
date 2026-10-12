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
  return html.replace(
    new RegExp(`(\\s(?:nonce|ngcspnonce)=")${NONCE_PLACEHOLDER}("(?=\\s|/?>))`, 'gi'),
    (_, prefix: string, suffix: string) => `${prefix}${nonce}${suffix}`,
  );
}
