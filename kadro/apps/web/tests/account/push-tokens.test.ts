import { auditLogs, pushTokens } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_PUSH_TOKENS_PER_USER } from '../../lib/server/account/push-tokens';
import { expectProblem } from '../support/http';
import { account, DAY_MS, webAccount } from '../teams/support';
import {
  expoToken,
  setupUploadsHarness,
  type UploadsHarness,
  uploadsApi as api,
} from '../uploads/support';

/**
 * `POST me/push-tokens` (matrix §3.2, ADR-0031): Expo format only, owner from the session, a token
 * bound to another user moves to the caller, at most ten devices per user, group P.
 */

let t: UploadsHarness;

beforeAll(async () => {
  t = await setupUploadsHarness('web_push_tokens');
});

afterAll(async () => {
  await t.dispose();
});

async function tokensOf(userId: string) {
  return t.db
    .select({
      expoToken: pushTokens.expoToken,
      platform: pushTokens.platform,
      lastSeenAt: pushTokens.lastSeenAt,
    })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));
}

async function ownerOf(token: string): Promise<string | undefined> {
  const [row] = await t.db
    .select({ userId: pushTokens.userId })
    .from(pushTokens)
    .where(eq(pushTokens.expoToken, token));
  return row?.userId;
}

describe('POST me/push-tokens', () => {
  it('stores both Expo token forms for the caller and answers 204 without a body', async () => {
    t.harness.setNow(new Date());
    const user = await account(t);
    const first = expoToken();
    const second = expoToken('ExpoPushToken');
    const response = await api.registerPushToken(user.headers, {
      expoToken: first,
      platform: 'ios',
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(
      (await api.registerPushToken(user.headers, { expoToken: second, platform: 'android' }))
        .status,
    ).toBe(204);
    const stored = await tokensOf(user.id);
    expect(stored.map((row) => row.expoToken).sort()).toEqual([first, second].sort());
    const audit = await t.db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, 'pushToken.register')));
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(first);
  });

  it('works for web sessions as well', async () => {
    const user = await webAccount(t);
    const token = expoToken();
    expect(
      (await api.registerPushToken(user.headers, { expoToken: token, platform: 'ios' })).status,
    ).toBe(204);
    expect(await ownerOf(token)).toBe(user.id);
  });

  it('refuses malformed tokens and client-chosen owners (400, nothing stored)', async () => {
    const user = await account(t);
    const victim = await account(t);
    const bodies: unknown[] = [
      { expoToken: 'abc', platform: 'ios' },
      { expoToken: 'ExponentPushToken[]', platform: 'ios' },
      { expoToken: 'ExponentPushToken[a b]', platform: 'ios' },
      { expoToken: 'ExponentPushToken[abc', platform: 'ios' },
      { expoToken: `ExponentPushToken[${'a'.repeat(250)}]`, platform: 'ios' },
      { expoToken: 'fcm:abcdefghijklmnop', platform: 'android' },
      { expoToken: expoToken(), platform: 'web' },
      { expoToken: expoToken(), platform: 'ios', userId: victim.id },
      { expoToken: expoToken() },
    ];
    for (const body of bodies) {
      await expectProblem(
        await api.registerPushToken(user.headers, body),
        400,
        'validation_failed',
      );
    }
    expect(await tokensOf(user.id)).toEqual([]);
    expect(await tokensOf(victim.id)).toEqual([]);
  });

  it('refreshes last_seen_at and platform when the same device registers again', async () => {
    t.harness.setNow(new Date());
    const user = await account(t);
    const token = expoToken();
    await api.registerPushToken(user.headers, { expoToken: token, platform: 'ios' });
    t.harness.advance(60_000);
    const later = t.harness.runtime.now();
    expect(
      (await api.registerPushToken(user.headers, { expoToken: token, platform: 'android' })).status,
    ).toBe(204);
    const stored = await tokensOf(user.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.platform).toBe('android');
    expect(stored[0]?.lastSeenAt.getTime()).toBe(later.getTime());
    t.harness.setNow(new Date());
  });

  it('moves a token bound to another user to the caller (the old binding is gone)', async () => {
    const previousOwner = await account(t);
    const newOwner = await account(t);
    const token = expoToken();
    await api.registerPushToken(previousOwner.headers, { expoToken: token, platform: 'ios' });
    expect(await ownerOf(token)).toBe(previousOwner.id);

    expect(
      (await api.registerPushToken(newOwner.headers, { expoToken: token, platform: 'ios' })).status,
    ).toBe(204);
    expect(await ownerOf(token)).toBe(newOwner.id);
    expect(await tokensOf(previousOwner.id)).toEqual([]);
    const rows = await t.db.select().from(pushTokens).where(eq(pushTokens.expoToken, token));
    expect(rows).toHaveLength(1);
    const [audit] = await t.db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, newOwner.id), eq(auditLogs.action, 'pushToken.register')));
    expect(audit?.metadata).toMatchObject({ rebound: true, platform: 'ios' });
  });

  it(`keeps at most ${MAX_PUSH_TOKENS_PER_USER} devices, dropping the least recently seen`, async () => {
    const user = await account(t);
    const now = t.harness.runtime.now().getTime();
    const existing = Array.from({ length: MAX_PUSH_TOKENS_PER_USER }, () => expoToken());
    await t.db.insert(pushTokens).values(
      existing.map((token, index) => ({
        userId: user.id,
        expoToken: token,
        platform: 'ios' as const,
        lastSeenAt: new Date(now - (index + 1) * DAY_MS),
      })),
    );
    const fresh = expoToken();
    expect(
      (await api.registerPushToken(user.headers, { expoToken: fresh, platform: 'android' })).status,
    ).toBe(204);
    const stored = (await tokensOf(user.id)).map((row) => row.expoToken);
    expect(stored).toHaveLength(MAX_PUSH_TOKENS_PER_USER);
    expect(stored).toContain(fresh);
    expect(stored).not.toContain(existing[MAX_PUSH_TOKENS_PER_USER - 1]);
  });

  it('limits registrations to 10 per user per day (group P)', async () => {
    const user = await account(t);
    for (let index = 0; index < 10; index += 1) {
      const response = await api.registerPushToken(user.headers, {
        expoToken: expoToken(),
        platform: 'ios',
      });
      expect(response.status).toBe(204);
    }
    const refused = await api.registerPushToken(user.headers, {
      expoToken: expoToken(),
      platform: 'ios',
    });
    await expectProblem(refused, 429, 'rate_limited');
  });

  it('answers 401 to anonymous callers and never logs the token', async () => {
    const token = expoToken();
    await expectProblem(
      await api.registerPushToken(
        { 'x-kadro-client': 'mobile' },
        { expoToken: token, platform: 'ios' },
      ),
      401,
      'unauthenticated',
    );
    const user = await account(t);
    await api.registerPushToken(user.headers, { expoToken: token, platform: 'ios' });
    const logs = t.harness.logLines.join('\n');
    expect(logs).toContain('/api/v1/me/push-tokens');
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(token.slice('ExponentPushToken['.length, -1));
  });
});
