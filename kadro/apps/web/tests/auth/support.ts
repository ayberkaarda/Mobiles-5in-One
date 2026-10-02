import { randomBytes, randomUUID } from 'node:crypto';

import { type BreachCheckResult, hashPassword, issueEmailToken } from '@kadro/auth';
import {
  type EmailKind,
  emailSendJobSchema,
  type MobileAuthResponse,
  mobileAuthResponseSchema,
} from '@kadro/contracts';
import { emailTokens, type NewUser, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { expect } from 'vitest';

import { installAuthServices } from '../../lib/server/auth/services';
import { createJwksSource, type JwksFetch } from '../../lib/server/oauth/jwks';
import { createAppleVerifier, createGoogleVerifier } from '../../lib/server/oauth/providers';
import { type RouteHandler } from '../../lib/server/http';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { bootstrapJobQueues, completeJobs, storedJobs } from '../support/jobs';
import { TEST_EDGE_PROXY } from '../support/env';
import { call, MOBILE, WEB } from '../support/http';
import { installTestRuntime, type TestRuntime } from '../support/runtime';

/**
 * Shared harness for the auth endpoint suites: a migrated disposable database, the test runtime
 * (captured logs, controlled clock), and auth services whose outside world is local: a stubbed
 * breach checker, an in-memory mailbox, a drainable task queue, and Apple / Google key sets
 * generated at run time and served through a stub fetch (real RS256 signatures, no network).
 */

export const APPLE_AUDIENCE = 'app.kadro.mobile';
export const GOOGLE_CLIENT_ID = '100000000000-kadrotest.apps.googleusercontent.com';

export interface ProviderKeys {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
}

export async function providerKeys(kid: string = randomUUID()): Promise<ProviderKeys> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey, jwk };
}

export interface KeyServer {
  /** Keys currently published; tests replace the list to simulate rotation. */
  keys: JWK[];
  failWith: 'none' | 'network' | 'http' | 'hang';
  requests: number;
  readonly fetch: JwksFetch;
}

export function keyServer(keys: JWK[]): KeyServer {
  const server: KeyServer = {
    keys,
    failWith: 'none',
    requests: 0,
    fetch: (_url, init) => {
      server.requests += 1;
      switch (server.failWith) {
        case 'network':
          return Promise.reject(new TypeError('fetch failed'));
        case 'http':
          return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
        case 'hang':
          return new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason));
          });
        case 'none':
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ keys: server.keys }),
          });
      }
    },
  };
  return server;
}

/** An email the worker would have sent: recipient, kind and, for token kinds, the plain token. */
export interface EmailMessage {
  readonly to: string;
  readonly kind: EmailKind;
  readonly token: string | null;
}

export interface Mailbox {
  readonly sent: EmailMessage[];
  /** Plain token of the most recent email of `kind` sent to `to`. */
  tokenFor(to: string, kind: EmailKind): string;
}

export function mailbox(): Mailbox {
  const sent: EmailMessage[] = [];
  return {
    sent,
    tokenFor(to, kind) {
      const message = [...sent].reverse().find((entry) => entry.to === to && entry.kind === kind);
      if (message?.token === undefined || message.token === null) {
        throw new Error(`no ${kind} email with a token`);
      }
      return message.token;
    },
  };
}

export interface AuthHarness {
  readonly database: TestDatabase;
  readonly harness: TestRuntime;
  readonly mail: Mailbox;
  readonly appleKeys: ProviderKeys;
  readonly googleKeys: ProviderKeys;
  readonly appleServer: KeyServer;
  readonly googleServer: KeyServer;
  breach: BreachCheckResult;
  /**
   * Processes the `email.send` jobs enqueued so far the way the worker's handler does (ADR-0029):
   * re-check the account, issue the token (hash stored, plain value only in the "email"), record
   * the message; then mark the job completed. The web process itself sends nothing.
   */
  drain(): Promise<void>;
}

const TOKEN_PURPOSE: Partial<Record<EmailKind, 'verify' | 'reset'>> = {
  verify_email: 'verify',
  password_reset: 'reset',
};

async function deliverEmailJobs(
  auth: Pick<AuthHarness, 'database' | 'harness' | 'mail'>,
): Promise<void> {
  const db = auth.database.client.db;
  const pending = (await storedJobs(auth.database.url, 'email.send')).filter(
    (job) => job.state === 'created',
  );
  for (const job of pending) {
    const payload = emailSendJobSchema.parse(job.data);
    const [user] =
      payload.userId === null
        ? []
        : await db.select().from(users).where(eq(users.id, payload.userId));
    const due =
      user !== undefined &&
      user.deactivatedAt === null &&
      (payload.kind !== 'verify_email' || user.emailVerifiedAt === null) &&
      (payload.kind !== 'password_reset' || user.passwordHash !== null);
    if (due) {
      const purpose = TOKEN_PURPOSE[payload.kind];
      let token: string | null = null;
      if (purpose !== undefined) {
        const issued = issueEmailToken(purpose, auth.harness.runtime.now());
        await db.insert(emailTokens).values({ userId: user.id, ...issued.row });
        token = issued.token;
      }
      auth.mail.sent.push({ to: user.email, kind: payload.kind, token });
    }
  }
  await completeJobs(
    auth.database.url,
    pending.map((job) => job.id),
  );
}

