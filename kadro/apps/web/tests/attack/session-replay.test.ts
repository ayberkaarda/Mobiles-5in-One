import { mobileRefreshResponseSchema } from '@kadro/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as forgot } from '../../app/api/v1/auth/forgot/route';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as logout } from '../../app/api/v1/auth/logout/route';
import { POST as refresh } from '../../app/api/v1/auth/refresh/route';
import { POST as reset } from '../../app/api/v1/auth/reset/route';
import { GET as getMe } from '../../app/api/v1/me/route';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  newPassword,
  post,
  setupAuthHarness,
} from '../auth/support';
import { call, expectProblem } from '../support/http';

/**
 * Session attacks against the real auth routes (threat model T-AUTH-05/08/13, checklist item 12):
 * a stolen refresh token that is replayed after rotation must burn the whole family, a stolen
 * access token must stop working the instant the victim logs out or resets the password, and a
 * password reset must revoke every outstanding session. There is no grace window (ADR-0019/0025).
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_attack_sessions', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(() => {
  auth.harness.setNow(new Date());
  auth.mail.sent.length = 0;
});

function bearer(accessToken: string): Record<string, string> {
  return mobile(undefined, { authorization: `Bearer ${accessToken}` });
}

function me(accessToken: string): Promise<Response> {
  return call(getMe, { headers: bearer(accessToken), path: '/api/v1/me' });
}

describe('refresh-token replay (T-AUTH-05)', () => {
  it('burns the whole family when a rotated token is replayed', async () => {
    const user = await createUser(auth);
    const phone = await mobileLogin(login, user.email, user.password);

    const rotated = await post(refresh, mobile(), { refreshToken: phone.tokens.refreshToken });
    expect(rotated.status).toBe(200);
    const next = mobileRefreshResponseSchema.parse(await rotated.json());

    // The attacker replays the stolen, already-rotated token.
    await expectProblem(
      await post(refresh, mobile(), { refreshToken: phone.tokens.refreshToken }),
      401,
      'unauthenticated',
    );
    // Reuse detection revokes the family, so the legitimate client's fresh token is dead too.
    await expectProblem(
      await post(refresh, mobile(), { refreshToken: next.tokens.refreshToken }),
      401,
      'unauthenticated',
    );
    // And the access JWT minted for that family no longer authenticates.
    await expectProblem(await me(next.tokens.accessToken), 401, 'unauthenticated');
  });
});

describe('stolen access token after session end (T-AUTH-13)', () => {
  it('is rejected the moment the victim logs out, on that device only', async () => {
    const user = await createUser(auth);
    const phone = await mobileLogin(login, user.email, user.password);
    const tablet = await mobileLogin(login, user.email, user.password);
    expect((await me(phone.tokens.accessToken)).status).toBe(200);

    expect(
      (await post(logout, bearer(phone.tokens.accessToken), {
        refreshToken: phone.tokens.refreshToken,
      })).status,
    ).toBe(204);

    await expectProblem(await me(phone.tokens.accessToken), 401, 'unauthenticated');
    expect((await me(tablet.tokens.accessToken)).status).toBe(200);
  });

  it('is rejected on every device after a password reset', async () => {
    const user = await createUser(auth);
    const phone = await mobileLogin(login, user.email, user.password);
    const tablet = await mobileLogin(login, user.email, user.password);

    expect((await post(forgot, mobile(), { email: user.email })).status).toBe(202);
    await auth.drain();
    const token = auth.mail.tokenFor(user.email, 'password_reset');
    expect((await post(reset, mobile(), { token, password: newPassword() })).status).toBe(204);

    await expectProblem(await me(phone.tokens.accessToken), 401, 'unauthenticated');
    await expectProblem(await me(tablet.tokens.accessToken), 401, 'unauthenticated');
  });

  it('refuses to reuse a single-use reset token', async () => {
    const user = await createUser(auth);
    await mobileLogin(login, user.email, user.password);
    expect((await post(forgot, mobile(), { email: user.email })).status).toBe(202);
    await auth.drain();
    const token = auth.mail.tokenFor(user.email, 'password_reset');
    expect((await post(reset, mobile(), { token, password: newPassword() })).status).toBe(204);
    // Replaying the same emailed token must fail: single use (T-AUTH-08).
    const replay = await post(reset, mobile(), { token, password: newPassword() });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(replay.status).toBeLessThan(500);
  });
});
