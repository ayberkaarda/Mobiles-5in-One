import { type AuthApi } from './auth-api';
import { createRawNonce, type RandomBytes } from './nonce';
import { sha256Hex } from './sha256';
import { displayNameIssue } from './validation';

/**
 * Ports to the platform sign-in sheets. The flow around them (nonce, token exchange with the API,
 * session) is plain code covered by unit tests with mock tokens; the native adapters behind the
 * ports need a real Apple / Google account on a device and are not exercised by the test suite.
 */
export interface AppleCredential {
  readonly identityToken: string;
  /** Full name as Apple returns it on the first authorization only. */
  readonly fullName: string | null;
}

export interface AppleAuthPort {
  isAvailable(): Promise<boolean>;
  /** `hashedNonce` is the SHA-256 hex of the raw nonce. Resolves to `null` when the user cancels. */
  authorize(hashedNonce: string): Promise<AppleCredential | null>;
}

export interface GoogleAuthPort {
  isAvailable(): boolean;
  /** `rawNonce` goes into the ID token request. Resolves to `null` when the user cancels. */
  authorize(rawNonce: string): Promise<{ readonly idToken: string } | null>;
}

/** `cancelled`: the user dismissed the sheet (no error); `unavailable`: cannot run on this device. */
export type ProviderOutcome = 'signedIn' | 'cancelled' | 'unavailable';

export interface ProviderSignIn {
  appleAvailable(): Promise<boolean>;
  googleAvailable(): boolean;
  signInWithApple(): Promise<ProviderOutcome>;
  signInWithGoogle(): Promise<ProviderOutcome>;
}

export interface ProviderSignInDeps {
  readonly apple: AppleAuthPort;
  readonly google: GoogleAuthPort;
  readonly authApi: Pick<AuthApi, 'signInWithApple' | 'signInWithGoogle'>;
  readonly randomBytes: RandomBytes;
}

export function createProviderSignIn({
  apple,
  google,
  authApi,
  randomBytes,
}: ProviderSignInDeps): ProviderSignIn {
  // Without a secure random source no nonce can be made, so neither provider is offered.
  const canMakeNonce = (): boolean => createRawNonce(randomBytes) !== null;

  return {
    async appleAvailable() {
      return canMakeNonce() && (await apple.isAvailable());
    },
    googleAvailable() {
      return canMakeNonce() && google.isAvailable();
    },

    async signInWithApple() {
      const nonce = createRawNonce(randomBytes);
      if (nonce === null || !(await apple.isAvailable())) {
        return 'unavailable';
      }
      const credential = await apple.authorize(sha256Hex(nonce));
      if (credential === null) {
        return 'cancelled';
      }
      const name = credential.fullName?.trim() ?? '';
      await authApi.signInWithApple({
        identityToken: credential.identityToken,
        nonce,
        // Only a usable name is sent; an invalid one must not make the sign-in fail.
        ...(name !== '' && displayNameIssue(name) === null ? { displayName: name } : {}),
      });
      return 'signedIn';
    },

    async signInWithGoogle() {
      const nonce = createRawNonce(randomBytes);
      if (nonce === null || !google.isAvailable()) {
        return 'unavailable';
      }
      const result = await google.authorize(nonce);
      if (result === null) {
        return 'cancelled';
      }
      await authApi.signInWithGoogle({ idToken: result.idToken, nonce });
      return 'signedIn';
    },
  };
}