export async function setupAuthHarness(
  prefix: string,
  env: Readonly<Record<string, string>> = {},
): Promise<AuthHarness> {
  const migrated = await createMigratedDatabase(prefix);
  await bootstrapJobQueues(migrated.url);
  // The send-only job client connects to the test database as kadro_app.
  const harness = await installTestRuntime({
    db: migrated.client.db,
    env: { DATABASE_URL: migrated.url, ...env },
  });
  const database: TestDatabase = {
    ...migrated,
    dispose: async () => {
      await harness.runtime.jobClient.close();
      await migrated.dispose();
    },
  };
  const mail = mailbox();
  const appleKeys = await providerKeys();
  const googleKeys = await providerKeys();
  const appleServer = keyServer([appleKeys.jwk]);
  const googleServer = keyServer([googleKeys.jwk]);
  const clock = () => harness.runtime.now().getTime();

  const context: AuthHarness = {
    database,
    harness,
    mail,
    appleKeys,
    googleKeys,
    appleServer,
    googleServer,
    breach: { status: 'clean' },
    drain: () => deliverEmailJobs(context),
  };
  installAuthServices(harness.runtime, {
    breachChecker: () => Promise.resolve(context.breach),
    apple: createAppleVerifier({
      audiences: harness.env.APPLE_AUDIENCES,
      getKey: createJwksSource({
        url: 'https://apple.test/keys',
        fetch: appleServer.fetch,
        now: clock,
      }).getKey,
    }),
    google: createGoogleVerifier({
      clientIds: harness.env.GOOGLE_CLIENT_IDS,
      getKey: createJwksSource({
        url: 'https://google.test/keys',
        fetch: googleServer.fetch,
        now: clock,
      }).getKey,
    }),
  });
  return context;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

let ipCounter = 0;

/** A fresh client address per call site, so tests do not share rate-limit buckets. */
export function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

let emailCounter = 0;

export function uniqueEmail(): string {
  emailCounter += 1;
  return `oyuncu${emailCounter}-${randomBytes(3).toString('hex')}@example.test`;
}

/** Password generated at run time (16 base64url characters). */
export function newPassword(): string {
  return randomBytes(12).toString('base64url');
}

export function mobile(
  ip = uniqueIp(),
  extra: Record<string, string> = {},
): Record<string, string> {
  return { ...MOBILE, 'x-forwarded-for': `${ip}, ${TEST_EDGE_PROXY}`, ...extra };
}

export function web(ip = uniqueIp(), extra: Record<string, string> = {}): Record<string, string> {
  return { ...WEB, 'x-forwarded-for': `${ip}, ${TEST_EDGE_PROXY}`, ...extra };
}

export function post(
  handler: RouteHandler,
  headers: Record<string, string>,
  json: unknown,
  path = '/api/v1/test',
): Promise<Response> {
  return call(handler, { method: 'POST', headers, json, path });
}

/** Inserts a user directly (bypassing register) with an Argon2id password hash. */
export async function createUser(
  auth: AuthHarness,
  values: Partial<NewUser> & { password?: string } = {},
): Promise<{ id: string; email: string; password: string }> {
  const email = values.email ?? uniqueEmail();
  const password = values.password ?? newPassword();
  const { password: _ignored, ...columns } = values;
  const [row] = await auth.database.client.db
    .insert(users)
    .values({
      email,
      displayName: 'Test Oyuncu',
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      ...columns,
    })
    .returning({ id: users.id });
  if (row === undefined) {
    throw new Error('user insert failed');
  }
  return { id: row.id, email, password };
}

export async function userRow(auth: AuthHarness, id: string) {
  const [row] = await auth.database.client.db.select().from(users).where(eq(users.id, id));
  return row;
}

/** Mobile password login; asserts 200 and returns the parsed body. */
export async function mobileLogin(
  login: RouteHandler,
  email: string,
  password: string,
): Promise<MobileAuthResponse> {
  const response = await post(login, mobile(), { email, password });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return mobileAuthResponseSchema.parse(JSON.parse(text));
}

/** Parses `Set-Cookie` lines into name → { value, attributes }. */
export function parseSetCookies(
  response: Response,
): Map<string, { value: string; attributes: string[] }> {
  const cookies = new Map<string, { value: string; attributes: string[] }>();
  for (const line of response.headers.getSetCookie()) {
    const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
    const separator = pair.indexOf('=');
    cookies.set(pair.slice(0, separator), {
      value: pair.slice(separator + 1),
      attributes,
    });
  }
  return cookies;
}

// ---------------------------------------------------------------------------
// Provider tokens
// ---------------------------------------------------------------------------

export interface TokenOptions {
  readonly keys: ProviderKeys;
  readonly issuer: string;
  readonly audience: string;
  readonly subject?: string;
  readonly claims?: Record<string, unknown>;
  readonly issuedAt?: Date;
  readonly expiresAt?: Date;
  readonly kid?: string;
}

export async function signProviderToken(options: TokenOptions): Promise<string> {
  const issuedAt = options.issuedAt ?? new Date();
  const expiresAt = options.expiresAt ?? new Date(issuedAt.getTime() + 10 * 60 * 1_000);
  return new SignJWT({ ...options.claims })
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? options.keys.kid })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject(options.subject ?? `${randomBytes(6).toString('hex')}.sub`)
    .setIssuedAt(Math.floor(issuedAt.getTime() / 1_000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
    .sign(options.keys.privateKey);
}
