import { randomBytes } from 'node:crypto';

import {
  adminStepUpResponseSchema,
  adminTotpEnrollResponseSchema,
  LIMITS,
  type PlatformRole,
} from '@kadro/contracts';
import { auditLogs, refreshTokens, users } from '@kadro/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as loginRoute } from '../../app/api/v1/auth/login/route';
import { POST as stepUpRoute } from '../../app/api/v1/admin/step-up/route';
import { POST as confirmRoute } from '../../app/api/v1/admin/totp/confirm/route';
import { POST as enrollRoute } from '../../app/api/v1/admin/totp/enroll/route';
import { DELETE as deleteMe } from '../../app/api/v1/me/route';
import {
  encryptTotpSecret,
  generateTotpSecret,
  hotp,
  timeStep,
  TOTP_PERIOD_SECONDS,
} from '../../lib/server/admin/totp';
import { json, route } from '../../lib/server/http';
import { installServerRuntime } from '../../lib/server/runtime';
import { noParams, noQuery } from '../../lib/server/validate';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  parseSetCookies,
  post,
  setupAuthHarness,
  web,
} from '../auth/support';
import { call, expectProblem } from '../support/http';
import { installTestRuntime } from '../support/runtime';

/**
 * Staff TOTP (security checklist item 18, matrix §3.8 footnotes 26 and 27, ADR-0064, ADR-0066):
 * enrollment with re-authentication, confirmation inside its window, step-up bound to the
 * session, ±1 step, replay refusal, the shared attempt budget, audit rows, and the fresh code of
 * staff account deletion.
 */

let auth: AuthHarness;
const db = () => auth.database.client.db;
const STEP_MS = TOTP_PERIOD_SECONDS * 1_000;

/** A `GET admin/**` stand-in: passes only with a valid step-up. */
const adminRead = route({
  path: '/api/v1/test/admin-read',
  method: 'GET',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: null,
  handler: async ({ ctx }) => {
    await ctx.authorize('admin.read');
    return json({ ok: true });
  },
});

beforeAll(async () => {
  auth = await setupAuthHarness('web_admin_totp', {
    RATE_LIMIT_AUTH_MAX: '100',
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  });
});

afterAll(async () => {
  await auth.database.dispose();
});

/** Puts the clock 5 s into a fresh time step, so a test never straddles a step boundary. */
function alignClock(): void {
  const now = Date.now();
  auth.harness.setNow(new Date(Math.floor(now / STEP_MS) * STEP_MS + STEP_MS + 5_000));
}

function key(): Buffer {
  return Buffer.from(auth.harness.env.TOTP_ENCRYPTION_KEY ?? '', 'base64url');
}

