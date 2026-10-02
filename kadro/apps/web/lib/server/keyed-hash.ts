import { createHmac, hkdfSync } from 'node:crypto';

/**
 * Keyed one-way hashes for values that must be compared or grouped but never stored in clear:
 * client IPs and email addresses in `rate_limit_buckets.key`, IPs in `audit_logs.ip_hash`, and
 * the integrity tag of pagination cursors (`lib/server/domain/pagination.ts`).
 * An unkeyed SHA-256 of an email or IPv4 address is reversible by enumeration, so each purpose
 * uses its own HMAC-SHA256 key derived with HKDF from a server secret.
 */
export type KeyedHashPurpose = 'rate-limit' | 'audit-ip' | 'page-cursor';

export type KeyedHasher = (purpose: KeyedHashPurpose, value: string) => string;

/** `secret` is `HASH_SECRET`: base64url, at least 256 bits, distinct from `CSRF_SECRET` (`@kadro/config`). */
export function createKeyedHasher(secret: string): KeyedHasher {
  const ikm = Buffer.from(secret, 'base64url');
  const keys = new Map<KeyedHashPurpose, Buffer>();
  const keyFor = (purpose: KeyedHashPurpose): Buffer => {
    let key = keys.get(purpose);
    if (key === undefined) {
      key = Buffer.from(hkdfSync('sha256', ikm, 'kadro.keyed-hash.v1', purpose, 32));
      keys.set(purpose, key);
    }
    return key;
  };
  return (purpose, value) =>
    createHmac('sha256', keyFor(purpose)).update(value, 'utf8').digest('hex');
}
