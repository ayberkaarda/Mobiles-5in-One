/**
 * Test fixtures generated at run time, so no test file carries id- or token-shaped constants.
 * Randomness here only needs to be unpredictable enough to exercise the schemas.
 */

const HEX = '0123456789abcdef';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function pick(alphabet: string, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

function uuid(version: '4' | '7', timeHex: string): string {
  const variant = pick('89ab', 1);
  return [
    timeHex.slice(0, 8),
    timeHex.slice(8, 12),
    `${version}${pick(HEX, 3)}`,
    `${variant}${pick(HEX, 3)}`,
    pick(HEX, 12),
  ].join('-');
}

/** A fresh UUIDv7 (time-ordered), the only id format the API accepts. */
export function uuidv7(): string {
  return uuid('7', Date.now().toString(16).padStart(12, '0'));
}

/** A fresh random UUIDv4, used to prove that non-v7 ids are rejected. */
export function uuidv4(): string {
  return uuid('4', pick(HEX, 12));
}

/** Random base64url text of the given length. */
export function base64url(length: number): string {
  return pick(BASE64URL, length);
}

/** An ISO 8601 timestamp with offset, `offsetMs` from now. */
export function isoAt(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function accepts(
  schema: { safeParse: (value: unknown) => { success: boolean } },
  value: unknown,
): boolean {
  return schema.safeParse(value).success;
}
