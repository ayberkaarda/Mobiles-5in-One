import { type SessionPort } from '../api/client';
import { ApiError } from '../api/errors';
import { type AuthStore, SIGNED_OUT_STATE } from './store';
import { type TokenStorage } from './token-storage';

/** Token pair returned by login, provider sign-in and refresh (`tokenPairSchema`). */
export interface SessionTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
}

/** Access tokens are treated as expired this long before `accessTokenExpiresAt` (clock skew). */
export const ACCESS_TOKEN_SKEW_MS = 30_000;

export type SignOutReason = 'user' | 'expired';
export type SignOutListener = (reason: SignOutReason) => void | Promise<void>;

export interface SessionDeps {
  readonly store: AuthStore;
  readonly storage: TokenStorage;
  /** `POST /api/v1/auth/refresh` with the stored token; must not itself trigger a refresh. */
  readonly refresh: (refreshToken: string) => Promise<SessionTokens>;
  /** `POST /api/v1/auth/logout` revoking the presented family; failures are ignored. */
  readonly revoke?: (refreshToken: string, accessToken: string | null) => Promise<void>;
  readonly now?: () => number;
}

export interface Session extends SessionPort {
  /** Reads secure storage once at startup and settles `status`. */
  bootstrap(): Promise<void>;
  /** Stores a fresh pair after login or provider sign-in. */
  establish(tokens: SessionTokens): Promise<void>;
  /**
   * Ends the session on this device: optional server revocation, then the refresh token, the
   * in-memory access token and every registered cache (query cache, persisted cache) are cleared.
   */
  signOut(options?: { revokeRemote?: boolean; reason?: SignOutReason }): Promise<void>;
  onSignOut(listener: SignOutListener): () => void;
}

export function createSession(deps: SessionDeps): Session {
  const now = deps.now ?? Date.now;
  const listeners = new Set<SignOutListener>();
  let inFlightRefresh: Promise<string | null> | null = null;

  function applyTokens(tokens: SessionTokens): void {
    const expiresAt = Date.parse(tokens.accessTokenExpiresAt);
    deps.store.setState({
      status: 'signedIn',
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: Number.isNaN(expiresAt) ? null : expiresAt,
    });
  }

  async function clearLocal(reason: SignOutReason): Promise<void> {
    deps.store.setState(SIGNED_OUT_STATE);
    await deps.storage.clear();
    for (const listener of listeners) {
      try {
        await listener(reason);
      } catch {
        // One failing cleanup must not leave the other caches populated.
      }
    }
  }

  async function runRefresh(): Promise<string | null> {
    const refreshToken = await deps.storage.readRefreshToken();
    if (refreshToken === null) {
      await clearLocal('expired');
      return null;
    }
    let tokens: SessionTokens;
    try {
      tokens = await deps.refresh(refreshToken);
    } catch (error) {
      // 401: expired, revoked, or a reused (already rotated) token whose family the server has
      // just revoked (ADR-0019). Never retried: the user signs in again.
      if (error instanceof ApiError && error.kind === 'problem' && error.status === 401) {
        await clearLocal('expired');
        return null;
      }
      // Offline or server failure: the stored token is still the latest one; keep the session.
      throw error;
    }
    // The rotated token is persisted before any waiter resumes, so no later call can present
    // the spent one.
    await deps.storage.writeRefreshToken(tokens.refreshToken);
    applyTokens(tokens);
    return tokens.accessToken;
  }

  return {
    async bootstrap() {
      const refreshToken = await deps.storage.readRefreshToken();
      if (refreshToken === null) {
        // Starting without a session also clears what an interrupted sign-out may have left.
        await clearLocal('expired');
        return;
      }
      deps.store.setState({ status: 'signedIn', accessToken: null, accessTokenExpiresAt: null });
    },

    async establish(tokens) {
      await deps.storage.writeRefreshToken(tokens.refreshToken);
      applyTokens(tokens);
    },

    getAccessToken() {
      const { accessToken, accessTokenExpiresAt } = deps.store.getState();
      if (accessToken === null || accessTokenExpiresAt === null) {
        return null;
      }
      return accessTokenExpiresAt - ACCESS_TOKEN_SKEW_MS > now() ? accessToken : null;
    },

    hasSession() {
      return deps.store.getState().status === 'signedIn';
    },

    refreshAccessToken() {
      // Single flight (ADR-0019): every caller during a refresh shares the same promise, so a
      // burst of 401s rotates the refresh token exactly once.
      inFlightRefresh ??= runRefresh().finally(() => {
        inFlightRefresh = null;
      });
      return inFlightRefresh;
    },

    async signOut({ revokeRemote = true, reason = 'user' } = {}) {
      if (revokeRemote && deps.revoke !== undefined) {
        const refreshToken = await deps.storage.readRefreshToken();
        if (refreshToken !== null) {
          try {
            await deps.revoke(refreshToken, deps.store.getState().accessToken);
          } catch {
            // Local sign-out must complete even offline; the family expires server-side.
          }
        }
      }
      await clearLocal(reason);
    },

    onSignOut(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
