import { randomBytes } from 'node:crypto';

import { adminTotpEnrollResponseSchema, type PlatformRole } from '@kadro/contracts';
import { refreshTokens, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PATCH as deactivateRoute } from '../../app/api/v1/admin/users/[id]/deactivate/route';
import { PATCH as roleRoute } from '../../app/api/v1/admin/users/[id]/role/route';
import { POST as stepUpRoute } from '../../app/api/v1/admin/step-up/route';
import { POST as confirmRoute } from '../../app/api/v1/admin/totp/confirm/route';
import { POST as enrollRoute } from '../../app/api/v1/admin/totp/enroll/route';
import { POST as loginRoute } from '../../app/api/v1/auth/login/route';
import { DELETE as deleteMe } from '../../app/api/v1/me/route';
import {
  encryptTotpSecret,
  generateTotpSecret,
  hotp,
  timeStep,
  TOTP_PERIOD_SECONDS,
} from '../../lib/server/admin/totp';
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

/**
 * TOTP replay and throttle abuse (security checklist item 18, matrix §3.8 footnotes 26 and 27,
 * ADR-0066): one code reused across step-up, enrollment confirmation and the per-action codes of
 * role change, deactivation and staff account deletion; the same code raced in parallel within
 * and across endpoints; a burst of wrong guesses fired concurrently against the shared 5-attempt
 * budget; the budget shared across sessions, clients and source addresses; codes at the exact
 * edges of the ±1 step window; and malformed codes, which must be refused by validation without
 * spending the budget.
 */

let auth: AuthHarness;
const db = () => auth.database.client.db;
const STEP_MS = TOTP_PERIOD_SECONDS * 1_000;
const WINDOW_MS = 15 * 60 * 1_000;

beforeAll(async () => {
  auth = await setupAuthHarness('web_attack_edge_totp', {
    RATE_LIMIT_AUTH_MAX: '100',
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
  });
});

afterAll(async () => {
  await auth.database.dispose();
});

/** Puts the clock 5 s into a fresh time step. */
function alignClock(): void {
  const now = Date.now();
  auth.harness.setNow(new Date(Math.floor(now / STEP_MS) * STEP_MS + STEP_MS + 5_000));
}

/** Puts the clock on `offsetMs` after the start of a fresh time step. */
function clockAtStepOffset(offsetMs: number): void {
  const now = Date.now();
  auth.harness.setNow(new Date(Math.floor(now / STEP_MS) * STEP_MS + 2 * STEP_MS + offsetMs));
}

function key(): Buffer {
  return Buffer.from(auth.harness.env.TOTP_ENCRYPTION_KEY ?? '', 'base64url');
}

function code(secret: Buffer, offsetSteps = 0): string {
  return hotp(secret, timeStep(auth.harness.runtime.now()) + offsetSteps);
}

