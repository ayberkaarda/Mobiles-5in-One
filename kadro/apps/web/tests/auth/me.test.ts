import { randomUUID } from 'node:crypto';

import { meResponseSchema } from '@kadro/contracts';
import { districts, newId, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as login } from '../../app/api/v1/auth/login/route';
import { GET as getMe, PATCH as patchMe } from '../../app/api/v1/me/route';
import { call, expectProblem } from '../support/http';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  setupAuthHarness,
  uniqueIp,
  userRow,
} from './support';

/**
 * `GET me` / `PATCH me` (matrix §3.2, field-level write rules §4.1, §9.3 "each server-only field
 * sent in a body → 400").
 */

let auth: AuthHarness;
let districtId: string;

beforeAll(async () => {
  auth = await setupAuthHarness('web_auth_me', { RATE_LIMIT_AUTH_MAX: '100' });
  const [district] = await auth.database.client.db
    .insert(districts)
    .values({
      il: 'İstanbul',
      ilce: 'Beşiktaş',
      ilSlug: 'istanbul',
      slug: 'besiktas',
      centroid: { lng: 29.0, lat: 41.04 },
    })
    .returning({ id: districts.id });
  districtId = district?.id ?? '';
});

afterAll(async () => {
  await auth.database.dispose();
});

async function signedIn(values: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(auth, values);
  const session = await mobileLogin(login, user.email, user.password);
  const headers = mobile(uniqueIp(), { authorization: `Bearer ${session.tokens.accessToken}` });
  return { user, headers };
}

function patch(headers: Record<string, string>, json: unknown): Promise<Response> {
  return call(patchMe, { method: 'PATCH', headers, json, path: '/api/v1/me' });
}

describe('GET me', () => {
  it('returns the own profile without secrets or provider subjects', async () => {
    const { user, headers } = await signedIn({ appleSub: 'apple-subject-me' });
    const response = await call(getMe, { headers, path: '/api/v1/me' });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const body = meResponseSchema.parse(JSON.parse(text));
    expect(body).toMatchObject({
      id: user.id,
      email: user.email,
      emailVerified: true,
      role: 'user',
      providers: { password: true, apple: true, google: false },
    });
    expect(text).not.toContain('argon2');
    expect(text).not.toContain('apple-subject-me');
    expect(text).not.toMatch(/passwordHash|totp|deactivated/i);
  });

  it('is 401 without credentials and for a deactivated account', async () => {
    await expectProblem(await call(getMe, { headers: mobile() }), 401, 'unauthenticated');
    const { user, headers } = await signedIn();
    await auth.database.client.db
      .update(users)
      .set({ deactivatedAt: new Date() })
      .where(eq(users.id, user.id));
    await expectProblem(await call(getMe, { headers }), 401, 'account_deactivated');
    await expectProblem(
      await patch(headers, { displayName: 'Engelli' }),
      401,
      'account_deactivated',
    );
  });
});

describe('PATCH me', () => {
  it('updates exactly the self-writable fields', async () => {
    const { user, headers } = await signedIn();
    const before = await userRow(auth, user.id);
    const response = await patch(headers, {
      displayName: '  Yeni İsim  ',
      position: 'MID',
      level: 'competitive',
      districtId,
    });
    expect(response.status).toBe(200);
    const body = meResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      displayName: 'Yeni İsim',
      position: 'MID',
      level: 'competitive',
      districtId,
    });
    const cleared = await patch(headers, { position: null, districtId: null });
    expect(cleared.status).toBe(200);
    const row = await userRow(auth, user.id);
    expect(row).toMatchObject({ position: null, districtId: null, displayName: 'Yeni İsim' });
    // Every column outside the allow-list is untouched.
    const untouched = (value: typeof row) => {
      const {
        displayName: _displayName,
        position: _position,
        level: _level,
        districtId: _districtId,
        updatedAt: _updatedAt,
        ...rest
      } = value ?? ({} as NonNullable<typeof row>);
      return rest;
    };
    expect(untouched(row)).toEqual(untouched(before));
  });

  it.each([
    ['role', 'admin'],
    ['email', 'baska@example.test'],
    ['emailVerified', true],
    ['emailVerifiedAt', '2026-01-01T00:00:00Z'],
    ['email_verified_at', '2026-01-01T00:00:00Z'],
    ['passwordHash', '$argon2id$x'],
    ['appleSub', 'attacker'],
    ['googleSub', 'attacker'],
    ['apple_sub', 'attacker'],
    ['deactivatedAt', null],
    ['deactivated_at', null],
    ['totpSecretEnc', 'x'],
    ['avatarKey', 'avatars/other/a.webp'],
    ['id', randomUUID()],
    ['createdAt', '2026-01-01T00:00:00Z'],
  ])('rejects the server-only field %s with 400 and changes nothing', async (field, value) => {
    const { user, headers } = await signedIn();
    const before = await userRow(auth, user.id);
    await expectProblem(
      await patch(headers, { displayName: 'Saldırgan', [field]: value }),
      400,
      'validation_failed',
    );
    expect(await userRow(auth, user.id)).toEqual(before);
  });

  it('rejects an empty body, invalid values and an unknown district', async () => {
    const { headers } = await signedIn();
    await expectProblem(await patch(headers, {}), 400, 'validation_failed');
    await expectProblem(await patch(headers, { displayName: 'x' }), 400, 'validation_failed');
    await expectProblem(await patch(headers, { position: 'STRIKER' }), 400, 'validation_failed');
    const unknown = await expectProblem(
      await patch(headers, { districtId: newId() }),
      400,
      'validation_failed',
    );
    expect(unknown.errors).toEqual([{ path: 'body.districtId', issue: 'not_found' }]);
  });

  it('keeps role changes impossible even for staff', async () => {
    const { user, headers } = await signedIn({ role: 'moderator' });
    await expectProblem(await patch(headers, { role: 'admin' }), 400, 'validation_failed');
    expect((await userRow(auth, user.id))?.role).toBe('moderator');
  });
});
