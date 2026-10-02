/**
 * Test double of `expo-apple-authentication`. Tests script the sheet's outcome; the mock tokens
 * are made up and no Apple account or network is involved.
 */
export const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 } as const;

export interface AppleSignInCall {
  readonly nonce: string | undefined;
  readonly scopes: readonly number[] | undefined;
}

type Outcome =
  | { kind: 'credential'; identityToken: string | null; givenName?: string; familyName?: string }
  | { kind: 'cancel' }
  | { kind: 'fail' };

let available = true;
let outcome: Outcome = { kind: 'cancel' };
let calls: AppleSignInCall[] = [];
let gate: Promise<void> | null = null;

export async function isAvailableAsync(): Promise<boolean> {
  return available;
}

export async function signInAsync(options?: {
  nonce?: string;
  requestedScopes?: number[];
}): Promise<{
  identityToken: string | null;
  fullName: { givenName: string | null; familyName: string | null } | null;
}> {
  calls.push({ nonce: options?.nonce, scopes: options?.requestedScopes });
  if (gate !== null) {
    await gate;
  }
  if (outcome.kind === 'cancel') {
    throw Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' });
  }
  if (outcome.kind === 'fail') {
    throw Object.assign(new Error('failed'), { code: 'ERR_REQUEST_FAILED' });
  }
  const hasName = outcome.givenName !== undefined || outcome.familyName !== undefined;
  return {
    identityToken: outcome.identityToken,
    fullName: hasName
      ? { givenName: outcome.givenName ?? null, familyName: outcome.familyName ?? null }
      : null,
  };
}

export function __scriptApple(next: {
  available?: boolean;
  outcome?: Outcome;
  /** The sheet stays open until this promise settles. */
  gate?: Promise<void>;
}): void {
  gate = next.gate ?? gate;
  available = next.available ?? available;
  outcome = next.outcome ?? outcome;
}

export function appleSignInCalls(): readonly AppleSignInCall[] {
  return calls;
}

export function resetAppleDouble(): void {
  available = true;
  outcome = { kind: 'cancel' };
  calls = [];
  gate = null;
}
