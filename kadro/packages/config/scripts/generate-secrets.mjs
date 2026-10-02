#!/usr/bin/env node
/**
 * Prints fresh random values for the secret keys of the web configuration in `.env` syntax: an
 * ES256 (EC P-256) key pair for access tokens, a 256-bit CSRF secret, a 256-bit hash secret, a
 * 256-bit RevenueCat webhook secret and the 32-byte TOTP encryption key.
 *
 *   pnpm --silent --filter @kadro/config secrets:generate
 *
 * Paste the output over the empty keys of the same name in `.env`. Every environment gets its own
 * values; they are never committed.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { stdout } from 'node:process';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

/** Encodes a PEM block as a single double-quoted `.env` value with `\n` escapes. */
function envPem(value) {
  return `"${value.trim().replace(/\n/g, '\\n')}"`;
}

const lines = [
  `JWT_PRIVATE_KEY=${envPem(privateKey.export({ type: 'pkcs8', format: 'pem' }))}`,
  `JWT_PUBLIC_KEY=${envPem(publicKey.export({ type: 'spki', format: 'pem' }))}`,
  `CSRF_SECRET=${randomBytes(32).toString('base64url')}`,
  `HASH_SECRET=${randomBytes(32).toString('base64url')}`,
  `REVENUECAT_WEBHOOK_SECRET=${randomBytes(32).toString('base64url')}`,
  `TOTP_ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}`,
];

stdout.write(`${lines.join('\n')}\n`);
