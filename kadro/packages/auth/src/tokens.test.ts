import { createHash } from 'node:crypto';

import { opaqueTokenSchema } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import {
  constantTimeEqual,
  EMAIL_TOKEN_TTL_SECONDS,
  evaluateEmailToken,
  generateOpaqueToken,
  hashToken,
  issueEmailToken,
} from './tokens.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');

describe('generateOpaqueToken', () => {
  it('returns 256-bit base64url tokens accepted by the contracts schema', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(opaqueTokenSchema.safeParse(token).success).toBe(true);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, () => generateOpaqueToken()));
    expect(tokens.size).toBe(1_000);
  });
});

describe('hashToken', () => {
  it('is the lowercase hex SHA-256 the database check expects', () => {
    const token = 'A'.repeat(43);
    expect(hashToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('constantTimeEqual', () => {
  it('compares content, including values of different length', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('email tokens', () => {
  it('issues a token whose hash and expiry fill the email_tokens row', () => {
    const issued = issueEmailToken('verify', NOW);
    expect(issued.row).toEqual({
      purpose: 'verify',
      tokenHash: hashToken(issued.token),
      expiresAt: new Date(NOW.getTime() + EMAIL_TOKEN_TTL_SECONDS.verify * 1_000),
    });
  });

  it('gives reset tokens one hour', () => {
    expect(issueEmailToken('reset', NOW).row.expiresAt).toEqual(
      new Date(NOW.getTime() + 3_600_000),
    );
  });

  const valid = {
    purpose: 'reset' as const,
    expiresAt: new Date(NOW.getTime() + 60_000),
    usedAt: null,
  };

  it('accepts an unused, unexpired token of the right purpose', () => {
    expect(evaluateEmailToken(valid, 'reset', NOW)).toEqual({ ok: true });
  });

  it.each([
    ['no row', null],
    ['wrong purpose', { ...valid, purpose: 'verify' as const }],
    ['already used', { ...valid, usedAt: NOW }],
    ['expired', { ...valid, expiresAt: NOW }],
  ])('rejects %s with the same token_invalid', (_label, stored) => {
    expect(evaluateEmailToken(stored, 'reset', NOW)).toEqual({ ok: false, code: 'token_invalid' });
  });
});
