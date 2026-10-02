import { createHash, randomBytes } from 'node:crypto';

import { mobileAuthResponseSchema, webAuthResponseSchema } from '@kadro/contracts';
import { auditLogs, users } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as apple } from '../../app/api/v1/auth/apple/route';
import { POST as google } from '../../app/api/v1/auth/google/route';
import { createJwksSource } from '../../lib/server/oauth/jwks';
import { APPLE_ISSUER } from '../../lib/server/oauth/providers';
import { expectProblem } from '../support/http';
import {
  APPLE_AUDIENCE,
  type AuthHarness,
  createUser,
  GOOGLE_CLIENT_ID,
  keyServer,
  mobile,
  parseSetCookies,
  post,
  providerKeys,
  setupAuthHarness,
  signProviderToken,
  uniqueEmail,
  userRow,
  web,
} from './support';

/**
 * Sign in with Apple / Google (matrix §3.1 footnote 3, threat model T-AUTH-06 / T-AUTH-07).
 * Tokens are signed at run time with locally generated RSA keys and verified through the real
 * JWKS code path against a stub key server; nothing touches the network.
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_auth_oauth', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(() => {
  auth.harness.setNow(new Date());
  auth.appleServer.failWith = 'none';
  auth.googleServer.failWith = 'none';
});

function rawNonce(): string {
  return randomBytes(16).toString('base64url');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface AppleOptions {
  readonly nonce?: string;
  readonly subject?: string;
  readonly email?: string | null;
  readonly emailVerified?: boolean | string;
  readonly audience?: string;
  readonly issuer?: string;
  readonly issuedAt?: Date;
  readonly expiresAt?: Date;
}

async function appleToken(options: AppleOptions = {}): Promise<{ token: string; nonce: string }> {
  const nonce = options.nonce ?? rawNonce();
  const claims: Record<string, unknown> = { nonce: sha256Hex(nonce) };
  if (options.email !== null) {
    claims.email = options.email ?? uniqueEmail();
    claims.email_verified = options.emailVerified ?? 'true';
  }
  const token = await signProviderToken({
    keys: auth.appleKeys,
    issuer: options.issuer ?? APPLE_ISSUER,
    audience: options.audience ?? APPLE_AUDIENCE,
    claims,
    ...(options.subject === undefined ? {} : { subject: options.subject }),
    ...(options.issuedAt === undefined ? {} : { issuedAt: options.issuedAt }),
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
  });
  return { token, nonce };
}

function signInApple(token: string, nonce: string, headers = mobile()): Promise<Response> {
  return post(apple, headers, { identityToken: token, nonce, displayName: 'Elma Kullanıcı' });
}

async function googleToken(claims: Record<string, unknown>, subject?: string): Promise<string> {
  return signProviderToken({
    keys: auth.googleKeys,
    issuer: 'https://accounts.google.com',
    audience: GOOGLE_CLIENT_ID,
    claims,
    ...(subject === undefined ? {} : { subject }),
  });
}

describe('Sign in with Apple', () => {
  it('creates a verified account on first sign-in and signs the same subject in later', async () => {
    const email = uniqueEmail();
    const subject = `apple.${randomBytes(4).toString('hex')}`;
    const first = await appleToken({ email, subject });
    const response = await signInApple(first.token, first.nonce);
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = mobileAuthResponseSchema.parse(JSON.parse(text));
    expect(body.user).toMatchObject({
      email,
      emailVerified: true,
      displayName: 'Elma Kullanıcı',
      providers: { password: false, apple: true, google: false },
    });

    const again = await appleToken({ subject, email: null });
    const second = mobileAuthResponseSchema.parse(
      await (await signInApple(again.token, again.nonce)).json(),
    );
    expect(second.user.id).toBe(body.user.id);
  });

  it('issues web cookies for x-kadro-client: web', async () => {
    const { token, nonce } = await appleToken();
    const response = await signInApple(token, nonce, web());
    expect(response.status).toBe(200);
    webAuthResponseSchema.parse(await response.json());
    expect(parseSetCookies(response).get('__Host-kadro_session')?.attributes).toContain('HttpOnly');
  });

  it.each([
    ['wrong audience', { audience: 'com.evil.app' }],
    ['wrong issuer', { issuer: 'https://accounts.google.com' }],
    [
      'expired',
      { issuedAt: new Date(Date.now() - 3_600_000), expiresAt: new Date(Date.now() - 60_000) },
    ],
    ['issued in the future', { issuedAt: new Date(Date.now() + 3_600_000) }],
  ] as const)('rejects a token with %s', async (_name, options) => {
    const { token, nonce } = await appleToken(options);
    await expectProblem(await signInApple(token, nonce), 401, 'token_invalid');
  });

  it('rejects a token bound to another nonce, and the raw nonce in the claim', async () => {
    const { token } = await appleToken();
    await expectProblem(await signInApple(token, rawNonce()), 401, 'token_invalid');

    const nonce = rawNonce();
    const raw = await signProviderToken({
      keys: auth.appleKeys,
      issuer: APPLE_ISSUER,
      audience: APPLE_AUDIENCE,
      claims: { nonce, email: uniqueEmail(), email_verified: true },
    });
    await expectProblem(await signInApple(raw, nonce), 401, 'token_invalid');
  });

  it('rejects a signature from a key Apple did not publish, even with a published kid', async () => {
    const attacker = await providerKeys(auth.appleKeys.kid);
    const nonce = rawNonce();
    const forged = await signProviderToken({
      keys: attacker,
      issuer: APPLE_ISSUER,
      audience: APPLE_AUDIENCE,
      claims: { nonce: sha256Hex(nonce), email: uniqueEmail(), email_verified: true },
    });
    await expectProblem(await signInApple(forged, nonce), 401, 'token_invalid');
  });

  it('rejects a tampered payload and a token signed with HS256', async () => {
    const { token, nonce } = await appleToken();
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const tampered = Buffer.from(JSON.stringify({ ...claims, sub: 'victim' })).toString(
      'base64url',
    );
    await expectProblem(
      await signInApple(`${header}.${tampered}.${signature}`, nonce),
      401,
      'token_invalid',
    );

    const hmac = await new SignJWT({ nonce: sha256Hex(nonce) })
      .setProtectedHeader({ alg: 'HS256', kid: auth.appleKeys.kid })
      .setIssuer(APPLE_ISSUER)
      .setAudience(APPLE_AUDIENCE)
      .setSubject('hs256')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new Uint8Array(32));
    await expectProblem(await signInApple(hmac, nonce), 401, 'token_invalid');
  });

  it('answers 503 when the key set cannot be fetched and nothing is cached', async () => {
    const server = keyServer([]);
    server.failWith = 'network';
    const source = createJwksSource({ url: 'https://apple.test/keys', fetch: server.fetch });
    await expect(
      source.getKey({ alg: 'RS256', kid: 'x' }, { payload: '', signature: '' }),
    ).rejects.toMatchObject({ name: 'JwksUnavailableError' });

    const hanging = keyServer([]);
    hanging.failWith = 'hang';
    const slow = createJwksSource({
      url: 'https://apple.test/keys',
      fetch: hanging.fetch,
      timeoutMs: 50,
    });
    await expect(
      slow.getKey({ alg: 'RS256', kid: 'x' }, { payload: '', signature: '' }),
    ).rejects.toThrow(/timeout/);
  });
});

describe('Sign in with Google', () => {
  it('accepts a valid ID token and enforces the request nonce when given', async () => {
    const nonce = rawNonce();
    const idToken = await googleToken({
      email: uniqueEmail(),
      email_verified: true,
      name: 'Gökhan Test',
      nonce,
    });
    const response = await post(google, mobile(), { idToken, nonce });
    expect(response.status).toBe(200);
    const body = mobileAuthResponseSchema.parse(await response.json());
    expect(body.user.displayName).toBe('Gökhan Test');

    await expectProblem(
      await post(google, mobile(), { idToken, nonce: rawNonce() }),
      401,
      'token_invalid',
    );
    // A nonce-bound token cannot be replayed through a request without the nonce.
    await expectProblem(await post(google, mobile(), { idToken }), 401, 'token_invalid');
  });

  it('rejects a token for another client id or issuer', async () => {
    const wrongAudience = await signProviderToken({
      keys: auth.googleKeys,
      issuer: 'https://accounts.google.com',
      audience: '999999999999-other.apps.googleusercontent.com',
      claims: { email: uniqueEmail(), email_verified: true },
    });
    await expectProblem(
      await post(google, mobile(), { idToken: wrongAudience }),
      401,
      'token_invalid',
    );
    const appleKeyToken = await signProviderToken({
      keys: auth.appleKeys,
      issuer: 'https://accounts.google.com',
      audience: GOOGLE_CLIENT_ID,
      claims: { email: uniqueEmail(), email_verified: true },
    });
    await expectProblem(
      await post(google, mobile(), { idToken: appleKeyToken }),
      401,
      'token_invalid',
    );
  });

  it('caches the key set and refetches once on an unknown kid (key rotation)', async () => {
    const rotated = await providerKeys();
    const before = auth.googleServer.requests;
    await post(google, mobile(), {
      idToken: await googleToken({ email: uniqueEmail(), email_verified: true }),
    });
    await post(google, mobile(), {
      idToken: await googleToken({ email: uniqueEmail(), email_verified: true }),
    });
    expect(auth.googleServer.requests - before).toBeLessThanOrEqual(1);

    auth.googleServer.keys = [auth.googleKeys.jwk, rotated.jwk];
    auth.harness.advance(31_000);
    const token = await signProviderToken({
      keys: rotated,
      issuer: 'accounts.google.com',
      audience: GOOGLE_CLIENT_ID,
      claims: { email: uniqueEmail(), email_verified: true },
    });
    const afterRotation = auth.googleServer.requests;
    expect((await post(google, mobile(), { idToken: token })).status).toBe(200);
    expect(auth.googleServer.requests - afterRotation).toBe(1);

    // Unknown kids inside the cooldown do not hit the key server again.
    const stranger = await providerKeys();
    const strangerToken = await signProviderToken({
      keys: stranger,
      issuer: 'accounts.google.com',
      audience: GOOGLE_CLIENT_ID,
      claims: {},
    });
    const beforeStranger = auth.googleServer.requests;
    await expectProblem(
      await post(google, mobile(), { idToken: strangerToken }),
      401,
      'token_invalid',
    );
    await expectProblem(
      await post(google, mobile(), { idToken: strangerToken }),
      401,
      'token_invalid',
    );
    expect(auth.googleServer.requests).toBe(beforeStranger);
  });
});

describe('account linking (footnote 3, T-AUTH-07)', () => {
  it('refuses to link an unverified provider email to an existing account', async () => {
    const existing = await createUser(auth);
    const { token, nonce } = await appleToken({ email: existing.email, emailVerified: 'false' });
    await expectProblem(await signInApple(token, nonce), 409, 'account_link_required');
    expect((await userRow(auth, existing.id))?.appleSub).toBeNull();

    const idToken = await googleToken({ email: existing.email, email_verified: false });
    await expectProblem(await post(google, mobile(), { idToken }), 409, 'account_link_required');
    expect((await userRow(auth, existing.id))?.googleSub).toBeNull();
  });

  it('refuses to link a verified provider email to an account whose email is unverified', async () => {
    // Pre-account takeover: someone registered the victim's address with their own password.
    const squatted = await createUser(auth, { emailVerifiedAt: null });
    const idToken = await googleToken({ email: squatted.email, email_verified: true });
    await expectProblem(await post(google, mobile(), { idToken }), 409, 'account_link_required');
    expect((await userRow(auth, squatted.id))?.googleSub).toBeNull();
  });

  it('links when both sides are verified, audits it, and keeps an existing subject', async () => {
    const existing = await createUser(auth);
    const subject = `google.${randomBytes(4).toString('hex')}`;
    const idToken = await googleToken({ email: existing.email, email_verified: true }, subject);
    const response = await post(google, mobile(), { idToken });
    expect(response.status).toBe(200);
    const body = mobileAuthResponseSchema.parse(await response.json());
    expect(body.user.id).toBe(existing.id);
    expect((await userRow(auth, existing.id))?.googleSub).toBe(subject);
    const audit = await auth.database.client.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, existing.id), eq(auditLogs.action, 'auth.providerLinked')));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toEqual({ provider: 'google' });

    const otherSubject = await googleToken({ email: existing.email, email_verified: true });
    await expectProblem(
      await post(google, mobile(), { idToken: otherSubject }),
      409,
      'account_link_required',
    );
  });

  it('creates an unverified account for an unverified email nobody owns', async () => {
    const email = uniqueEmail();
    const idToken = await googleToken({ email, email_verified: false });
    const body = mobileAuthResponseSchema.parse(
      await (await post(google, mobile(), { idToken })).json(),
    );
    expect(body.user.emailVerified).toBe(false);
    const [row] = await auth.database.client.db.select().from(users).where(eq(users.email, email));
    expect(row?.passwordHash).toBeNull();
  });

  it('cannot create an account without an email', async () => {
    const { token, nonce } = await appleToken({ email: null });
    await expectProblem(await signInApple(token, nonce), 401, 'token_invalid');
  });

  it('applies the deactivation rule to provider sign-in', async () => {
    const subject = `apple.${randomBytes(4).toString('hex')}`;
    await createUser(auth, { appleSub: subject, deactivatedAt: new Date() });
    const { token, nonce } = await appleToken({ subject });
    await expectProblem(await signInApple(token, nonce), 401, 'account_deactivated');
  });
});

describe('JWKS cache staleness bound', () => {
  it('serves expired keys for at most 24 h while the provider is down, then fails closed', async () => {
    const keys = await providerKeys();
    const server = keyServer([keys.jwk]);
    let now = Date.parse('2026-10-01T00:00:00Z');
    const events: string[] = [];
    const source = createJwksSource({
      url: 'https://google.test/keys',
      fetch: server.fetch,
      now: () => now,
      onStaleKeys: (event) => events.push(event.state),
    });
    const header = { alg: 'RS256', kid: keys.kid };
    const input = { payload: '', signature: '' };
    await expect(source.getKey(header, input)).resolves.toBeDefined();

    server.failWith = 'network';
    now += 60 * 60 * 1_000 + 1_000;
    await expect(source.getKey(header, input)).resolves.toBeDefined();
    expect(events).toEqual(['stale']);

    now += 24 * 60 * 60 * 1_000;
    await expect(source.getKey(header, input)).rejects.toMatchObject({
      name: 'JwksUnavailableError',
    });
    expect(events).toEqual(['stale', 'expired']);

    // Recovery: the next successful fetch serves again.
    server.failWith = 'none';
    now += 31_000;
    await expect(source.getKey(header, input)).resolves.toBeDefined();
  });
});

describe('concurrent first sign-in', () => {
  it('signs both requests into the one account the first of them created', async () => {
    for (let round = 0; round < 3; round += 1) {
      const subject = `apple.${randomBytes(4).toString('hex')}`;
      const email = uniqueEmail();
      const a = await appleToken({ subject, email });
      const b = await appleToken({ subject, email });
      const responses = await Promise.all([
        signInApple(a.token, a.nonce),
        signInApple(b.token, b.nonce),
      ]);
      const texts = await Promise.all(responses.map((response) => response.text()));
      expect(
        responses.map((response) => response.status),
        texts.join(' | '),
      ).toEqual([200, 200]);
      const ids = texts.map((text) => mobileAuthResponseSchema.parse(JSON.parse(text)).user.id);
      expect(ids[0]).toBe(ids[1]);
      const rows = await auth.database.client.db
        .select()
        .from(users)
        .where(eq(users.appleSub, subject));
      expect(rows).toHaveLength(1);
    }
  });
});
