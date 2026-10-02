import { Platform } from 'react-native';

import { api, session } from '../api/instance';
import { createAuthApi } from './auth-api';
import { nativeApplePort } from './apple-native';
import { runtimeRandomBytes } from './nonce';
import { createProviderSignIn, type GoogleAuthPort } from './providers';

/**
 * Google sign-in is not wired: it needs the OAuth client ids of the Google Cloud project, which
 * are not part of the validated app configuration yet, and a real Google account to test with.
 * Until then the port reports itself unavailable and the button is not shown (ADR-0049).
 */
const googleUnavailable: GoogleAuthPort = {
  isAvailable: () => false,
  authorize: async () => null,
};

export const authApi = createAuthApi({
  api,
  session,
  deviceLabel: Platform.OS === 'ios' ? 'iOS app' : 'Android app',
});

export const providerSignIn = createProviderSignIn({
  apple: nativeApplePort,
  google: googleUnavailable,
  authApi,
  randomBytes: runtimeRandomBytes,
});