function code(secret: Buffer, offsetSteps = 0): string {
  return hotp(secret, timeStep(auth.harness.runtime.now()) + offsetSteps);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(value: string): Buffer {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of value) {
    buffer = (buffer << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

interface Staff {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly headers: Record<string, string>;
}

async function signedIn(role: PlatformRole = 'moderator'): Promise<Staff> {
  const user = await createUser(auth, { role });
  const session = await mobileLogin(loginRoute, user.email, user.password);
  return {
    ...user,
    headers: mobile(undefined, { authorization: `Bearer ${session.tokens.accessToken}` }),
  };
}

async function webSignedIn(user: { email: string; password: string }) {
  const response = await post(loginRoute, web(), { email: user.email, password: user.password });
  expect(response.status).toBe(200);
  const cookies = parseSetCookies(response);
  const session = cookies.get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '';
  const csrf = cookies.get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '';
  const cookie = `${auth.harness.env.SESSION_COOKIE_NAME}=${session}; ${auth.harness.env.CSRF_COOKIE_NAME}=${csrf}`;
  return web(undefined, { cookie, 'x-csrf-token': csrf });
}

/** Stores an active secret directly (as a confirmed enrollment would). */
async function enrolled(userId: string): Promise<Buffer> {
  const secret = generateTotpSecret();
  await db()
    .update(users)
    .set({ totpSecretEnc: encryptTotpSecret(key(), userId, secret) })
    .where(eq(users.id, userId));
  return secret;
}

const enroll = (headers: Record<string, string>, body: unknown) =>
  post(enrollRoute, headers, body, '/api/v1/admin/totp/enroll');
const confirm = (headers: Record<string, string>, totpCode: string) =>
  post(confirmRoute, headers, { totpCode }, '/api/v1/admin/totp/confirm');
const stepUp = (headers: Record<string, string>, totpCode: string) =>
  post(stepUpRoute, headers, { totpCode }, '/api/v1/admin/step-up');

async function auditActions(userId: string) {
  const rows = await db()
    .select({ action: auditLogs.action, metadata: auditLogs.metadata })
    .from(auditLogs)
    .where(eq(auditLogs.actorId, userId))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
  return rows;
}

async function account(userId: string) {
  const [row] = await db().select().from(users).where(eq(users.id, userId));
  return row;
}

describe('POST admin/totp/enroll and admin/totp/confirm', () => {
  it('enrolls in two steps and refuses a second enrollment', async () => {
    alignClock();
    const staff = await signedIn('admin');
    const started = await enroll(staff.headers, { password: staff.password });
    const text = await started.text();
    expect(started.status, text).toBe(201);
    const body = adminTotpEnrollResponseSchema.parse(JSON.parse(text));
    expect(new Date(body.confirmBy).getTime()).toBe(
      auth.harness.runtime.now().getTime() + LIMITS.totpEnrollmentWindowSeconds * 1_000,
    );
    expect(new URL(body.otpauthUri).searchParams.get('secret')).toBe(body.secret);

    const pending = await account(staff.id);
    expect(pending?.totpSecretEnc).toBeNull();
    expect(pending?.totpPendingSecretEnc).toMatch(/^v1\./);
    expect(pending?.totpPendingSecretEnc).not.toContain(body.secret);

    const secret = base32Decode(body.secret);
    const wrong = String((Number(code(secret)) + 1) % 1_000_000).padStart(6, '0');
    await expectProblem(await confirm(staff.headers, wrong), 401, 'totp_invalid');
    const confirmed = await confirm(staff.headers, code(secret));
    expect(confirmed.status, await confirmed.clone().text()).toBe(204);

    const active = await account(staff.id);
    expect(active?.totpSecretEnc).toBe(pending?.totpPendingSecretEnc);
    expect(active?.totpPendingSecretEnc).toBeNull();
    expect(active?.totpLastUsedStep).toBe(timeStep(auth.harness.runtime.now()));
    // Activation alone opens no step-up window.
    await expectProblem(await call(adminRead, { headers: staff.headers }), 401, 'step_up_required');

    await expectProblem(
      await enroll(staff.headers, { password: staff.password }),
      409,
      'totp_already_enrolled',
    );
    await expectProblem(
      await confirm(staff.headers, code(secret, 1)),
      409,
      'totp_already_enrolled',
    );

    expect((await auditActions(staff.id)).map((row) => row.action)).toEqual([
      'admin.totpEnrollStarted',
      'admin.totpConfirmFailed',
      'admin.totpEnrolled',
    ]);
  });

  it('requires a valid re-authentication proof', async () => {
    alignClock();
    const staff = await signedIn();
    await expectProblem(
      await enroll(staff.headers, { password: `${staff.password}x` }),
      401,
      'reauth_required',
    );
    await expectProblem(await enroll(staff.headers, {}), 400, 'validation_failed');
    expect((await account(staff.id))?.totpPendingSecretEnc).toBeNull();
    await expectProblem(await confirm(staff.headers, '000000'), 409, 'totp_not_enrolled');
    expect(await auditActions(staff.id)).toEqual([
      { action: 'admin.totpEnrollFailed', metadata: { reason: 'reauth', client: 'mobile' } },
      { action: 'admin.totpConfirmFailed', metadata: { reason: 'not_enrolled', client: 'mobile' } },
    ]);
  });

  it('expires a pending secret after its 10-minute window', async () => {
    alignClock();
    const staff = await signedIn();
    const started = await enroll(staff.headers, { password: staff.password });
    const body = adminTotpEnrollResponseSchema.parse(await started.json());
    auth.harness.advance(LIMITS.totpEnrollmentWindowSeconds * 1_000 + 1_000);
    await expectProblem(
      await confirm(staff.headers, code(base32Decode(body.secret))),
      409,
      'totp_not_enrolled',
    );
    expect((await account(staff.id))?.totpSecretEnc).toBeNull();
  });

  it('replaces a pending secret on a new enrollment', async () => {
    alignClock();
    const staff = await signedIn();
    const first = adminTotpEnrollResponseSchema.parse(
      await (await enroll(staff.headers, { password: staff.password })).json(),
    );
    const second = adminTotpEnrollResponseSchema.parse(
      await (await enroll(staff.headers, { password: staff.password })).json(),
    );
    expect(second.secret).not.toBe(first.secret);
    await expectProblem(
      await confirm(staff.headers, code(base32Decode(first.secret))),
      401,
      'totp_invalid',
    );
    expect((await confirm(staff.headers, code(base32Decode(second.secret)))).status).toBe(204);
  });

  it('answers 403 to non-staff before reading anything', async () => {
    const player = await signedIn('user');
    await expectProblem(
      await enroll(player.headers, { password: player.password }),
      403,
      'forbidden',
    );
    await expectProblem(await confirm(player.headers, '123456'), 403, 'forbidden');
    await expectProblem(await stepUp(player.headers, '123456'), 403, 'forbidden');
    const row = await account(player.id);
    expect(row?.totpPendingSecretEnc).toBeNull();
    expect(await auditActions(player.id)).toEqual([]);
  });
});

describe('POST admin/step-up', () => {
  it('opens a 15-minute window on the mobile family and refuses a replayed code', async () => {
    alignClock();
    const staff = await signedIn();
    const secret = await enrolled(staff.id);
    await expectProblem(await stepUp(staff.headers, code(secret, 2)), 401, 'totp_invalid');

    const response = await stepUp(staff.headers, code(secret));
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const { stepUpUntil } = adminStepUpResponseSchema.parse(JSON.parse(text));
    const expected = auth.harness.runtime.now().getTime() + LIMITS.stepUpWindowSeconds * 1_000;
    expect(new Date(stepUpUntil).getTime()).toBe(expected);
    const rows = await db()
      .select({ stepUpUntil: refreshTokens.stepUpUntil })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, staff.id), isNull(refreshTokens.revokedAt)));
    expect(rows.map((row) => row.stepUpUntil?.getTime())).toEqual([expected]);
    expect((await call(adminRead, { headers: staff.headers })).status).toBe(200);

    await expectProblem(await stepUp(staff.headers, code(secret)), 401, 'totp_invalid');
    auth.harness.advance(STEP_MS);
    expect((await stepUp(staff.headers, code(secret))).status).toBe(200);

    expect((await auditActions(staff.id)).map((row) => [row.action, row.metadata])).toEqual([
      ['admin.stepUpFailed', { reason: 'invalid', client: 'mobile' }],
      ['admin.stepUp', { client: 'mobile' }],
      ['admin.stepUpFailed', { reason: 'invalid', client: 'mobile' }],
      ['admin.stepUp', { client: 'mobile' }],
    ]);
    // The window closes after 15 minutes.
    auth.harness.advance(LIMITS.stepUpWindowSeconds * 1_000 + 1_000);
    const later = await db()
      .select({ stepUpUntil: refreshTokens.stepUpUntil })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, staff.id));
    expect(
      later.every(
        (row) => (row.stepUpUntil?.getTime() ?? 0) < auth.harness.runtime.now().getTime(),
      ),
    ).toBe(true);
  });

  it('accepts one step either side, never two, and only forward', async () => {
    alignClock();
    const staff = await signedIn();
    const secret = await enrolled(staff.id);
    await expectProblem(await stepUp(staff.headers, code(secret, -2)), 401, 'totp_invalid');
    expect((await stepUp(staff.headers, code(secret, -1))).status).toBe(200);
    expect((await stepUp(staff.headers, code(secret, 1))).status).toBe(200);
    // Step 0 is now below the last accepted step.
    await expectProblem(await stepUp(staff.headers, code(secret, 0)), 401, 'totp_invalid');
  });

  it('answers 409 totp_not_enrolled without an active secret', async () => {
    const staff = await signedIn('admin');
    await expectProblem(await stepUp(staff.headers, '123456'), 409, 'totp_not_enrolled');
  });

  it('binds the window to the web session that stepped up', async () => {
    alignClock();
    const user = await createUser(auth, { role: 'moderator' });
    const secret = await enrolled(user.id);
    const first = await webSignedIn(user);
    const second = await webSignedIn(user);
    expect((await stepUp(first, code(secret))).status).toBe(200);
    expect((await call(adminRead, { headers: first })).status).toBe(200);
    await expectProblem(await call(adminRead, { headers: second }), 401, 'step_up_required');
    const rows = await db()
      .select({ stepUpUntil: refreshTokens.stepUpUntil })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.id));
    expect(rows.filter((row) => row.stepUpUntil !== null)).toHaveLength(1);
  });

  it('accepts the same code once under concurrent requests', async () => {
    alignClock();
    const staff = await signedIn();
    const secret = await enrolled(staff.id);
    const value = code(secret);
    const statuses = (
      await Promise.all([stepUp(staff.headers, value), stepUp(staff.headers, value)])
    ).map((response) => response.status);
    expect(statuses.sort()).toEqual([200, 401]);
  });

  it('shares a 5-attempt budget across TOTP checks of the account', async () => {
    alignClock();
    const staff = await signedIn();
    const secret = await enrolled(staff.id);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectProblem(await stepUp(staff.headers, code(secret, 3)), 401, 'totp_invalid');
    }
    const blocked = await stepUp(staff.headers, code(secret));
    await expectProblem(blocked, 429, 'rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // The fresh code of another endpoint draws on the same budget.
    const deletion = await call(deleteMe, {
      method: 'DELETE',
      path: '/api/v1/me',
      headers: staff.headers,
      json: { password: staff.password, totpCode: code(secret) },
    });
    await expectProblem(deletion, 429, 'rate_limited');
    expect((await account(staff.id))?.deactivatedAt).toBeNull();
  });

  it('fails closed with 503 when no encryption key is configured', async () => {
    const staff = await signedIn();
    const keyless = await installTestRuntime({
      db: db(),
      env: { DATABASE_URL: auth.database.url, RATE_LIMIT_AUTH_MAX: '100' },
      now: auth.harness.runtime.now(),
    });
    try {
      await expectProblem(await stepUp(staff.headers, '123456'), 503, 'service_unavailable');
      await expectProblem(
        await enroll(staff.headers, { password: staff.password }),
        503,
        'service_unavailable',
      );
    } finally {
      await keyless.runtime.jobClient.close();
      installServerRuntime(auth.harness.runtime);
    }
  });
});

