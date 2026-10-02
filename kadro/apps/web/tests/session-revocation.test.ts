import { randomUUID } from 'node:crypto';

import { mobileRefreshResponseSchema, webAuthResponseSchema } from '@kadro/contracts';
import { refreshTokens } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as forgot } from '../app/api/v1/auth/forgot/route';
import { POST as login } from '../app/api/v1/auth/login/route';
import { POST as logout } from '../app/api/v1/auth/logout/route';
import { POST as refresh } from '../app/api/v1/auth/refresh/route';
import { POST as reset } from '../app/api/v1/auth/reset/route';
import { GET as getMe } from '../app/api/v1/me/route';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  newPassword,
  parseSetCookies,
  post,
  setupAuthHarness,
  web,
} from './auth/support';
import { call, expectProblem } from './support/http';

/**
 * A mobile access JWT lives 15 minutes, but it must stop working as soon as its refresh family
 * (`sid`) is revoked: logout, password reset, reuse detection. `authenticate()` checks the family
 * in the same query that loads the user row (ADR-0012). Web sessions follow the same rule.
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_session_revocation', { RATE_LIMIT_AUTH_MAX: '100' });
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

function me(headers: Record<string, string>): Promise<Response> {
  return call(getMe, { headers, path: '/api/v1/me' });
}

describe('mobile access token after its family is revoked', () => {
  it('is rejected after logout while another device keeps working', async () => {
    const user = await createUser(auth);
    const phone = await mobileLogin(login, user.email, user.password);
    const tablet = await mobileLogin(login, user.email, user.password);
    expect((await me(bearer(phone.tokens.accessToken))).status).toBe(200);

    const loggedOut = await post(logout, bearer(phone.tokens.accessToken), {
      refreshToken: phone.tokens.refreshToken,
    });
    expect(loggedOut.status).toBe(204);

    await expectProblem(await me(bearer(phone.tokens.accessToken)), 401, 'unauthenticated');
    expect((await me(bearer(tablet.tokens.accessToken))).status).toBe(200);
  });

  it('is rejected after a password reset, for every device', async () => {
    const user = await createUser(auth);
    const phone = await mobileLogin(login, user.email, user.password);
    const tablet = await mobileLogin(login, user.email, user.password);

    expect((await post(forgot, mobile(), { email: user.email })).status).toBe(202);
    await auth.drain();
    const token = auth.mail.tokenFor(user.email, 'password_reset');
    expect((await post(reset, mobile(), { token, password: newPassword() })).status).toBe(204);

    await expectProblem(await me(bearer(phone.tokens.accessToken)), 401, 'unauthenticated');
    await expectProblem(await me(bearer(tablet.tokens.accessToken)), 401, 'unauthenticated');
  });

  it('is rejected when its family was revoked directly (reuse detection)', async () => {
    const user = await createUser(auth);
    const phone = await mobileLogin(login, user.email, user.password);
    await auth.database.client.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, user.id));
    await expectProblem(await me(bearer(phone.tokens.accessToken)), 401, 'unauthenticated');
  });

  it('is rejected when its family does not exist or belongs to a web session', async () => {
    const user = await createUser(auth);
    const orphan = await auth.harness.runtime.accessTokens.issue(
      { userId: user.id, sessionId: randomUUID() },
      auth.harness.runtime.now(),
    );
    await expectProblem(await me(bearer(orphan.token)), 401, 'unauthenticated');

    const signedIn = await post(login, web(), { email: user.email, password: user.password });
    expect(signedIn.status).toBe(200);
    webAuthResponseSchema.parse(await signedIn.clone().json());
    const [webRow] = await auth.database.client.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.client, 'web'));
    const crossed = await auth.harness.runtime.accessTokens.issue(
      { userId: user.id, sessionId: webRow?.familyId ?? '' },
      auth.harness.runtime.now(),
    );
    await expectProblem(await me(bearer(crossed.token)), 401, 'unauthenticated');
  });

  it('is rejected when the family belongs to another user', async () => {
    const owner = await createUser(auth);
    const other = await createUser(auth);
    const ownerSession = await mobileLogin(login, owner.email, owner.password);
    const [row] = await auth.database.client.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, owner.id));
    expect(ownerSession.tokens.accessToken.length).toBeGreaterThan(0);
    const forged = await auth.harness.runtime.accessTokens.issue(
      { userId: other.id, sessionId: row?.familyId ?? '' },
      auth.harness.runtime.now(),
    );
    await expectProblem(await me(bearer(forged.token)), 401, 'unauthenticated');
  });

  it('stays valid across a refresh rotation of the same family', async () => {
    const user = await createUser(auth);
    const phone = await mobileLogin(login, user.email, user.password);
    const rotated = await post(refresh, mobile(), { refreshToken: phone.tokens.refreshToken });
    expect(rotated.status).toBe(200);
    mobileRefreshResponseSchema.parse(await rotated.json());
    expect((await me(bearer(phone.tokens.accessToken))).status).toBe(200);
  });
});

describe('web session after revocation', () => {
  it('is rejected after logout', async () => {
    const user = await createUser(auth);
    const signedIn = await post(login, web(), { email: user.email, password: user.password });
    const cookies = parseSetCookies(signedIn);
    const session = cookies.get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '';
    const csrf = cookies.get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '';
    const cookie = `${auth.harness.env.SESSION_COOKIE_NAME}=${session}; ${auth.harness.env.CSRF_COOKIE_NAME}=${csrf}`;
    expect((await me(web(undefined, { cookie }))).status).toBe(200);

    const out = await post(logout, web(undefined, { cookie, 'x-csrf-token': csrf }), {});
    expect(out.status).toBe(204);
    await expectProblem(await me(web(undefined, { cookie })), 401, 'unauthenticated');
  });
});
