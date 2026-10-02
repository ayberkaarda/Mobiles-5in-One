import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { parseWebEnv, type WebEnv } from '@kadro/config';
import { ACCESS_TOKEN_AUDIENCE } from '@kadro/contracts';
import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { type AccessTokenService, createAccessTokenService } from './jwt.js';

const USER_ID = '0199a000-0000-7000-8000-00000000000a';
const SESSION_ID = '0199a000-0000-7000-8000-00000000000b';
const NOW = new Date('2026-10-01T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);

function pemPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privateKey,
    publicKey,
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** Builds the web env through @kadro/config with key material generated for this run only. */
function webEnv(pair: ReturnType<typeof pemPair>): WebEnv {
  return parseWebEnv({
    NODE_ENV: 'test',
    APP_ENV: 'local',
    BUILD_SHA: 'test',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgres://kadro:kadro@localhost:5432/kadro',
    WEB_ORIGIN: 'http://localhost:3000',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    JWT_PRIVATE_KEY: pair.privatePem,
    JWT_PUBLIC_KEY: pair.publicPem,
    CSRF_SECRET: randomBytes(32).toString('base64url'),
    HASH_SECRET: randomBytes(32).toString('base64url'),
    APPLE_AUDIENCES: 'app.kadro.mobile',
    GOOGLE_CLIENT_IDS: '100000000000-kadrotest.apps.googleusercontent.com',
  });
}

const pair = pemPair();
let service: AccessTokenService;

beforeAll(async () => {
  service = await createAccessTokenService(webEnv(pair));
});

function decodeSegment(token: string, index: number): Record<string, unknown> {
  const segment = token.split('.')[index] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: USER_ID,
    sid: SESSION_ID,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 900,
    aud: ACCESS_TOKEN_AUDIENCE,
    iss: 'http://localhost:3000',
    ...overrides,
  };
}

async function forge(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
  key: Parameters<SignJWT['sign']>[0] = pair.privateKey,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: service.keyId, ...header })
    .sign(key);
}

async function expectInvalid(token: string, reason: 'invalid' | 'expired' = 'invalid') {
  expect(await service.verify(token, NOW)).toEqual({ ok: false, code: 'unauthenticated', reason });
}

