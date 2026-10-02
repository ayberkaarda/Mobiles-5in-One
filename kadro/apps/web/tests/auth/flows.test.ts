import { hashToken } from '@kadro/auth';
import {
  meResponseSchema,
  mobileRefreshResponseSchema,
  webAuthResponseSchema,
  webRefreshResponseSchema,
} from '@kadro/contracts';
import { auditLogs, deletionRequests, emailTokens, refreshTokens, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST as forgot } from '../../app/api/v1/auth/forgot/route';
import { POST as login } from '../../app/api/v1/auth/login/route';
import { POST as logout } from '../../app/api/v1/auth/logout/route';
import { POST as refresh } from '../../app/api/v1/auth/refresh/route';
import { POST as register } from '../../app/api/v1/auth/register/route';
import { POST as verifyEmail } from '../../app/api/v1/auth/verify-email/route';
import { GET as getMe, PATCH as patchMe } from '../../app/api/v1/me/route';
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
  uniqueEmail,
  uniqueIp,
  userRow,
  web,
} from './support';

/**
 * End-to-end auth flows against the real route handlers and a real database: registration,
 * verification, password and web sign-in, `me`, refresh and logout; non-enumeration of register
 * and forgot (ADR-0015); deactivated accounts (ADR-0012); breach check fail-open (ADR-0018);
 * cookie attributes and CSRF (ADR-0014); and the log sample of §6 item 14.
 */

let auth: AuthHarness;

beforeAll(async () => {
  auth = await setupAuthHarness('web_auth_flows', { RATE_LIMIT_AUTH_MAX: '100' });
});

afterAll(async () => {
  await auth.database.dispose();
});

beforeEach(async () => {
  auth.breach = { status: 'clean' };
  auth.mail.sent.length = 0;
  auth.harness.setNow(new Date());
});

function bearer(accessToken: string, ip = uniqueIp()): Record<string, string> {
  return mobile(ip, { authorization: `Bearer ${accessToken}` });
}

describe('mobile: register → verify → login → me → refresh → logout', () => {
  it('runs the whole flow and stores only hashes', async () => {
    const email = uniqueEmail();
    const password = newPassword();

    const registered = await post(register, mobile(), { email, password, displayName: 'Kaan' });
    expect(registered.status).toBe(202);
    expect(await registered.json()).toEqual({ status: 'accepted' });
    expect(registered.headers.getSetCookie()).toEqual([]);

    const [created] = await auth.database.client.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    expect(created?.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect(created?.emailVerifiedAt).toBeNull();

    // No email is sent before the response; the deferred task sends it.
    expect(auth.mail.sent).toHaveLength(0);
    await auth.drain();
    const token = auth.mail.tokenFor(email, 'verify_email');
    const stored = await auth.database.client.db
      .select()
      .from(emailTokens)
      .where(eq(emailTokens.userId, created?.id ?? ''));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    // Login works before verification (ADR-0015).
    const early = await mobileLogin(login, email, password);
    expect(early.user.emailVerified).toBe(false);

    expect((await post(verifyEmail, mobile(), { token })).status).toBe(204);
    await expectProblem(await post(verifyEmail, mobile(), { token }), 401, 'token_invalid');

    const session = await mobileLogin(login, email, password);
    expect(session.user.emailVerified).toBe(true);
    expect(session.user.email).toBe(email);
    expect(session.tokens.tokenType).toBe('Bearer');

    const me = await call(getMe, { headers: bearer(session.tokens.accessToken) });
    expect(me.status).toBe(200);
    expect(meResponseSchema.parse(await me.json()).id).toBe(created?.id);

    const rotated = await post(refresh, mobile(), { refreshToken: session.tokens.refreshToken });
    expect(rotated.status).toBe(200);
    const next = mobileRefreshResponseSchema.parse(await rotated.json());
    expect(next.tokens.refreshToken).not.toBe(session.tokens.refreshToken);

    const rows = await auth.database.client.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, created?.id ?? ''));
    expect(JSON.stringify(rows)).not.toContain(next.tokens.refreshToken);
    expect(rows.some((row) => row.tokenHash === hashToken(next.tokens.refreshToken))).toBe(true);

    const out = await post(logout, bearer(next.tokens.accessToken), {
      refreshToken: next.tokens.refreshToken,
    });
    expect(out.status).toBe(204);
    await expectProblem(
      await post(refresh, mobile(), { refreshToken: next.tokens.refreshToken }),
      401,
      'unauthenticated',
    );
    const audit = await auth.database.client.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, created?.id ?? ''));
    // Presenting the revoked token after logout is reuse by definition (ADR-0019).
    expect(audit.map((row) => row.action).sort()).toEqual(
      ['auth.emailVerified', 'auth.refreshReuse', 'auth.sessionRevoked'].sort(),
    );
    expect(JSON.stringify(audit)).not.toContain(email);
  });

  it('logout without an access token is 401 and revokes nothing', async () => {
    const user = await createUser(auth);
    const session = await mobileLogin(login, user.email, user.password);
    await expectProblem(
      await post(logout, mobile(), { refreshToken: session.tokens.refreshToken }),
      401,
      'unauthenticated',
    );
    expect(
      (await post(refresh, mobile(), { refreshToken: session.tokens.refreshToken })).status,
    ).toBe(200);
  });

  it('logout ignores a refresh token of another user', async () => {
    const alice = await createUser(auth);
    const bob = await createUser(auth);
    const aliceSession = await mobileLogin(login, alice.email, alice.password);
    const bobSession = await mobileLogin(login, bob.email, bob.password);
    const out = await post(logout, bearer(aliceSession.tokens.accessToken), {
      refreshToken: bobSession.tokens.refreshToken,
    });
    expect(out.status).toBe(204);
    expect(
      (await post(refresh, mobile(), { refreshToken: bobSession.tokens.refreshToken })).status,
    ).toBe(200);
  });
});