describe('fresh TOTP code of staff account deletion (footnote 5)', () => {
  it('deletes a staff account with a valid fresh code', async () => {
    alignClock();
    const staff = await signedIn('moderator');
    const secret = await enrolled(staff.id);
    const response = await call(deleteMe, {
      method: 'DELETE',
      path: '/api/v1/me',
      headers: staff.headers,
      json: { password: staff.password, totpCode: code(secret) },
    });
    expect(response.status, await response.clone().text()).toBe(202);
    expect((await account(staff.id))?.deactivatedAt).not.toBeNull();
  });

  it('refuses a code whose step was already used for step-up', async () => {
    alignClock();
    const staff = await signedIn('moderator');
    const secret = await enrolled(staff.id);
    expect((await stepUp(staff.headers, code(secret))).status).toBe(200);
    const response = await call(deleteMe, {
      method: 'DELETE',
      path: '/api/v1/me',
      headers: staff.headers,
      json: { password: staff.password, totpCode: code(secret) },
    });
    await expectProblem(response, 401, 'step_up_required');
    expect((await account(staff.id))?.deactivatedAt).toBeNull();
    expect((await auditActions(staff.id)).map((row) => row.action)).toEqual([
      'admin.stepUp',
      'admin.freshTotpFailed',
    ]);
  });
});
