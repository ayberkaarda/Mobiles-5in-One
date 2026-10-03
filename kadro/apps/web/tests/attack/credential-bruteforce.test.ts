import { rateLimitBuckets } from '@kadro/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as forgot } from '../../app/api/v1/auth/forgot/route';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as register } from '../../app/api/v1/auth/register/route';
import {
  type AuthHarness,
  createUser,
  mobile,
  newPassword,
  post,
  setupAuthHarness,
  uniqueEmail,
  uniqueIp,
} from '../auth/support';
import { expectProblem, MOBILE } from '../support/http';
import { TEST_EDGE_PROXY } from '../support/env';

/**
 * Credential attacks against the real auth routes (threat model T-AUTH-01/02/03, checklist item 5):
 * online brute force must hit the group A limit (5 / 15 min per IP and per email) with no bypass
 * through forged forwarding headers, a targeted email must lock out across many source addresses,
 * and register / login / forgot must not let an attacker tell a registered address from an unknown
 * one. Runs the shipped handlers end-to-end against a real database.
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_attack_credentials');
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(async () => {
  auth.harness.setNow(new Date());
  auth.harness.sleeps.length = 0;
  auth.mail.sent.length = 0;
  await auth.database.client.db.delete(rateLimitBuckets);
});

function tryLogin(headers: Record<string, string>, email: string, password: string) {
  return post(login, headers, { email, password });
}

describe('online brute force on login', () => {
  it('locks a single IP + email pair after five wrong guesses', async () => {
    const user = await createUser(auth);
    const ip = uniqueIp();
    for (let index = 0; index < 5; index += 1) {
      await expectProblem(
        await tryLogin(mobile(ip), user.email, 'wrong-password'),
        401,
        'invalid_credentials',
      );
    }
    await expectProblem(await tryLogin(mobile(ip), user.email, 'wrong-password'), 429, 'rate_limited');
    // Even the correct password is now refused while the window stands: no unlimited guessing.
    await expectProblem(await tryLogin(mobile(ip), user.email, user.password), 429, 'rate_limited');
  });

  it('locks a targeted email even when guesses come from many addresses', async () => {
    const user = await createUser(auth);
    for (let index = 0; index < 5; index += 1) {
      await expectProblem(
        await tryLogin(mobile(uniqueIp()), user.email, 'wrong-password'),
        401,
        'invalid_credentials',
      );
    }
    await expectProblem(
      await tryLogin(mobile(uniqueIp()), user.email, 'wrong-password'),
      429,
      'rate_limited',
    );
  });

  it('cannot be bypassed by prepending spoofed forwarding addresses (T-AUTH-02)', async () => {
    const realIp = uniqueIp();
    for (let index = 0; index < 5; index += 1) {
      const headers = {
        ...MOBILE,
        'x-forwarded-for': `${uniqueIp()}, ${realIp}, ${TEST_EDGE_PROXY}`,
      };
      expect((await tryLogin(headers, uniqueEmail(), 'wrong-password')).status).toBe(401);
    }
    const spoofed = { ...MOBILE, 'x-forwarded-for': `1.2.3.4, ${realIp}, ${TEST_EDGE_PROXY}` };
    await expectProblem(await tryLogin(spoofed, uniqueEmail(), 'wrong-password'), 429, 'rate_limited');
  });
});

describe('account enumeration resistance (T-AUTH-03)', () => {
  it('answers a wrong password and an unknown email with the identical problem', async () => {
    const user = await createUser(auth);
    const known = await tryLogin(mobile(), user.email, 'wrong-password');
    const unknown = await tryLogin(mobile(), uniqueEmail(), 'wrong-password');
    const [a, b] = [await known.json(), await unknown.json()];
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((a as { code: string }).code).toBe('invalid_credentials');
    // Bodies differ only by requestId; the code and status must match exactly.
    expect((b as { code: string }).code).toBe((a as { code: string }).code);
  });

  it('register returns the same accepted answer for a new and an existing email', async () => {
    const user = await createUser(auth);
    const existing = await post(register, mobile(), {
      email: user.email,
      password: newPassword(),
      displayName: 'Yeni Oyuncu',
    });
    const fresh = await post(register, mobile(), {
      email: uniqueEmail(),
      password: newPassword(),
      displayName: 'Yeni Oyuncu',
    });
    expect(existing.status).toBe(202);
    expect(fresh.status).toBe(202);
    expect(await existing.clone().text()).toBe(await fresh.clone().text());
  });

  it('forgot returns 202 whether or not the address is registered', async () => {
    const user = await createUser(auth);
    expect((await post(forgot, mobile(), { email: user.email })).status).toBe(202);
    expect((await post(forgot, mobile(), { email: uniqueEmail() })).status).toBe(202);
  });
});