describe('access token issue', () => {
  it('signs ES256 with typ at+jwt and the RFC 7638 key id', async () => {
    const { token } = await service.issue({ userId: USER_ID, sessionId: SESSION_ID }, NOW);
    expect(decodeSegment(token, 0)).toEqual({ alg: 'ES256', typ: 'at+jwt', kid: service.keyId });
    expect(service.keyId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('carries exactly sub, sid, iat, exp, aud and iss with a 15-minute lifetime', async () => {
    const { token, expiresAt } = await service.issue(
      { userId: USER_ID, sessionId: SESSION_ID },
      NOW,
    );
    expect(decodeSegment(token, 1)).toEqual(validClaims());
    expect(expiresAt).toEqual(new Date(NOW.getTime() + 900_000));
    expect(service.ttlSeconds).toBe(900);
    expect(service.issuer).toBe('http://localhost:3000');
  });

  it('round-trips through verify', async () => {
    const { token } = await service.issue({ userId: USER_ID, sessionId: SESSION_ID }, NOW);
    expect(await service.verify(token, NOW)).toEqual({ ok: true, claims: validClaims() });
  });

  it('refuses to issue for a malformed subject', async () => {
    await expect(
      service.issue({ userId: 'not-a-uuid', sessionId: SESSION_ID }, NOW),
    ).rejects.toThrow();
  });
});

describe('access token verify rejects', () => {
  it('an expired token as expired', async () => {
    const { token } = await service.issue({ userId: USER_ID, sessionId: SESSION_ID }, NOW);
    const later = new Date(NOW.getTime() + 906_000);
    expect(await service.verify(token, later)).toEqual({
      ok: false,
      code: 'unauthenticated',
      reason: 'expired',
    });
  });

  describe('expiry with the 5-second clock tolerance', () => {
    const expMs = NOW.getTime() + 900_000;

    it.each([
      ['exactly at exp', 0],
      ['4 s after exp', 4_000],
    ])('accepts %s', async (_label, offset) => {
      const { token } = await service.issue({ userId: USER_ID, sessionId: SESSION_ID }, NOW);
      expect((await service.verify(token, new Date(expMs + offset))).ok).toBe(true);
    });

    it.each([
      ['5 s after exp (tolerance used up)', 5_000],
      ['6 s after exp', 6_000],
    ])('rejects %s as expired', async (_label, offset) => {
      const { token } = await service.issue({ userId: USER_ID, sessionId: SESSION_ID }, NOW);
      expect(await service.verify(token, new Date(expMs + offset))).toEqual({
        ok: false,
        code: 'unauthenticated',
        reason: 'expired',
      });
    });

    it('accepts an iat up to the tolerance in the future and rejects one second more', async () => {
      const skewed = await forge(validClaims({ iat: NOW_SECONDS + 5, exp: NOW_SECONDS + 905 }));
      expect((await service.verify(skewed, NOW)).ok).toBe(true);
      await expectInvalid(
        await forge(validClaims({ iat: NOW_SECONDS + 6, exp: NOW_SECONDS + 906 })),
      );
    });
  });

  it('alg none', async () => {
    const header = base64urlJson({ alg: 'none', typ: 'at+jwt', kid: service.keyId });
    await expectInvalid(`${header}.${base64urlJson(validClaims())}.`);
  });

  it('HS256 signed with the public key as the secret', async () => {
    const token = await new SignJWT(validClaims())
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: service.keyId })
      .sign(new TextEncoder().encode(pair.publicPem));
    await expectInvalid(token);
  });

  it('a token signed with another P-256 key', async () => {
    await expectInvalid(await forge(validClaims(), {}, pemPair().privateKey));
  });

  it('a different algorithm (ES384)', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
    await expectInvalid(await forge(validClaims(), { alg: 'ES384' }, privateKey));
  });

  it('a wrong issuer', async () => {
    await expectInvalid(await forge(validClaims({ iss: 'https://evil.example' })));
  });

  it('a wrong audience', async () => {
    await expectInvalid(await forge(validClaims({ aud: 'another-api' })));
  });

  it('a wrong typ header', async () => {
    await expectInvalid(await forge(validClaims(), { typ: 'JWT' }));
  });

  it('a missing typ header', async () => {
    const token = await forge(validClaims(), { typ: undefined });
    expect(decodeSegment(token, 0)).not.toHaveProperty('typ');
    await expectInvalid(token);
  });

  it('an unknown key id', async () => {
    await expectInvalid(await forge(validClaims(), { kid: 'other-key' }));
  });

  it('extra claims such as a role', async () => {
    await expectInvalid(await forge(validClaims({ role: 'admin' })));
  });

  it('a missing sid', async () => {
    const { sid: _sid, ...claims } = validClaims();
    await expectInvalid(await forge(claims));
  });

  it('a lifetime longer than the configured TTL', async () => {
    await expectInvalid(await forge(validClaims({ exp: NOW_SECONDS + 3_600 })));
  });

  it('an iat in the future', async () => {
    await expectInvalid(
      await forge(validClaims({ iat: NOW_SECONDS + 120, exp: NOW_SECONDS + 600 })),
    );
  });

  it('a tampered payload', async () => {
    const { token } = await service.issue({ userId: USER_ID, sessionId: SESSION_ID }, NOW);
    const [header, , signature] = token.split('.');
    const payload = base64urlJson(validClaims({ sub: '0199a000-0000-7000-8000-00000000000c' }));
    await expectInvalid(`${header ?? ''}.${payload}.${signature ?? ''}`);
  });

  it('garbage input', async () => {
    await expectInvalid('not.a.jwt');
    await expectInvalid('');
  });
});