/** Six digits that are not valid for this step or a neighbour. */
function wrongCode(secret: Buffer): string {
  const valid = new Set([-1, 0, 1].map((offset) => code(secret, offset)));
  for (let value = 0; ; value += 1) {
    const candidate = String(value).padStart(6, '0');
    if (!valid.has(candidate)) {
      return candidate;
    }
  }
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

async function signedIn(role: PlatformRole): Promise<Staff> {
  const user = await createUser(auth, { role });
  return { ...user, headers: await mobileSession(user) };
}

async function mobileSession(user: { email: string; password: string }) {
  const session = await mobileLogin(loginRoute, user.email, user.password);
  return mobile(undefined, { authorization: `Bearer ${session.tokens.accessToken}` });
}

async function webSession(user: { email: string; password: string }) {
  const response = await post(loginRoute, web(), { email: user.email, password: user.password });
  expect(response.status).toBe(200);
  const cookies = parseSetCookies(response);
  const session = cookies.get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '';
  const csrf = cookies.get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '';
  const cookie = `${auth.harness.env.SESSION_COOKIE_NAME}=${session}; ${auth.harness.env.CSRF_COOKIE_NAME}=${csrf}`;
  return {
    withCsrf: web(undefined, { cookie, 'x-csrf-token': csrf }),
    withoutCsrf: web(undefined, { cookie }),
  };
}

async function enrolled(userId: string): Promise<Buffer> {
  const secret = generateTotpSecret();
  await db()
    .update(users)
    .set({ totpSecretEnc: encryptTotpSecret(key(), userId, secret) })
    .where(eq(users.id, userId));
  return secret;
}

async function openWindow(userId: string): Promise<void> {
  await db()
    .update(refreshTokens)
    .set({ stepUpUntil: new Date(auth.harness.runtime.now().getTime() + WINDOW_MS) })
    .where(eq(refreshTokens.userId, userId));
}

async function account(userId: string) {
  const [row] = await db().select().from(users).where(eq(users.id, userId));
  return row;
}

const stepUp = (headers: Record<string, string>, totpCode: unknown) =>
  post(stepUpRoute, headers, { totpCode }, '/api/v1/admin/step-up');
const enroll = (staff: Staff) =>
  post(enrollRoute, staff.headers, { password: staff.password }, '/api/v1/admin/totp/enroll');
const confirm = (headers: Record<string, string>, totpCode: string) =>
  post(confirmRoute, headers, { totpCode }, '/api/v1/admin/totp/confirm');
const roleChange = (headers: Record<string, string>, targetId: string, totpCode: unknown) =>
  call(roleRoute, {
    method: 'PATCH',
    path: `/api/v1/admin/users/${targetId}/role`,
    headers,
    params: { id: targetId },
    json: { role: 'moderator', totpCode },
  });
const deactivation = (headers: Record<string, string>, targetId: string, totpCode: unknown) =>
  call(deactivateRoute, {
    method: 'PATCH',
    path: `/api/v1/admin/users/${targetId}/deactivate`,
    headers,
    params: { id: targetId },
    json: { deactivated: true, totpCode },
  });
const deletion = (staff: Staff, headers: Record<string, string>, totpCode: string) =>
  call(deleteMe, {
    method: 'DELETE',
    path: '/api/v1/me',
    headers,
    json: { password: staff.password, totpCode },
  });

describe('replay of one code across endpoints', () => {
  it('refuses the confirming code of an enrollment as a step-up code', async () => {
    alignClock();
    const staff = await signedIn('moderator');
    const started = await enroll(staff);
    expect(started.status, await started.clone().text()).toBe(201);
    const secret = base32Decode(adminTotpEnrollResponseSchema.parse(await started.json()).secret);
    const value = code(secret);
    expect((await confirm(staff.headers, value)).status).toBe(204);
    await expectProblem(await stepUp(staff.headers, value), 401, 'totp_invalid');
    // The confirmation consumed this step, so the code of the previous step is also below it.
    await expectProblem(await stepUp(staff.headers, code(secret, -1)), 401, 'totp_invalid');
    expect((await stepUp(staff.headers, code(secret, 1))).status).toBe(200);
  });

  it('refuses a step-up code reused for a role change, a deactivation and an account deletion', async () => {
    alignClock();
    const admin = await signedIn('admin');
    const secret = await enrolled(admin.id);
    const victim = await createUser(auth);
    const value = code(secret);
    expect((await stepUp(admin.headers, value)).status).toBe(200);
    await expectProblem(await roleChange(admin.headers, victim.id, value), 401, 'totp_invalid');
    await expectProblem(await deactivation(admin.headers, victim.id, value), 401, 'totp_invalid');
    await expectProblem(await deletion(admin, admin.headers, value), 401, 'step_up_required');
    expect(await account(victim.id)).toMatchObject({ role: 'user', deactivatedAt: null });
    expect((await account(admin.id))?.deactivatedAt).toBeNull();
    // Control: the route accepts a code of an unused step.
    const fresh = await roleChange(admin.headers, victim.id, code(secret, 1));
    expect(fresh.status, await fresh.clone().text()).toBe(200);
  });

  it('refuses the code of the previous step once the clock has moved past it', async () => {
    clockAtStepOffset(STEP_MS - 1);
    const staff = await signedIn('moderator');
    const secret = await enrolled(staff.id);
    const used = code(secret);
    expect((await stepUp(staff.headers, used)).status).toBe(200);
    auth.harness.advance(1);
    expect(code(secret, -1)).toBe(used);
    await expectProblem(await stepUp(staff.headers, used), 401, 'totp_invalid');
    expect((await stepUp(staff.headers, code(secret))).status).toBe(200);
  });

  it("refuses another staff member's valid code", async () => {
    alignClock();
    const staff = await signedIn('moderator');
    await enrolled(staff.id);
    const other = await signedIn('moderator');
    const otherSecret = await enrolled(other.id);
    await expectProblem(await stepUp(staff.headers, code(otherSecret)), 401, 'totp_invalid');
    expect((await account(staff.id))?.totpLastUsedStep).toBeNull();
    expect((await account(other.id))?.totpLastUsedStep).toBeNull();
  });
});

describe('parallel replay of one code', () => {
  it('lets one code pass once when it is raced across step-up, role change and deactivation', async () => {
    alignClock();
    const admin = await signedIn('admin');
    const secret = await enrolled(admin.id);
    await openWindow(admin.id);
    const roleVictim = await createUser(auth);
    const banVictim = await createUser(auth);
    const value = code(secret);
    const responses = await Promise.all([
      stepUp(admin.headers, value),
      roleChange(admin.headers, roleVictim.id, value),
      deactivation(admin.headers, banVictim.id, value),
      stepUp(admin.headers, value),
      roleChange(admin.headers, roleVictim.id, value),
    ]);
    const statuses = responses.map((response) => response.status);
    expect(
      statuses.filter((status) => status === 200),
      statuses.join(),
    ).toHaveLength(1);
    expect(statuses.filter((status) => status !== 200)).toEqual([401, 401, 401, 401]);
    const sideEffects =
      Number((await account(roleVictim.id))?.role === 'moderator') +
      Number((await account(banVictim.id))?.deactivatedAt !== null);
    expect(sideEffects).toBe(statuses[0] === 200 || statuses[3] === 200 ? 0 : 1);
  });

  it('confirms an enrollment once when the confirming code is raced', async () => {
    alignClock();
    const staff = await signedIn('moderator');
    const started = await enroll(staff);
    const secret = base32Decode(adminTotpEnrollResponseSchema.parse(await started.json()).secret);
    const value = code(secret);
    const statuses = (
      await Promise.all([
        confirm(staff.headers, value),
        confirm(staff.headers, value),
        confirm(staff.headers, value),
      ])
    ).map((response) => response.status);
    expect(
      statuses.filter((status) => status === 204),
      statuses.join(),
    ).toHaveLength(1);
    for (const status of statuses.filter((value) => value !== 204)) {
      expect([401, 409]).toContain(status);
    }
    await expectProblem(await stepUp(staff.headers, value), 401, 'totp_invalid');
  });
});

describe('the shared 5-attempt budget', () => {
  it('holds under a concurrent burst of wrong codes across three endpoints', async () => {
    alignClock();
    const admin = await signedIn('admin');
    const secret = await enrolled(admin.id);
    await openWindow(admin.id);
    const victim = await createUser(auth);
    const wrong = wrongCode(secret);
    const burst = await Promise.all([
      ...Array.from({ length: 4 }, () => roleChange(admin.headers, victim.id, wrong)),
      ...Array.from({ length: 4 }, () => deactivation(admin.headers, victim.id, wrong)),
      ...Array.from({ length: 4 }, () => deletion(admin, admin.headers, wrong)),
    ]);
    const statuses = burst.map((response) => response.status);
    // Exactly five attempts were counted; everything else was refused by the budget.
    expect(
      statuses.filter((status) => status === 401),
      statuses.join(),
    ).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(7);
    // The valid code is refused too while the budget is spent, and is not consumed.
    const blocked = await stepUp(admin.headers, code(secret));
    await expectProblem(blocked, 429, 'rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await account(victim.id)).toMatchObject({ role: 'user', deactivatedAt: null });
    expect(await account(admin.id)).toMatchObject({ deactivatedAt: null, totpLastUsedStep: null });

    // Once Retry-After has elapsed the budget is back.
    auth.harness.advance(Number(blocked.headers.get('retry-after')) * 1_000 + 1_000);
    const later = await mobileSession(admin);
    expect((await stepUp(later, code(secret))).status).toBe(200);
  });

  it('is one budget per account across sessions, clients and source addresses', async () => {
    alignClock();
    const admin = await signedIn('admin');
    const secret = await enrolled(admin.id);
    await openWindow(admin.id);
    const victim = await createUser(auth);
    const wrong = wrongCode(secret);
    const second = await mobileSession(admin);
    const third = await mobileSession(admin);
    const browser = await webSession(admin);
    await openWindow(admin.id);
    await expectProblem(await stepUp(admin.headers, wrong), 401, 'totp_invalid');
    await expectProblem(await stepUp(second, wrong), 401, 'totp_invalid');
    await expectProblem(await roleChange(third, victim.id, wrong), 401, 'totp_invalid');
    await expectProblem(
      await deactivation(browser.withCsrf, victim.id, wrong),
      401,
      'totp_invalid',
    );
    await expectProblem(await deletion(admin, second, wrong), 401, 'step_up_required');
    // A brand-new session from a new address with the correct code: still refused.
    const fresh = await mobileSession(admin);
    await openWindow(admin.id);
    await expectProblem(await stepUp(fresh, code(secret)), 429, 'rate_limited');
    await expectProblem(await roleChange(fresh, victim.id, code(secret)), 429, 'rate_limited');
    expect(await account(victim.id)).toMatchObject({ role: 'user', deactivatedAt: null });
  });

  it('does not charge the budget for requests refused before the code check', async () => {
    alignClock();
    const moderator = await signedIn('moderator');
    const secret = await enrolled(moderator.id);
    const browser = await webSession(moderator);
    // CSRF failures stop at authentication.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expectProblem(await stepUp(browser.withoutCsrf, code(secret)), 403, 'csrf_failed');
    }
    // A moderator's role change is refused by the policy before the code is read.
    const victim = await createUser(auth);
    await openWindow(moderator.id);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expectProblem(
        await roleChange(moderator.headers, victim.id, wrongCode(secret)),
        403,
        'forbidden',
      );
    }
    expect((await account(moderator.id))?.totpLastUsedStep).toBeNull();
    expect((await stepUp(browser.withCsrf, code(secret))).status).toBe(200);
  });
});

