import { randomBytes } from 'node:crypto';

import { opaqueTokenSchema } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import { createCsrfService } from './csrf.js';

const SESSION = '9f0c8a52-3d4e-4b7a-9c1d-2e5f6a7b8c9d';
const OTHER_SESSION = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

/** Secret generated per run; never a fixed value in the repository. */
const csrf = createCsrfService({ CSRF_SECRET: randomBytes(32).toString('base64url') });

describe('csrf tokens', () => {
  it('issues opaque tokens accepted by the contracts schema', () => {
    const token = csrf.issue(SESSION);
    expect(token).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(opaqueTokenSchema.safeParse(token).success).toBe(true);
    expect(csrf.issue(SESSION)).not.toBe(token);
  });

  it('accepts a matching cookie/header pair bound to the session', () => {
    const token = csrf.issue(SESSION);
    expect(csrf.verify({ cookieToken: token, headerToken: token, sessionBinding: SESSION })).toBe(
      true,
    );
  });

  it('rejects a missing header or cookie', () => {
    const token = csrf.issue(SESSION);
    expect(
      csrf.verify({ cookieToken: token, headerToken: undefined, sessionBinding: SESSION }),
    ).toBe(false);
    expect(csrf.verify({ cookieToken: null, headerToken: token, sessionBinding: SESSION })).toBe(
      false,
    );
  });

  it('rejects a header that differs from the cookie', () => {
    expect(
      csrf.verify({
        cookieToken: csrf.issue(SESSION),
        headerToken: csrf.issue(SESSION),
        sessionBinding: SESSION,
      }),
    ).toBe(false);
  });

  it('rejects a token issued for another session', () => {
    const token = csrf.issue(OTHER_SESSION);
    expect(csrf.verify({ cookieToken: token, headerToken: token, sessionBinding: SESSION })).toBe(
      false,
    );
  });

  it('rejects a token signed with another secret', () => {
    const foreign = createCsrfService({ CSRF_SECRET: randomBytes(32).toString('base64url') });
    const token = foreign.issue(SESSION);
    expect(csrf.verify({ cookieToken: token, headerToken: token, sessionBinding: SESSION })).toBe(
      false,
    );
  });

  it('rejects an attacker-chosen unsigned pair (cookie injection)', () => {
    const planted = 'A'.repeat(86);
    expect(
      csrf.verify({ cookieToken: planted, headerToken: planted, sessionBinding: SESSION }),
    ).toBe(false);
  });

  it('rejects malformed tokens', () => {
    for (const value of ['', 'short', `${'A'.repeat(85)}.`, 'A'.repeat(87)]) {
      expect(csrf.verify({ cookieToken: value, headerToken: value, sessionBinding: SESSION })).toBe(
        false,
      );
    }
  });

  it('rejects a token with a flipped signature bit', () => {
    const raw = Buffer.from(csrf.issue(SESSION), 'base64url');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    const tampered = raw.toString('base64url');
    expect(
      csrf.verify({ cookieToken: tampered, headerToken: tampered, sessionBinding: SESSION }),
    ).toBe(false);
  });
});