describe('web session cookies and CSRF', () => {
  it('sets __Host- cookies with HttpOnly, Secure, SameSite=Lax, Path=/ and no token in the body', async () => {
    const user = await createUser(auth);
    const response = await post(login, web(), { email: user.email, password: user.password });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = webAuthResponseSchema.parse(JSON.parse(text));
    expect(text).not.toContain('refreshToken');
    expect(text).not.toContain('accessToken');

    const cookies = parseSetCookies(response);
    const session = cookies.get('__Host-kadro_session');
    const csrf = cookies.get('__Host-kadro_csrf');
    expect(session).toBeDefined();
    expect(csrf).toBeDefined();
    expect(session?.attributes).toEqual(
      expect.arrayContaining(['Path=/', 'Secure', 'SameSite=Lax', 'HttpOnly', 'Max-Age=604800']),
    );
    expect(session?.attributes.some((attribute) => /^domain=/i.test(attribute))).toBe(false);
    expect(csrf?.attributes).toEqual(expect.arrayContaining(['Path=/', 'Secure', 'SameSite=Lax']));
    expect(csrf?.attributes).not.toContain('HttpOnly');
    expect(csrf?.value).toBe(body.csrfToken);
    expect(text).not.toContain(session?.value ?? 'missing');
  });

  it('requires the CSRF header on mutations, rotates on refresh and logs out', async () => {
    const user = await createUser(auth);
    const signedIn = await post(login, web(), { email: user.email, password: user.password });
    const first = parseSetCookies(signedIn);
    const sessionValue = first.get('__Host-kadro_session')?.value ?? '';
    const csrfValue = first.get('__Host-kadro_csrf')?.value ?? '';
    const cookie = `__Host-kadro_session=${sessionValue}; __Host-kadro_csrf=${csrfValue}`;

    // Reads need no CSRF header; the bearer header is ignored on web.
    const read = await call(getMe, { headers: web(uniqueIp(), { cookie }) });
    expect(read.status).toBe(200);

    await expectProblem(
      await call(patchMe, {
        method: 'PATCH',
        headers: web(uniqueIp(), { cookie }),
        json: { displayName: 'Yeni Ad' },
      }),
      403,
      'csrf_failed',
    );
    const patched = await call(patchMe, {
      method: 'PATCH',
      headers: web(uniqueIp(), { cookie, 'x-csrf-token': csrfValue }),
      json: { displayName: 'Yeni Ad' },
    });
    expect(patched.status).toBe(200);

    // Refresh consumes the cookie: CSRF is required.
    await expectProblem(await post(refresh, web(uniqueIp(), { cookie }), {}), 403, 'csrf_failed');
    const rotated = await post(refresh, web(uniqueIp(), { cookie, 'x-csrf-token': csrfValue }), {});
    expect(rotated.status).toBe(200);
    const rotatedBody = webRefreshResponseSchema.parse(await rotated.json());
    const second = parseSetCookies(rotated);
    const newSession = second.get('__Host-kadro_session')?.value ?? '';
    expect(newSession).not.toBe(sessionValue);
    expect(second.get('__Host-kadro_csrf')?.value).toBe(rotatedBody.csrfToken);
    const newCookie = `__Host-kadro_session=${newSession}; __Host-kadro_csrf=${rotatedBody.csrfToken}`;

    const out = await post(
      logout,
      web(uniqueIp(), { cookie: newCookie, 'x-csrf-token': rotatedBody.csrfToken }),
      {},
    );
    expect(out.status).toBe(204);
    const cleared = parseSetCookies(out);
    expect(cleared.get('__Host-kadro_session')?.attributes).toContain('Max-Age=0');
    expect(cleared.get('__Host-kadro_csrf')?.attributes).toContain('Max-Age=0');
    await expectProblem(
      await call(getMe, { headers: web(uniqueIp(), { cookie: newCookie }) }),
      401,
      'unauthenticated',
    );
  });
});

