import { issueEmailToken } from '@kadro/auth';
import { webAuthResponseSchema } from '@kadro/contracts';
import { auditLogs, emailTokens, refreshTokens } from '@kadro/db';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as forgot } from '../../app/api/v1/auth/forgot/route';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as logout } from '../../app/api/v1/auth/logout/route';
import { POST as refresh } from '../../app/api/v1/auth/refresh/route';
import { POST as reset } from '../../app/api/v1/auth/reset/route';
import { POST as verifyEmail } from '../../app/api/v1/auth/verify-email/route';
import { GET as getMe } from '../../app/api/v1/me/route';
import { call, expectProblem } from '../support/http';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  newPassword,
  parseSetCookies,
  post,
  setupAuthHarness,
  uniqueIp,
  userRow,
  web,
} from './support';

/**
 * Email verification and password reset tokens (matrix §3.1 footnote 2, threat model
 * T-AUTH-08): single use, expiry, purpose binding, and a reset that revokes every session.
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_auth_tokens', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(() => {
  auth.breach = { status: 'clean' };
  auth.mail.sent.length = 0;
  auth.harness.setNow(new Date());
});

async function storeToken(userId: string, purpose: 'verify' | 'reset'): Promise<string> {
  const issued = issueEmailToken(purpose, auth.harness.runtime.now());
  await auth.database.client.db.insert(emailTokens).values({ userId, ...issued.row });
  return issued.token;
}

async function requestReset(email: string): Promise<string> {
  expect((await post(forgot, mobile(), { email })).status).toBe(202);
  await auth.drain();
  return auth.mail.tokenFor(email, 'password_reset');
}

describe('verify-email', () => {
  it('rejects an expired token and a token of the other purpose', async () => {
    const user = await createUser(auth, { emailVerifiedAt: null });
    const expired = await storeToken(user.id, 'verify');
    auth.harness.advance(24 * 3_600_000 + 1_000);
    await expectProblem(
      await post(verifyEmail, mobile(), { token: expired }),
      401,
      'token_invalid',
    );

    const resetToken = await storeToken(user.id, 'reset');
    await expectProblem(
      await post(verifyEmail, mobile(), { token: resetToken }),
      401,
      'token_invalid',
    );
    expect((await userRow(auth, user.id))?.emailVerifiedAt).toBeNull();
  });

  it('spends a token once even under concurrent redemption', async () => {
    const user = await createUser(auth, { emailVerifiedAt: null });
    const token = await storeToken(user.id, 'verify');
    const statuses = (
      await Promise.all([
        post(verifyEmail, mobile(), { token }),
        post(verifyEmail, mobile(), { token }),
      ])
    )
      .map((response) => response.status)
      .sort();
    expect(statuses).toEqual([204, 401]);
    const audit = await auth.database.client.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, 'auth.emailVerified')));
    expect(audit).toHaveLength(1);
    expect((await userRow(auth, user.id))?.emailVerifiedAt).not.toBeNull();
  });
});

describe('reset', () => {
  it('sets the password, revokes every mobile and web session and spends the link', async () => {
    const user = await createUser(auth);
    const mobileSession = await mobileLogin(login, user.email, user.password);
    const webLogin = await post(login, web(), { email: user.email, password: user.password });
    const webBody = webAuthResponseSchema.parse(await webLogin.json());
    const webSession = parseSetCookies(webLogin).get('__Host-kadro_session')?.value ?? '';
    const webCookie = `__Host-kadro_session=${webSession}; __Host-kadro_csrf=${webBody.csrfToken}`;

    const bearer = mobile(uniqueIp(), {
      authorization: `Bearer ${mobileSession.tokens.accessToken}`,
    });
    expect((await call(getMe, { headers: bearer })).status).toBe(200);

    const token = await requestReset(user.email);
    const password = newPassword();
    expect((await post(reset, mobile(), { token, password })).status).toBe(204);

    // ADR-0025: the still-unexpired access token of a revoked family is refused at once.
    await expectProblem(await call(getMe, { headers: bearer }), 401, 'unauthenticated');

    const live = await auth.database.client.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    expect(live).toHaveLength(0);
    await expectProblem(
      await post(refresh, mobile(), { refreshToken: mobileSession.tokens.refreshToken }),
      401,
      'unauthenticated',
    );
    await expectProblem(
      await call(getMe, { headers: web(uniqueIp(), { cookie: webCookie }) }),
      401,
      'unauthenticated',
    );

    await expectProblem(
      await post(login, mobile(), { email: user.email, password: user.password }),
      401,
      'invalid_credentials',
    );
    const fresh = await mobileLogin(login, user.email, password);
    expect(fresh.user.id).toBe(user.id);

    await expectProblem(
      await post(reset, mobile(), { token, password: newPassword() }),
      401,
      'token_invalid',
    );
    const audit = await auth.database.client.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, 'auth.passwordReset')));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toEqual({ revokedSessions: 2 });
  });

  it('invalidates older reset links when one is used', async () => {
    const user = await createUser(auth);
    const older = await requestReset(user.email);
    const newer = await requestReset(user.email);
    expect((await post(reset, mobile(), { token: newer, password: newPassword() })).status).toBe(
      204,
    );
    await expectProblem(
      await post(reset, mobile(), { token: older, password: newPassword() }),
      401,
      'token_invalid',
    );
  });

  it('keeps the link usable when the new password is refused', async () => {
    const user = await createUser(auth);
    const token = await requestReset(user.email);
    auth.breach = { status: 'breached', occurrences: 3 };
    await expectProblem(
      await post(reset, mobile(), { token, password: newPassword() }),
      422,
      'password_breached',
    );
    auth.breach = { status: 'clean' };
    expect((await post(reset, mobile(), { token, password: newPassword() })).status).toBe(204);
  });

  it('rejects an expired reset link (1 h)', async () => {
    const user = await createUser(auth);
    const token = await requestReset(user.email);
    auth.harness.advance(3_600_000 + 1_000);
    await expectProblem(
      await post(reset, mobile(), { token, password: newPassword() }),
      401,
      'token_invalid',
    );
  });

  it('marks the email verified, since the link proves control of the mailbox', async () => {
    const user = await createUser(auth, { emailVerifiedAt: null });
    const token = await requestReset(user.email);
    expect((await post(reset, mobile(), { token, password: newPassword() })).status).toBe(204);
    expect((await userRow(auth, user.id))?.emailVerifiedAt).not.toBeNull();
  });
});

describe('access tokens after logout (ADR-0025)', () => {
  it('refuses the access token of a logged-out session on the next request', async () => {
    const user = await createUser(auth);
    const session = await mobileLogin(login, user.email, user.password);
    const bearer = mobile(uniqueIp(), { authorization: `Bearer ${session.tokens.accessToken}` });
    expect((await call(getMe, { headers: bearer })).status).toBe(200);
    expect((await post(logout, bearer, { refreshToken: session.tokens.refreshToken })).status).toBe(
      204,
    );
    await expectProblem(await call(getMe, { headers: bearer }), 401, 'unauthenticated');
  });
});

describe('concurrent resets', () => {
  it('two different reset links used at once: one wins, the other is spent, no deadlock', async () => {
    for (let round = 0; round < 5; round += 1) {
      const user = await createUser(auth);
      const first = await requestReset(user.email);
      const second = await requestReset(user.email);
      const responses = await Promise.all([
        post(reset, mobile(), { token: first, password: newPassword() }),
        post(reset, mobile(), { token: second, password: newPassword() }),
      ]);
      const bodies = await Promise.all(responses.map((response) => response.text()));
      expect(responses.map((response) => response.status).sort(), bodies.join(' | ')).toEqual([
        204, 401,
      ]);
    }
  });
});
