import type * as AuthModule from '@kadro/auth';
import { refreshTokens } from '@kadro/db';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as forgot } from '../../app/api/v1/auth/forgot/route';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as reset } from '../../app/api/v1/auth/reset/route';
import { expectProblem } from '../support/http';
import {
  type AuthHarness,
  createUser,
  mobile,
  newPassword,
  post,
  setupAuthHarness,
  uniqueEmail,
} from './support';

/**
 * Login against concurrent account changes, and the constant-work rule of login (T-AUTH-03).
 * `verifyPassword` is wrapped (same implementation) so a test can observe its calls and hold a
 * login between password verification and session creation.
 */

const control = vi.hoisted(() => ({
  hold: null as Promise<void> | null,
  onVerified: null as (() => void) | null,
}));

vi.mock('@kadro/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    verifyPassword: vi.fn(async (stored: string | null, password: string) => {
      const result = await actual.verifyPassword(stored, password);
      control.onVerified?.();
      if (control.hold !== null) {
        await control.hold;
      }
      return result;
    }),
  };
});

const { verifyPassword } = await import('@kadro/auth');
const verifySpy = vi.mocked(verifyPassword);

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_auth_login_races', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(() => {
  control.hold = null;
  control.onVerified = null;
  verifySpy.mockClear();
  auth.mail.sent.length = 0;
});

describe('login racing a password reset', () => {
  it('does not open a session with a password replaced while it was being verified', async () => {
    const user = await createUser(auth);
    let release: () => void = () => undefined;
    control.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verified = new Promise<void>((resolve) => {
      control.onVerified = resolve;
    });

    const pending = post(login, mobile(), { email: user.email, password: user.password });
    await verified;
    control.hold = null;
    control.onVerified = null;

    // The reset completes while the login sits between verification and session creation.
    expect((await post(forgot, mobile(), { email: user.email })).status).toBe(202);
    await auth.drain();
    const token = auth.mail.tokenFor(user.email, 'password_reset');
    expect((await post(reset, mobile(), { token, password: newPassword() })).status).toBe(204);

    release();
    await expectProblem(await pending, 401, 'invalid_credentials');
    const live = await auth.database.client.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    expect(live).toHaveLength(0);
  });
});

describe('login does the same work for every failure', () => {
  it('runs one full verification per attempt, against the dummy hash when there is no password', async () => {
    const user = await createUser(auth);
    const social = await createUser(auth, { passwordHash: null, googleSub: 'google-login-spy' });

    for (const email of [uniqueEmail(), social.email]) {
      verifySpy.mockClear();
      const password = newPassword();
      await expectProblem(
        await post(login, mobile(), { email, password }),
        401,
        'invalid_credentials',
      );
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifySpy).toHaveBeenCalledWith(null, password);
    }

    verifySpy.mockClear();
    const wrong = newPassword();
    await expectProblem(
      await post(login, mobile(), { email: user.email, password: wrong }),
      401,
      'invalid_credentials',
    );
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy.mock.calls[0]?.[0]).toMatch(/^\$argon2id\$/);
  });
});
