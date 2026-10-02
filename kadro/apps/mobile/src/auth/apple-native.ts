import * as AppleAuthentication from 'expo-apple-authentication';

import { type AppleAuthPort } from './providers';

/** Cancelling the Apple sheet rejects with this code; it is not a failure. */
const CANCELLED = 'ERR_REQUEST_CANCELED';

function fullNameOf(name: AppleAuthentication.AppleAuthenticationFullName | null): string | null {
  const parts = [name?.givenName, name?.familyName].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
  return parts.length === 0 ? null : parts.join(' ');
}

/**
 * Sign in with Apple through the system sheet. Needs a real Apple ID on an iOS device or a
 * simulator signed in to iCloud; the unit tests replace this port with a mock.
 */
export const nativeApplePort: AppleAuthPort = {
  isAvailable: () => AppleAuthentication.isAvailableAsync(),
  async authorize(hashedNonce) {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (credential.identityToken === null) {
        throw new Error('Apple returned no identity token');
      }
      return { identityToken: credential.identityToken, fullName: fullNameOf(credential.fullName) };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === CANCELLED
      ) {
        return null;
      }
      throw error;
    }
  },
};
