/** Source of cryptographically secure random bytes; `null` when the runtime has none. */
export type RandomBytes = (length: number) => Uint8Array | null;

interface WebCryptoLike {
  readonly getRandomValues?: <T extends Uint8Array>(array: T) => T;
}

/**
 * Secure randomness from the Web Crypto global when the runtime provides it. There is no
 * fallback to `Math.random`: a nonce that can be guessed defeats its purpose, so without a secure
 * source provider sign-in reports itself as unavailable (ADR-0049, open need for a crypto module).
 */
export const runtimeRandomBytes: RandomBytes = (length) => {
  const webCrypto = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (webCrypto?.getRandomValues === undefined) {
    return null;
  }
  return webCrypto.getRandomValues(new Uint8Array(length));
};

/** 256 bits as 64 lower-case hex characters: URL-safe and inside the contract's 16..128 range. */
export function createRawNonce(randomBytes: RandomBytes): string | null {
  const bytes = randomBytes(32);
  if (bytes === null || bytes.length !== 32) {
    return null;
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
