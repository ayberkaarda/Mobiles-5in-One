import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  deviceLabelSchema,
  displayNameSchema,
  emailSchema,
  newPasswordSchema,
  opaqueTokenSchema,
} from '../../../packages/contracts/src/common';
import { LIMITS } from '../../../packages/contracts/src/limits';
import { ApiError } from '../src/api/errors';
import { tokensFromAuthResponse } from '../src/auth/auth-api';
import { tokenFromLink } from '../src/auth/link-token';
import { createRawNonce, runtimeRandomBytes } from '../src/auth/nonce';
import { sha256Hex } from '../src/auth/sha256';
import {
  AUTH_LIMITS,
  currentPasswordIssue,
  displayNameIssue,
  emailIssue,
  isOpaqueToken,
  newPasswordIssue,
} from '../src/auth/validation';

const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';

describe('validation rules match the contract schemas', () => {
  it('uses the same limits', () => {
    expect(AUTH_LIMITS).toEqual({
      emailMax: LIMITS.email.max,
      passwordMin: LIMITS.password.min,
      passwordMax: LIMITS.password.max,
      displayNameMin: LIMITS.displayName.min,
      displayNameMax: LIMITS.displayName.max,
      deviceLabelMax: LIMITS.deviceLabel.max,
      opaqueTokenMin: LIMITS.opaqueToken.min,
      opaqueTokenMax: LIMITS.opaqueToken.max,
    });
  });

  const emails = [
    'ayse@example.com',
    '  Ayse.Yilmaz@Example.COM ',
    'a+tag@sub.example.co',
    'plain',
    'no@tld',
    'two@@example.com',
    '.dot@example.com',
    'dou..ble@example.com',
    'space in@example.com',
    '',
    '   ',
    `${'a'.repeat(250)}@example.com`,
    'türkçe@example.com',
    'x@exa_mple.com',
  ];
  it.each(emails)('email %j is accepted exactly when the contract accepts it', (input) => {
    expect(emailIssue(input) === null).toBe(emailSchema.safeParse(input).success);
  });

  const passwords = ['', 'short', '123456789', '1234567890', 'x'.repeat(128), 'x'.repeat(129)];
  it.each(passwords)('new password of length %#', (input) => {
    expect(newPasswordIssue(input) === null).toBe(newPasswordSchema.safeParse(input).success);
  });

  it('does not reveal the length rule when signing in', () => {
    expect(currentPasswordIssue('x')).toBeNull();
    expect(currentPasswordIssue('')).toBe('validation.passwordRequired');
    expect(currentPasswordIssue('x'.repeat(129))).toBe('validation.passwordTooLong');
  });

  const names = [
    '',
    'A',
    'Al',
    ' Al ',
    'x'.repeat(40),
    'x'.repeat(41),
    'bad\u0000name',
    `rtl${String.fromCodePoint(0x202e)}name`,
  ];
  it.each(names)('display name %j', (input) => {
    expect(displayNameIssue(input) === null).toBe(displayNameSchema.safeParse(input).success);
  });

  it('measures the device label bound like the contract', () => {
    expect(deviceLabelSchema.safeParse('x'.repeat(AUTH_LIMITS.deviceLabelMax)).success).toBe(true);
    expect(deviceLabelSchema.safeParse('x'.repeat(AUTH_LIMITS.deviceLabelMax + 1)).success).toBe(
      false,
    );
  });

  const tokens = [TOKEN, 'short', `${TOKEN}!`, 'a'.repeat(129), 'a'.repeat(128), 'a'.repeat(42)];
  it.each(tokens)('token %# shape', (input) => {
    expect(isOpaqueToken(input)).toBe(opaqueTokenSchema.safeParse(input).success);
  });
});

