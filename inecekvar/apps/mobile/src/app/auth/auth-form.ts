import { ApiError, isApiError } from '@inecekvar/data-access';
import { TranslationKey } from '../i18n/translation';

/**
 * Client-side mirrors of the API bounds (`api/app/auth/schemas.py`, `passwords.py`,
 * `settings.py`). They give early, specific hints; the API stays the authority and its answer
 * wins (a breached password, for example, is only known to the server).
 */
export const EMAIL_MAX = 320;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
/** The login and verify schemas accept up to 1024 characters; the policy itself stops at 128. */
export const PASSWORD_INPUT_MAX = 1024;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailError = 'required' | 'invalid' | 'too-long';
export type PasswordIssue = 'required' | 'short' | 'long' | 'same-as-email';

export function normalizeEmail(value: string): string {
  return value.trim();
}

export function emailError(value: string): EmailError | null {
  const email = normalizeEmail(value);
  if (email === '') return 'required';
  if (email.length > EMAIL_MAX) return 'too-long';
  return EMAIL.test(email) ? null : 'invalid';
}

/** Characters as the server counts them (NFC code points). */
function length(value: string): number {
  return [...value.normalize('NFC')].length;
}

/** Sign-in only needs a non-empty password within the schema bound. */
export function loginPasswordIssue(password: string): PasswordIssue | null {
  if (password === '') return 'required';
  return length(password) > PASSWORD_INPUT_MAX ? 'long' : null;
}

/** The registration policy: 10 to 128 characters and not the address or its local part. */
export function passwordIssues(password: string, email: string): PasswordIssue[] {
  if (password === '') return ['required'];
  const issues: PasswordIssue[] = [];
  const n = length(password);
  if (n < PASSWORD_MIN) issues.push('short');
  if (n > PASSWORD_MAX) issues.push('long');
  const folded = password.normalize('NFC').toLowerCase();
  const address = normalizeEmail(email).toLowerCase();
  if (address !== '' && (folded === address || folded === address.split('@')[0])) {
    issues.push('same-as-email');
  }
  return issues;
}

export const EMAIL_ERRORS: Record<EmailError, TranslationKey> = {
  required: 'auth.errors.emailRequired',
  invalid: 'auth.errors.emailInvalid',
  'too-long': 'auth.errors.emailTooLong',
};

export const PASSWORD_ERRORS: Record<PasswordIssue, TranslationKey> = {
  required: 'auth.errors.passwordRequired',
  short: 'auth.errors.passwordShort',
  long: 'auth.errors.passwordLong',
  'same-as-email': 'auth.errors.passwordEmail',
};

export type AuthAction = 'login' | 'register' | 'link' | 'verify';

export interface AuthFailure {
  key: TranslationKey;
  /** Seconds to wait before the next try, for a 429. */
  retryAfter: number | null;
}

/**
 * Maps an API failure to copy. A failed sign-in never says whether the address exists or the
 * password was wrong; a rate limit gives a countdown; the weak-password answer lists the policy.
 */
export function authFailure(error: unknown, action: AuthAction): AuthFailure {
  if (!isApiError(error)) return { key: 'auth.errors.generic', retryAfter: null };
  const e: ApiError = error;
  if (e.status === 429) return { key: 'auth.errors.rateLimited', retryAfter: e.retryAfterSeconds };
  if (e.kind === 'network' || e.kind === 'timeout') {
    return { key: 'auth.errors.offline', retryAfter: null };
  }
  switch (e.code) {
    case 'auth.invalid_credentials':
      return {
        key: action === 'verify' ? 'auth.errors.verifyPassword' : 'auth.errors.credentials',
        retryAfter: null,
      };
    case 'auth.weak_password':
      return { key: 'auth.errors.weakPassword', retryAfter: null };
    case 'auth.token_invalid':
      return { key: 'auth.errors.tokenInvalid', retryAfter: null };
  }
  if (action === 'login') return { key: 'auth.errors.credentials', retryAfter: null };
  if (e.status === 422) return { key: 'auth.errors.validation', retryAfter: null };
  return { key: 'auth.errors.generic', retryAfter: null };
}

/**
 * Where to go after signing in. Only same-app paths are accepted (no scheme, no `//host`, no
 * backslash), so a crafted `?sonra=` cannot send anyone to another site.
 */
export function safeNext(value: string | null | undefined, fallback = '/katki'): string {
  if (!value || value.length > 300) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/^\/giris(\/|$|\?)/.test(value)) return fallback;
  return value;
}
