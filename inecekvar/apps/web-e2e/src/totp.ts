import { createHmac } from 'node:crypto';

/** RFC 4648 base32 without padding, as `pyotp.random_base32` produces. */
export function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for one counter value. */
export function totpAt(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/**
 * Codes for one account. The API accepts one step either side and refuses a counter at or
 * below the last one used, so each call returns the next unused counter that is still inside
 * the window.
 */
export class TotpDevice {
  private last = -1;

  constructor(private readonly secret: string) {}

  next(now = Date.now()): string {
    const current = Math.floor(now / 30_000);
    const counter = Math.max(current, this.last + 1);
    if (counter > current + 1) throw new Error('no TOTP step left in the window; wait 30 s');
    this.last = counter;
    return totpAt(this.secret, counter);
  }
}
