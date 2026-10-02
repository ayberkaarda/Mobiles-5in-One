import { describe, expect, it } from 'vitest';

import {
  evaluateRefresh,
  issueRefreshToken,
  refreshTtlSeconds,
  sessionExtension,
  type IssuedRefreshToken,
  type RefreshVerdict,
  type StoredRefreshToken,
} from './refresh.js';
import { hashToken } from './tokens.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const USER_ID = '0199a000-0000-7000-8000-000000000001';
const DAY = 86_400;

function stored(overrides: Partial<StoredRefreshToken> = {}): StoredRefreshToken {
  return {
    id: '0199a000-0000-7000-8000-0000000000f1',
    userId: USER_ID,
    client: 'mobile',
    familyId: '9f0c8a52-3d4e-4b7a-9c1d-2e5f6a7b8c9d',
    deviceLabel: 'Pixel',
    expiresAt: new Date(NOW.getTime() + DAY * 1_000),
    revokedAt: null,
    stepUpUntil: null,
    ...overrides,
  };
}

describe('refreshTtlSeconds', () => {
  it('uses the refresh lifetime for mobile and the session lifetime for web', () => {
    const env = { REFRESH_TOKEN_TTL_SECONDS: 30 * DAY, SESSION_TTL_SECONDS: 7 * DAY };
    expect(refreshTtlSeconds(env, 'mobile')).toBe(30 * DAY);
    expect(refreshTtlSeconds(env, 'web')).toBe(7 * DAY);
  });
});

describe('issueRefreshToken', () => {
  it('starts a new family with a hashed token', () => {
    const issued = issueRefreshToken({
      userId: USER_ID,
      client: 'mobile',
      ttlSeconds: 30 * DAY,
      deviceLabel: 'iPhone',
      now: NOW,
    });
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.row).toEqual({
      tokenHash: hashToken(issued.token),
      userId: USER_ID,
      client: 'mobile',
      familyId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown as string,
      deviceLabel: 'iPhone',
      expiresAt: new Date(NOW.getTime() + 30 * DAY * 1_000),
      rotatedFrom: null,
      stepUpUntil: null,
    });
  });

  it('gives every login its own family', () => {
    const input = { userId: USER_ID, client: 'web' as const, ttlSeconds: DAY, now: NOW };
    expect(issueRefreshToken(input).row.familyId).not.toBe(issueRefreshToken(input).row.familyId);
  });
});

describe('evaluateRefresh', () => {
  const input = { client: 'mobile' as const, ttlSeconds: 30 * DAY, now: NOW };

  it('rotates a valid token inside the same family and keeps the step-up binding', () => {
    const stepUpUntil = new Date(NOW.getTime() + 600_000);
    const verdict = evaluateRefresh(stored({ stepUpUntil }), input);
    expect(verdict.kind).toBe('rotate');
    if (verdict.kind !== 'rotate') {
      return;
    }
    expect(verdict.revokeTokenId).toBe(stored().id);
    expect(verdict.next.row).toEqual({
      tokenHash: hashToken(verdict.next.token),
      userId: USER_ID,
      client: 'mobile',
      familyId: stored().familyId,
      deviceLabel: 'Pixel',
      expiresAt: new Date(NOW.getTime() + 30 * DAY * 1_000),
      rotatedFrom: stored().id,
      stepUpUntil,
    });
  });

  it('detects reuse of a rotated (revoked) token and names the family to revoke', () => {
    expect(evaluateRefresh(stored({ revokedAt: NOW }), input)).toEqual({
      kind: 'reuse',
      userId: USER_ID,
      familyId: stored().familyId,
      code: 'unauthenticated',
    });
  });

  it('treats reuse as reuse even after expiry', () => {
    const verdict = evaluateRefresh(stored({ revokedAt: NOW, expiresAt: NOW }), input);
    expect(verdict.kind).toBe('reuse');
  });

  it('rejects an unknown token', () => {
    expect(evaluateRefresh(null, input)).toEqual({
      kind: 'reject',
      reason: 'unknown',
      code: 'unauthenticated',
    });
  });

  it('rejects an expired token without revoking the family', () => {
    expect(evaluateRefresh(stored({ expiresAt: NOW }), input)).toEqual({
      kind: 'reject',
      reason: 'expired',
      code: 'unauthenticated',
    });
  });

  it('rejects a token presented over the other client transport', () => {
    expect(evaluateRefresh(stored({ client: 'web' }), input)).toEqual({
      kind: 'reject',
      reason: 'wrong_client',
      code: 'unauthenticated',
    });
  });

  it('checks the transport before reuse: a revoked token over the wrong client never revokes the family', () => {
    expect(evaluateRefresh(stored({ client: 'web', revokedAt: NOW }), input)).toEqual({
      kind: 'reject',
      reason: 'wrong_client',
      code: 'unauthenticated',
    });
  });
});

/**
 * In-memory `refresh_tokens` table driven only by `evaluateRefresh` verdicts, following the
 * rotation protocol documented in refresh.ts (conditional revoke, family revoke on reuse).
 */
class TokenTable {
  private readonly rows = new Map<string, StoredRefreshToken & { tokenHash: string }>();
  private sequence = 0;