describe('register and forgot never reveal whether an account exists (ADR-0015)', () => {
  function shape(response: Response, body: string) {
    const headers = [...response.headers.entries()]
      .filter(([name]) => name !== 'x-request-id')
      .sort(([a], [b]) => a.localeCompare(b));
    return { status: response.status, body, headers };
  }

  it('answers register identically for a new and an existing email', async () => {
    const existing = await createUser(auth);
    const fresh = uniqueEmail();
    const timings: { existing: number[]; fresh: number[] } = { existing: [], fresh: [] };
    const shapes = [];
    for (const [kind, email] of [
      ['existing', existing.email],
      ['fresh', fresh],
    ] as const) {
      const started = performance.now();
      const response = await post(register, mobile(), {
        email,
        password: newPassword(),
        displayName: 'Deneme',
      });
      timings[kind].push(performance.now() - started);
      shapes.push(shape(response, await response.text()));
    }
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[0]?.status).toBe(202);

    // The existing account is unchanged and gets an "already registered" email after the response.
    expect(auth.mail.sent).toHaveLength(0);
    await auth.drain();
    expect(auth.mail.sent.map((message) => [message.to, message.kind])).toEqual([
      [existing.email, 'already_registered'],
      [fresh, 'verify_email'],
    ]);
    const unchanged = await userRow(auth, existing.id);
    expect(unchanged?.displayName).toBe('Test Oyuncu');

    // Both branches hash the password, so response times stay in the same range.
    const ratio = (timings.existing[0] ?? 0) / (timings.fresh[0] ?? 1);
    expect(ratio).toBeGreaterThan(0.33);
    expect(ratio).toBeLessThan(3);
  });

  it('answers forgot identically for existing, unknown and social-only emails', async () => {
    const withPassword = await createUser(auth);
    const socialOnly = await createUser(auth, { passwordHash: null, googleSub: 'google-sub-1' });
    const shapes = [];
    for (const email of [withPassword.email, uniqueEmail(), socialOnly.email]) {
      const response = await post(forgot, mobile(), { email });
      shapes.push(shape(response, await response.text()));
    }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
    expect(shapes[0]?.status).toBe(202);
    expect(auth.mail.sent).toHaveLength(0);
    await auth.drain();
    expect(auth.mail.sent.map((message) => [message.to, message.kind])).toEqual([
      [withPassword.email, 'password_reset'],
    ]);
  });
});