describe('sha256Hex', () => {
  it.each([
    '',
    'abc',
    'kadro',
    'ğüşiöç € 😀',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'x'.repeat(1000),
  ])('matches the platform digest for %#', (input) => {
    expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
  });

  it('matches the FIPS 180-4 test vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('nonce', () => {
  it('is 64 hex characters, inside the contract range, and differs per call', () => {
    const nodeBytes = (length: number) => new Uint8Array(nodeRandomBytes(length));
    const first = createRawNonce(nodeBytes);
    const second = createRawNonce(nodeBytes);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(first?.length).toBeGreaterThanOrEqual(LIMITS.nonce.min);
    expect(first?.length).toBeLessThanOrEqual(LIMITS.nonce.max);
  });

  it('is not produced without a secure random source', () => {
    expect(createRawNonce(() => null)).toBeNull();
    expect(createRawNonce(() => new Uint8Array(8))).toBeNull();
  });

  it('uses Web Crypto when the runtime has it and never falls back to Math.random', () => {
    expect(runtimeRandomBytes(32)?.length).toBe(32);
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(runtimeRandomBytes(32)).toBeNull();
    } finally {
      if (original !== undefined) {
        Object.defineProperty(globalThis, 'crypto', original);
      }
    }
  });
});

describe('tokenFromLink', () => {
  it('reads the fragment of an email link', () => {
    expect(tokenFromLink('sifre-sifirla', `https://kadro.app/sifre-sifirla#token=${TOKEN}`)).toBe(
      TOKEN,
    );
  });

  it('reads a query token from the app scheme and from router parameters', () => {
    expect(tokenFromLink('e-posta-dogrula', `kadro://e-posta-dogrula?token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromLink('e-posta-dogrula', null, TOKEN)).toBe(TOKEN);
    expect(tokenFromLink('e-posta-dogrula', null, [TOKEN, 'other'])).toBe(TOKEN);
  });

  it('prefers the fragment over a query value', () => {
    const other = 'Z'.repeat(43);
    expect(
      tokenFromLink(
        'sifre-sifirla',
        `https://kadro.app/sifre-sifirla?token=${other}#token=${TOKEN}`,
      ),
    ).toBe(TOKEN);
  });

  it('ignores a link for another path', () => {
    expect(
      tokenFromLink('sifre-sifirla', `https://kadro.app/e-posta-dogrula#token=${TOKEN}`),
    ).toBeNull();
    expect(tokenFromLink('sifre-sifirla', `kadro://e-posta-dogrula?token=${TOKEN}`)).toBeNull();
  });

  it('returns null for a missing or malformed token', () => {
    expect(tokenFromLink('sifre-sifirla', null)).toBeNull();
    expect(tokenFromLink('sifre-sifirla', 'https://kadro.app/sifre-sifirla')).toBeNull();
    expect(
      tokenFromLink('sifre-sifirla', 'https://kadro.app/sifre-sifirla#token=short'),
    ).toBeNull();
    expect(
      tokenFromLink('sifre-sifirla', 'https://kadro.app/sifre-sifirla#token=<script>'),
    ).toBeNull();
    expect(tokenFromLink('sifre-sifirla', null, 'bad token')).toBeNull();
  });
});

describe('tokensFromAuthResponse', () => {
  const valid = {
    user: {},
    tokens: {
      tokenType: 'Bearer',
      accessToken: 'a.b.c',
      accessTokenExpiresAt: '2026-10-02T10:00:00.000Z',
      refreshToken: TOKEN,
      refreshTokenExpiresAt: '2026-11-02T10:00:00.000Z',
    },
  };

  it('extracts the three values the session needs', () => {
    expect(tokensFromAuthResponse(valid)).toEqual({
      accessToken: 'a.b.c',
      accessTokenExpiresAt: '2026-10-02T10:00:00.000Z',
      refreshToken: TOKEN,
    });
  });

  it.each([
    undefined,
    null,
    {},
    { tokens: null },
    { tokens: { ...valid.tokens, tokenType: 'Basic' } },
    { tokens: { ...valid.tokens, accessToken: '' } },
    { tokens: { ...valid.tokens, refreshToken: 12 } },
    { tokens: { ...valid.tokens, accessTokenExpiresAt: undefined } },
  ])('rejects an unusable body %#', (body) => {
    expect(() => tokensFromAuthResponse(body)).toThrow(ApiError);
  });
});
