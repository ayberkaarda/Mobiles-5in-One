/**
 * Client-side input checks for the auth forms. They mirror the request schemas in
 * `packages/contracts` (limits, trimming, email rule); the server stays the authority and answers
 * `validation_failed` for anything these checks let through. A test compares every rule with the
 * contract schemas, so the two cannot drift silently.
 */
export const AUTH_LIMITS = {
  emailMax: 254,
  passwordMin: 10,
  passwordMax: 128,
  displayNameMin: 2,
  displayNameMax: 40,
  deviceLabelMax: 64,
  opaqueTokenMin: 43,
  opaqueTokenMax: 128,
} as const;

/** Keys of the `auth` namespace (`validation.*`); interpolation values come from `VALIDATION_PARAMS`. */
export type ValidationKey =
  | 'validation.emailRequired'
  | 'validation.emailInvalid'
  | 'validation.passwordRequired'
  | 'validation.passwordTooShort'
  | 'validation.passwordTooLong'
  | 'validation.displayNameTooShort'
  | 'validation.displayNameTooLong'
  | 'validation.displayNameInvalid';

/**
 * Same practical address rule as the contract's `z.email()`. The input is length-checked (254)
 * before the pattern runs, and the repeated group is delimited by literal dots, so it cannot
 * backtrack catastrophically.
 */
const EMAIL_PATTERN =
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded input, dot-delimited groups
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** Control, format and line/paragraph separator characters are not allowed in visible names. */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Trimmed and lower-cased, exactly as the API normalizes an email before it looks it up. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailIssue(raw: string): ValidationKey | null {
  const email = normalizeEmail(raw);
  if (email === '') {
    return 'validation.emailRequired';
  }
  if (email.length > AUTH_LIMITS.emailMax || !EMAIL_PATTERN.test(email)) {
    return 'validation.emailInvalid';
  }
  return null;
}

/** Registration and reset: length rules only (breach screening happens on the server). */
export function newPasswordIssue(password: string): ValidationKey | null {
  if (password.length === 0) {
    return 'validation.passwordRequired';
  }
  if (password.length < AUTH_LIMITS.passwordMin) {
    return 'validation.passwordTooShort';
  }
  if (password.length > AUTH_LIMITS.passwordMax) {
    return 'validation.passwordTooLong';
  }
  return null;
}

/**
 * Sign-in: only presence and the upper bound. A too-short password gets the same generic
 * `invalid_credentials` answer as a wrong one, so the form must not hint at the length rule.
 */
export function currentPasswordIssue(password: string): ValidationKey | null {
  if (password.length === 0) {
    return 'validation.passwordRequired';
  }
  if (password.length > AUTH_LIMITS.passwordMax) {
    return 'validation.passwordTooLong';
  }
  return null;
}

export function displayNameIssue(raw: string): ValidationKey | null {
  const name = raw.trim();
  if (name.length < AUTH_LIMITS.displayNameMin) {
    return 'validation.displayNameTooShort';
  }
  if (name.length > AUTH_LIMITS.displayNameMax) {
    return 'validation.displayNameTooLong';
  }
  if (HIDDEN_CHARACTERS.test(name)) {
    return 'validation.displayNameInvalid';
  }
  return null;
}

/** Shape check of an emailed token before it is sent; the server decides whether it is valid. */
export function isOpaqueToken(value: string): boolean {
  return (
    value.length >= AUTH_LIMITS.opaqueTokenMin &&
    value.length <= AUTH_LIMITS.opaqueTokenMax &&
    OPAQUE_TOKEN_PATTERN.test(value)
  );
}

/** Interpolation values shared by every `validation.*` message. */
export const VALIDATION_PARAMS = {
  min: AUTH_LIMITS.passwordMin,
  max: AUTH_LIMITS.passwordMax,
  nameMin: AUTH_LIMITS.displayNameMin,
  nameMax: AUTH_LIMITS.displayNameMax,
} as const;
