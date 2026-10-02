import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as apple } from '../../app/api/v1/auth/apple/route';
import { POST as forgot } from '../../app/api/v1/auth/forgot/route';
import { POST as google } from '../../app/api/v1/auth/google/route';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as register } from '../../app/api/v1/auth/register/route';
import { POST as reset } from '../../app/api/v1/auth/reset/route';
import { POST as verifyEmail } from '../../app/api/v1/auth/verify-email/route';
import { type RouteHandler } from '../../lib/server/http';
import { expectProblem } from '../support/http';
import {
  type AuthHarness,
  createUser,
  mobile,
  newPassword,
  post,
  setupAuthHarness,
  uniqueEmail,
  uniqueIp,
} from './support';

/**
 * Group A on the real auth endpoints with the spec defaults (security checklist item 5):
 * 5 requests per 15 minutes per IP and per email; the 6th is 429 with `Retry-After`.
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_auth_limits');
});

afterAll(async () => {
  await auth.database.dispose();
});

const jws = `${'A'.repeat(20)}.${'B'.repeat(20)}.${'C'.repeat(20)}`;

const ENDPOINTS: readonly [string, RouteHandler, () => unknown][] = [
  ['login', login, () => ({ email: uniqueEmail(), password: newPassword() })],
  [
    'register',
    register,
    () => ({ email: uniqueEmail(), password: newPassword(), displayName: 'Ali' }),
  ],
  ['forgot', forgot, () => ({ email: uniqueEmail() })],
  ['reset', reset, () => ({ token: 'A'.repeat(43), password: newPassword() })],
  ['verify-email', verifyEmail, () => ({ token: 'A'.repeat(43) })],
  ['apple', apple, () => ({ identityToken: jws, nonce: 'n'.repeat(16) })],
  ['google', google, () => ({ idToken: jws })],
];

describe('group A per IP', () => {
  it.each(ENDPOINTS)('%s: the 6th request from one IP is 429', async (_name, handler, body) => {
    const ip = uniqueIp();
    for (let index = 0; index < 5; index += 1) {
      expect((await post(handler, mobile(ip), body())).status).not.toBe(429);
    }
    const sixth = await post(handler, mobile(ip), body());
    await expectProblem(sixth.clone(), 429, 'rate_limited');
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('group A per email', () => {
  it('limits login attempts on one account across IPs, even with the right password', async () => {
    const user = await createUser(auth);
    for (let index = 0; index < 5; index += 1) {
      await expectProblem(
        await post(login, mobile(uniqueIp()), { email: user.email, password: newPassword() }),
        401,
        'invalid_credentials',
      );
    }
    await expectProblem(
      await post(login, mobile(uniqueIp()), { email: user.email, password: user.password }),
      429,
      'rate_limited',
    );
  });

  it('applies the progressive delay after three failures', async () => {
    const email = uniqueEmail();
    auth.harness.sleeps.length = 0;
    for (let index = 0; index < 5; index += 1) {
      await post(login, mobile(uniqueIp()), { email, password: newPassword() });
    }
    expect(auth.harness.sleeps).toEqual([500, 1_000]);
  });

  it('limits forgot per email across IPs', async () => {
    const email = uniqueEmail();
    for (let index = 0; index < 5; index += 1) {
      expect((await post(forgot, mobile(uniqueIp()), { email })).status).toBe(202);
    }
    await expectProblem(await post(forgot, mobile(uniqueIp()), { email }), 429, 'rate_limited');
  });
});
