import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { parseWebEnv, type WebEnv } from '@kadro/config';

export const TEST_WEB_ORIGIN = 'https://kadro.app';
export const TEST_SECOND_ORIGIN = 'https://www.kadro.app';
export const TEST_EDGE_PROXY = '10.0.0.5';

let keyPair: { privateKey: string; publicKey: string } | undefined;

/** One EC P-256 pair per test process, generated at run time (no key material in the repo). */
function signingKeys(): { privateKey: string; publicKey: string } {
  keyPair ??= generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return keyPair;
}

/** Raw key/value source of a complete web configuration (as a process environment would hold it). */
export function testEnvSource(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const keys = signingKeys();
  return {
    NODE_ENV: 'test',
    APP_ENV: 'local',
    BUILD_SHA: 'test-build',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgres://kadro:kadro@127.0.0.1:5432/kadro',
    WEB_ORIGIN: TEST_WEB_ORIGIN,
    CORS_ALLOWED_ORIGINS: `${TEST_WEB_ORIGIN},${TEST_SECOND_ORIGIN}`,
    JWT_PRIVATE_KEY: keys.privateKey,
    JWT_PUBLIC_KEY: keys.publicKey,
    CSRF_SECRET: randomBytes(32).toString('base64url'),
    // Low-entropy fixed value; only has to differ from CSRF_SECRET.
    HASH_SECRET: 'B'.repeat(43),
    APPLE_AUDIENCES: 'app.kadro.mobile',
    GOOGLE_CLIENT_IDS: '100000000000-kadrotest.apps.googleusercontent.com',
    CLIENT_IP_HEADER: 'x-forwarded-for',
    TRUSTED_PROXY_CIDRS: `${TEST_EDGE_PROXY}/32`,
    ...overrides,
  };
}

/** A complete, valid web configuration validated by `@kadro/config`. */
export function testEnv(overrides: Readonly<Record<string, string>> = {}): WebEnv {
  return parseWebEnv(testEnvSource(overrides));
}