describe('login', () => {
  it('answers unknown email, wrong password and social-only accounts with the same 401', async () => {
    const user = await createUser(auth);
    const social = await createUser(auth, { passwordHash: null, appleSub: 'apple-sub-login' });
    const bodies = [];
    for (const [email, password] of [
      [uniqueEmail(), newPassword()],
      [user.email, newPassword()],
      [social.email, newPassword()],
    ] as const) {
      const problem = await expectProblem(
        await post(login, mobile(), { email, password }),
        401,
        'invalid_credentials',
      );
      bodies.push({ ...problem, requestId: '' });
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('refuses an account deactivated by an admin, only after the password matched', async () => {
    const user = await createUser(auth, { deactivatedAt: new Date() });
    await expectProblem(
      await post(login, mobile(), { email: user.email, password: newPassword() }),
      401,
      'invalid_credentials',
    );
    await expectProblem(
      await post(login, mobile(), { email: user.email, password: user.password }),
      401,
      'account_deactivated',
    );
    const rows = await auth.database.client.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    expect(rows).toHaveLength(0);
  });

  it('cancels a self-initiated deletion during its grace period', async () => {
    const now = auth.harness.runtime.now();
    const user = await createUser(auth, { deactivatedAt: now });
    await auth.database.client.db.insert(deletionRequests).values({
      userId: user.id,
      requestedAt: now,
      graceUntil: new Date(now.getTime() + 7 * 24 * 3_600_000),
    });
    const session = await mobileLogin(login, user.email, user.password);
    expect(session.user.id).toBe(user.id);
    expect((await userRow(auth, user.id))?.deactivatedAt).toBeNull();
    const pending = await auth.database.client.db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.userId, user.id));
    expect(pending).toHaveLength(0);
    const audit = await auth.database.client.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, user.id));
    expect(audit.map((row) => row.action)).toEqual(['auth.deletionCancelled']);
  });

  it('rejects a still-valid access token once the account is deactivated', async () => {
    const user = await createUser(auth);
    const session = await mobileLogin(login, user.email, user.password);
    await auth.database.client.db
      .update(users)
      .set({ deactivatedAt: new Date() })
      .where(eq(users.id, user.id));
    await expectProblem(
      await call(getMe, { headers: bearer(session.tokens.accessToken) }),
      401,
      'account_deactivated',
    );
    await expectProblem(
      await post(refresh, mobile(), { refreshToken: session.tokens.refreshToken }),
      401,
      'account_deactivated',
    );
  });
});

describe('password rule and breach check (ADR-0018)', () => {
  it('refuses a breached password with 422 and creates nothing', async () => {
    auth.breach = { status: 'breached', occurrences: 12 };
    const email = uniqueEmail();
    await expectProblem(
      await post(register, mobile(), { email, password: newPassword(), displayName: 'Deneme' }),
      422,
      'password_breached',
    );
    const rows = await auth.database.client.db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });

  it('accepts the password when the service is unavailable and records the metric', async () => {
    auth.breach = { status: 'unavailable', reason: 'timeout' };
    const before = auth.harness.runtime.metrics.value('password_breach_check_unavailable');
    auth.harness.logLines.length = 0;
    const password = newPassword();
    const response = await post(register, mobile(), {
      email: uniqueEmail(),
      password,
      displayName: 'Deneme',
    });
    expect(response.status).toBe(202);
    expect(auth.harness.runtime.metrics.value('password_breach_check_unavailable')).toBe(
      before + 1,
    );
    const warning = auth.harness.logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record.metric === 'password_breach_check_unavailable');
    expect(warning).toMatchObject({ outcome: 'unavailable', reason: 'timeout' });
    expect(auth.harness.logLines.join('\n')).not.toContain(password);
  });

  it('rejects a short password with 400 before any hashing', async () => {
    await expectProblem(
      await post(register, mobile(), {
        email: uniqueEmail(),
        password: 'kisa',
        displayName: 'Deneme',
      }),
      400,
      'validation_failed',
    );
  });
});

describe('log sample of a login flow (§6 item 14)', () => {
  it('contains no email, password or token', async () => {
    const email = uniqueEmail();
    const password = newPassword();
    auth.harness.logLines.length = 0;
    await post(register, mobile(), { email, password, displayName: 'Loglu' });
    await post(login, mobile(), { email, password: newPassword() });
    const session = await mobileLogin(login, email, password);
    const webLogin = await post(login, web(), { email, password });
    const webBody = webAuthResponseSchema.parse(await webLogin.json());
    const webCookie = parseSetCookies(webLogin).get('__Host-kadro_session')?.value ?? '';
    await call(getMe, { headers: bearer(session.tokens.accessToken) });
    await post(refresh, mobile(), { refreshToken: session.tokens.refreshToken });
    await post(refresh, mobile(), { refreshToken: session.tokens.refreshToken });

    const sample = auth.harness.logLines.join('\n');
    expect(auth.harness.logLines.length).toBeGreaterThanOrEqual(7);
    for (const secret of [
      email,
      email.split('@')[0] ?? email,
      password,
      session.tokens.accessToken,
      session.tokens.refreshToken,
      webBody.csrfToken,
      webCookie,
    ]) {
      expect(sample).not.toContain(secret);
    }
    expect(sample).toContain('refresh_reuse_detected');
  });
});
