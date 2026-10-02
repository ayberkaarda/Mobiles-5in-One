import { type ApiClient } from '../api/client';
import { type MobileAuthResponse } from '../api/contracts';
import { ApiError } from '../api/errors';
import { type Session, type SessionTokens } from '../auth-store/session';
import { normalizeEmail } from './validation';

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface AppleSignInInput {
  readonly identityToken: string;
  /** The raw nonce; its SHA-256 went to Apple (the server compares it with the token's claim). */
  readonly nonce: string;
  /** Apple sends the name only on the first authorization; used when the account is created. */
  readonly displayName?: string;
}

export interface GoogleSignInInput {
  readonly idToken: string;
  readonly nonce?: string;
}

/** Calls of the unauthenticated `/auth/*` endpoints (ADR-0014, ADR-0015). */
export interface AuthApi {
  /** Always accepted, whether or not the email exists; no session is issued (ADR-0015). */
  register(input: RegisterInput): Promise<void>;
  /** Signs in and stores the issued tokens in the session. */
  login(input: LoginInput): Promise<void>;
  /** Always accepted; the answer never reveals whether an account exists. */
  forgotPassword(email: string): Promise<void>;
  /** Success revokes every session of the user on the server, this device included. */
  resetPassword(input: { token: string; password: string }): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  signInWithApple(input: AppleSignInInput): Promise<void>;
  signInWithGoogle(input: GoogleSignInInput): Promise<void>;
}

export interface AuthApiDeps {
  readonly api: Pick<ApiClient, 'request'>;
  readonly session: Pick<Session, 'establish'>;
  /** Optional label stored with the refresh token, e.g. "iOS app". */
  readonly deviceLabel?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * Reads the token pair out of a sign-in response. A success status with a body that has no usable
 * tokens is an `invalid_response`, never a half-signed-in state.
 */
export function tokensFromAuthResponse(body: unknown): SessionTokens {
  const tokens = isRecord(body) ? body.tokens : undefined;
  if (
    !isRecord(tokens) ||
    tokens.tokenType !== 'Bearer' ||
    !nonEmptyString(tokens.accessToken) ||
    !nonEmptyString(tokens.accessTokenExpiresAt) ||
    !nonEmptyString(tokens.refreshToken)
  ) {
    throw new ApiError({ kind: 'invalid_response', status: 200 });
  }
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    refreshToken: tokens.refreshToken,
  };
}

export function createAuthApi({ api, session, deviceLabel }: AuthApiDeps): AuthApi {
  const label = deviceLabel === undefined ? {} : { deviceLabel };

  async function signIn(path: string, body: Record<string, unknown>): Promise<void> {
    const response = await api.request<MobileAuthResponse>(path, {
      method: 'POST',
      auth: 'none',
      body: { ...body, ...label },
    });
    await session.establish(tokensFromAuthResponse(response));
  }

  async function post(path: string, body: Record<string, unknown>): Promise<void> {
    await api.request<unknown>(path, { method: 'POST', auth: 'none', body });
  }

  return {
    register: ({ email, password, displayName }) =>
      post('/api/v1/auth/register', {
        email: normalizeEmail(email),
        password,
        displayName: displayName.trim(),
      }),
    login: ({ email, password }) =>
      signIn('/api/v1/auth/login', { email: normalizeEmail(email), password }),
    forgotPassword: (email) => post('/api/v1/auth/forgot', { email: normalizeEmail(email) }),
    resetPassword: ({ token, password }) => post('/api/v1/auth/reset', { token, password }),
    verifyEmail: (token) => post('/api/v1/auth/verify-email', { token }),
    signInWithApple: ({ identityToken, nonce, displayName }) =>
      signIn('/api/v1/auth/apple', {
        identityToken,
        nonce,
        ...(displayName === undefined ? {} : { displayName }),
      }),
    signInWithGoogle: ({ idToken, nonce }) =>
      signIn('/api/v1/auth/google', { idToken, ...(nonce === undefined ? {} : { nonce }) }),
  };
}