describe('time-step window edges', () => {
  const cases: readonly { at: 'first' | 'last'; offset: number; accepted: boolean }[] = [
    { at: 'first', offset: -1, accepted: true },
    { at: 'first', offset: 1, accepted: true },
    { at: 'first', offset: -2, accepted: false },
    { at: 'first', offset: 2, accepted: false },
    { at: 'last', offset: -1, accepted: true },
    { at: 'last', offset: 1, accepted: true },
    { at: 'last', offset: -2, accepted: false },
    { at: 'last', offset: 2, accepted: false },
  ];

  it('accepts exactly one step either side on the first and last millisecond of a step', async () => {
    for (const entry of cases) {
      clockAtStepOffset(entry.at === 'first' ? 0 : STEP_MS - 1);
      const staff = await signedIn('moderator');
      const secret = await enrolled(staff.id);
      const response = await stepUp(staff.headers, code(secret, entry.offset));
      const label = `${entry.at} ms, offset ${entry.offset}`;
      if (entry.accepted) {
        expect(response.status, label).toBe(200);
      } else {
        await expectProblem(response, 401, 'totp_invalid');
        expect((await account(staff.id))?.totpLastUsedStep, label).toBeNull();
      }
    }
  });
});

describe('malformed codes', () => {
  const MALFORMED: readonly unknown[] = [
    '',
    '12345',
    '1234567',
    '12a456',
    ' 123456',
    '123456 ',
    '12345\n',
    '12 456',
    '+12345',
    '-12345',
    '1e5000',
    '0x1234',
    '١٢٣٤٥٦',
    '１２３４５６',
    '123456\u0000',
    123456,
    null,
    ['123456'],
    { code: '123456' },
  ];

  it('refuses every malformed code with 400 and spends neither budget nor step', async () => {
    alignClock();
    const admin = await signedIn('admin');
    const secret = await enrolled(admin.id);
    const victim = await createUser(auth);
    for (const value of MALFORMED) {
      await expectProblem(await stepUp(admin.headers, value), 400, 'validation_failed');
    }
    await openWindow(admin.id);
    for (const value of MALFORMED) {
      await expectProblem(
        await roleChange(admin.headers, victim.id, value),
        400,
        'validation_failed',
      );
      await expectProblem(
        await deactivation(admin.headers, victim.id, value),
        400,
        'validation_failed',
      );
    }
    expect(await account(admin.id)).toMatchObject({ totpLastUsedStep: null });
    expect(await account(victim.id)).toMatchObject({ role: 'user', deactivatedAt: null });
    // Well over five malformed attempts later, the valid code still opens the window.
    expect((await stepUp(admin.headers, code(secret))).status).toBe(200);
  });
});
