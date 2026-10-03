import { randomBytes, randomUUID } from 'node:crypto';

import { adminTotpEnrollResponseSchema, totpSecretSchema } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import {
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  hotp,
  matchTotpStep,
  otpauthUri,
  timeStep,
  TotpCiphertextError,
  totpAt,
  totpKey,
} from '../../lib/server/admin/totp';

/**
 * TOTP primitives (RFC 4226 / RFC 6238, ADR-0066): published test vectors, the ±1 step window,
 * replay refusal, base32 and the AES-256-GCM storage format.
 */

/** The RFC 4226 / RFC 6238 SHA-1 test seed, the ASCII digits 1-9, 0 twice. */
const RFC_SEED = Buffer.from('1234567890'.repeat(2), 'ascii');

describe('HOTP (RFC 4226 appendix D)', () => {
  it('matches the published six-digit values for counters 0-9', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expected.forEach((value, counter) => {
      expect(hotp(RFC_SEED, counter)).toBe(value);
    });
  });

  it('rejects negative or unsafe counters', () => {
    expect(() => hotp(RFC_SEED, -1)).toThrow(RangeError);
    expect(() => hotp(RFC_SEED, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('TOTP (RFC 6238 appendix B, SHA-1, last six digits)', () => {
  const vectors: [number, string][] = [
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
    [20_000_000_000, '353130'],
  ];
  for (const [seconds, code] of vectors) {
    it(`T = ${seconds}s → ${code}`, () => {
      expect(totpAt(RFC_SEED, new Date(seconds * 1_000))).toBe(code);
    });
  }
});

describe('matchTotpStep', () => {
  const now = new Date(1_234_567_890_000);
  const current = timeStep(now);

  it('accepts the current step and one step either side', () => {
    expect(matchTotpStep(RFC_SEED, hotp(RFC_SEED, current), now, null)).toBe(current);
    expect(matchTotpStep(RFC_SEED, hotp(RFC_SEED, current - 1), now, null)).toBe(current - 1);
    expect(matchTotpStep(RFC_SEED, hotp(RFC_SEED, current + 1), now, null)).toBe(current + 1);
  });

  it('refuses codes two steps away and wrong codes', () => {
    expect(matchTotpStep(RFC_SEED, hotp(RFC_SEED, current - 2), now, null)).toBeNull();
    expect(matchTotpStep(RFC_SEED, hotp(RFC_SEED, current + 2), now, null)).toBeNull();
    const wrong = String((Number(hotp(RFC_SEED, current)) + 1) % 1_000_000).padStart(6, '0');
    expect(matchTotpStep(RFC_SEED, wrong, now, null)).toBeNull();
    expect(matchTotpStep(RFC_SEED, '12345', now, null)).toBeNull();
  });

  it('refuses a step at or below the last accepted one (replay)', () => {
    const code = hotp(RFC_SEED, current);
    expect(matchTotpStep(RFC_SEED, code, now, current)).toBeNull();
    expect(matchTotpStep(RFC_SEED, code, now, current + 1)).toBeNull();
    expect(matchTotpStep(RFC_SEED, code, now, current - 1)).toBe(current);
    expect(matchTotpStep(RFC_SEED, hotp(RFC_SEED, current - 1), now, current - 1)).toBeNull();
  });
});

describe('base32 and otpauth URI', () => {
  it('encodes RFC 4648 test vectors without padding', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [input, output] of cases) {
      expect(base32Encode(Buffer.from(input, 'ascii'))).toBe(output);
    }
  });

  it('produces a 160-bit secret that satisfies the contract', () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(20);
    expect(totpSecretSchema.safeParse(base32Encode(secret)).success).toBe(true);
  });

  it('builds a URI with the fixed parameters that the response schema accepts', () => {
    const base32 = base32Encode(generateTotpSecret());
    const uri = otpauthUri(base32, 'yonetici@example.test');
    expect(uri.startsWith('otpauth://totp/Kadro:yonetici%40example.test?')).toBe(true);
    const params = new URL(uri).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      secret: base32,
      issuer: 'Kadro',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
    const parsed = adminTotpEnrollResponseSchema.safeParse({
      secret: base32,
      otpauthUri: otpauthUri(base32, `${'a'.repeat(240)}@example.test`),
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      confirmBy: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('secret encryption at rest', () => {
  const key = randomBytes(32);
  const userId = randomUUID();

  it('round-trips and never contains the secret in clear', () => {
    const secret = generateTotpSecret();
    const stored = encryptTotpSecret(key, userId, secret);
    expect(stored).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(stored).not.toContain(base32Encode(secret));
    expect(stored).not.toContain(secret.toString('base64url'));
    expect(decryptTotpSecret(key, userId, stored).equals(secret)).toBe(true);
    // A fresh IV per encryption.
    expect(encryptTotpSecret(key, userId, secret)).not.toBe(stored);
  });

  it('fails for another key, another user or a tampered value', () => {
    const stored = encryptTotpSecret(key, userId, generateTotpSecret());
    expect(() => decryptTotpSecret(randomBytes(32), userId, stored)).toThrow(TotpCiphertextError);
    expect(() => decryptTotpSecret(key, randomUUID(), stored)).toThrow(TotpCiphertextError);
    const parts = stored.split('.');
    const body = Buffer.from(parts[2] ?? '', 'base64url');
    body[0] = (body[0] ?? 0) ^ 1;
    const tampered = [parts[0], parts[1], body.toString('base64url'), parts[3]].join('.');
    expect(() => decryptTotpSecret(key, userId, tampered)).toThrow(TotpCiphertextError);
    expect(() => decryptTotpSecret(key, userId, 'plain')).toThrow(TotpCiphertextError);
    expect(() => decryptTotpSecret(key, userId, stored.replace(/^v1/, 'v2'))).toThrow(
      TotpCiphertextError,
    );
  });

  it('reads the configured key and treats an empty one as disabled', () => {
    expect(totpKey(undefined)).toBeNull();
    expect(totpKey('')).toBeNull();
    expect(totpKey(key.toString('base64url'))?.equals(key)).toBe(true);
    expect(() => totpKey(randomBytes(16).toString('base64url'))).toThrow(RangeError);
  });
});