  insert(issued: IssuedRefreshToken): string {
    this.sequence += 1;
    const id = `row-${String(this.sequence)}`;
    this.rows.set(id, {
      id,
      tokenHash: issued.row.tokenHash,
      userId: issued.row.userId,
      client: issued.row.client,
      familyId: issued.row.familyId,
      deviceLabel: issued.row.deviceLabel,
      expiresAt: issued.row.expiresAt,
      revokedAt: null,
      stepUpUntil: issued.row.stepUpUntil,
    });
    return id;
  }

  find(token: string): StoredRefreshToken | null {
    const tokenHash = hashToken(token);
    for (const row of this.rows.values()) {
      if (row.tokenHash === tokenHash) {
        return { ...row };
      }
    }
    return null;
  }

  /** Applies a verdict; returns the new token on a successful rotation. */
  apply(verdict: RefreshVerdict, now: Date): string | null {
    if (verdict.kind === 'reject') {
      return null;
    }
    if (verdict.kind === 'rotate') {
      const current = this.rows.get(verdict.revokeTokenId);
      if (current !== undefined && current.revokedAt === null) {
        current.revokedAt = now;
        this.insert(verdict.next);
        return verdict.next.token;
      }
      // Zero rows updated: a concurrent use of the same token, handled as reuse.
      this.revokeFamily(verdict.familyId, now);
      return null;
    }
    this.revokeFamily(verdict.familyId, now);
    return null;
  }

  activeInFamily(familyId: string): number {
    return [...this.rows.values()].filter(
      (row) => row.familyId === familyId && row.revokedAt === null,
    ).length;
  }

  private revokeFamily(familyId: string, now: Date): void {
    for (const row of this.rows.values()) {
      if (row.familyId === familyId && row.revokedAt === null) {
        row.revokedAt = now;
      }
    }
  }
}

describe('rotation protocol driven by evaluateRefresh', () => {
  const ttlSeconds = 30 * DAY;
  const input = { client: 'mobile' as const, ttlSeconds, now: NOW };

  function login(table: TokenTable) {
    const issued = issueRefreshToken({ userId: USER_ID, client: 'mobile', ttlSeconds, now: NOW });
    table.insert(issued);
    return issued;
  }

  it('theft: attacker rotates first, victim replays the old token, the whole family dies', () => {
    const table = new TokenTable();
    const victim = login(table);
    const otherDevice = login(table);

    const attackerVerdict = evaluateRefresh(table.find(victim.token), input);
    expect(attackerVerdict.kind).toBe('rotate');
    const attackerToken = table.apply(attackerVerdict, NOW);
    expect(attackerToken).not.toBeNull();

    const replay = evaluateRefresh(table.find(victim.token), input);
    expect(replay).toEqual({
      kind: 'reuse',
      userId: USER_ID,
      familyId: victim.row.familyId,
      code: 'unauthenticated',
    });
    table.apply(replay, NOW);
    expect(table.activeInFamily(victim.row.familyId)).toBe(0);

    // The attacker's fresh token is now revoked as well and cannot be rotated again.
    const attackerNext = evaluateRefresh(table.find(attackerToken ?? ''), input);
    expect(attackerNext.kind).toBe('reuse');
    expect(table.apply(attackerNext, NOW)).toBeNull();

    // Other logins of the same user are untouched.
    expect(table.activeInFamily(otherDevice.row.familyId)).toBe(1);
  });

  it('concurrent use of one token: the second rotation loses and revokes the family', () => {
    const table = new TokenTable();
    const session = login(table);
    const first = evaluateRefresh(table.find(session.token), input);
    const second = evaluateRefresh(table.find(session.token), input);
    expect(first.kind).toBe('rotate');
    expect(second.kind).toBe('rotate');

    const winner = table.apply(first, NOW);
    expect(winner).not.toBeNull();
    expect(table.apply(second, NOW)).toBeNull();
    expect(table.activeInFamily(session.row.familyId)).toBe(0);
    expect(evaluateRefresh(table.find(winner ?? ''), input).kind).toBe('reuse');
  });

  it('a normal rotation chain keeps exactly one active token', () => {
    const table = new TokenTable();
    let token = login(table).token;
    for (let step = 0; step < 3; step += 1) {
      const next = table.apply(evaluateRefresh(table.find(token), input), NOW);
      expect(next).not.toBeNull();
      token = next ?? '';
    }
    const familyId = table.find(token)?.familyId ?? '';
    expect(table.activeInFamily(familyId)).toBe(1);
  });
});

describe('sessionExtension', () => {
  const ttl = 7 * DAY;

  it('extends a session last extended more than an hour ago', () => {
    const expiresAt = new Date(NOW.getTime() + (ttl - 3_600) * 1_000);
    expect(sessionExtension(expiresAt, ttl, NOW)).toEqual(new Date(NOW.getTime() + ttl * 1_000));
  });

  it('does not extend within the hour', () => {
    const expiresAt = new Date(NOW.getTime() + (ttl - 3_599) * 1_000);
    expect(sessionExtension(expiresAt, ttl, NOW)).toBeNull();
  });

  it('never revives an expired session', () => {
    expect(sessionExtension(NOW, ttl, NOW)).toBeNull();
  });
});
