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
/** Where a tolerated failure happened; reported without any token or server text. */
export type SessionErrorStage = 'read' | 'revoke' | 'clear' | 'listener';
export type SignOutListener = (reason: SignOutReason) => void | Promise<void>;

export interface SessionDeps {
  readonly store: AuthStore;
  readonly storage: TokenStorage;
  /** `POST /api/v1/auth/refresh` with the stored token; must not itself trigger a refresh. */
  readonly refresh: (refreshToken: string) => Promise<SessionTokens>;
  /** `POST /api/v1/auth/logout` revoking the presented family; failures are ignored. */
  readonly revoke?: (refreshToken: string, accessToken: string | null) => Promise<void>;
  readonly now?: () => number;
  /** Receives failures that sign-out tolerates, so they are not lost silently. */
  readonly reportError?: (stage: SessionErrorStage, error: unknown) => void;
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

/** Random id for a new sign-in; distinctness is all that matters, it is not a secret. */
function newCacheScope(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createSession(deps: SessionDeps): Session {
  const now = deps.now ?? Date.now;
  const report = (stage: SessionErrorStage, error: unknown): void => {
    try {
      deps.reportError?.(stage, error);
    } catch {
      // Reporting must never break the cleanup it reports on.
    }
  };
  const listeners = new Set<SignOutListener>();
  let inFlightRefresh: Promise<string | null> | null = null;
  /**
   * Session generation: incremented by every sign-out and sign-in. A refresh remembers the
   * generation it started in; its result is dropped when the generation has moved on, so a slow
   * rotation can neither revive a signed-out session nor replace the tokens of a new account.
   */
  let generation = 0;
  /** Token writes and deletions run one after another, in the order they were requested. */
  let storageQueue: Promise<unknown> = Promise.resolve();

  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const next = storageQueue.then(task, task);
    storageQueue = next.catch(() => undefined);
    return next;
  }

  function nextGeneration(): number {
    generation += 1;
    // A refresh of the previous generation is no longer shared with new callers.
    inFlightRefresh = null;
    return generation;
  }

  function applyTokens(tokens: SessionTokens): void {
    const expiresAt = Date.parse(tokens.accessTokenExpiresAt);
    deps.store.setState({
      status: 'signedIn',
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: Number.isNaN(expiresAt) ? null : expiresAt,
    });
  }

  async function clearLocal(reason: SignOutReason): Promise<void> {
    nextGeneration();
    deps.store.setState(SIGNED_OUT_STATE);
    // Secure storage and the caches are cleaned independently: a failure in one never skips the
    // other, and each failure is reported.
    await serialized(async () => {
      try {
        await deps.storage.clear();
      } catch (error) {
        report('clear', error);
        try {
          // An entry that cannot be deleted is overwritten, so a restart does not sign back in.
          await deps.storage.writeRefreshToken('');
        } catch (overwriteError) {
          report('clear', overwriteError);
        }
      }
    });
    for (const listener of listeners) {
      try {
        await listener(reason);
      } catch (error) {
        // One failing cleanup must not leave the other caches populated.
        report('listener', error);
      }
    }
  }

  async function runRefresh(): Promise<string | null> {
    const startedIn = generation;
    const refreshToken = await deps.storage.readRefreshToken();
    if (startedIn !== generation) {
      return null;
    }
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
        if (startedIn === generation) {
          await clearLocal('expired');
        }
        return null;
      }
      // Offline or server failure: the stored token is still the latest one; keep the session.
      throw error;
    }
    // The rotated token is persisted before any waiter resumes, so no later call can present
    // the spent one. The generation is checked inside the storage queue: a sign-out requested
    // meanwhile has already advanced it, and its deletion runs after this write.
    return serialized(async () => {
      if (startedIn !== generation) {
        return null;
      }
      await deps.storage.writeRefreshToken(tokens.refreshToken);
      applyTokens(tokens);
      return tokens.accessToken;
    });
  }

  return {
    async bootstrap() {
      const refreshToken = await deps.storage.readRefreshToken();
      if (refreshToken === null) {
        // Starting without a session also clears what an interrupted sign-out may have left.
        await clearLocal('expired');
        return;
      }
      let cacheScope = await deps.storage.readCacheScope();
      if (cacheScope === null) {
        cacheScope = newCacheScope();
        await deps.storage.writeCacheScope(cacheScope);
      }
      deps.store.setState({
        status: 'signedIn',
        accessToken: null,
        accessTokenExpiresAt: null,
        cacheScope,
      });
    },

    async establish(tokens) {
      const current = nextGeneration();
      await serialized(async () => {
        if (current !== generation) {
          return;
        }
        const cacheScope = newCacheScope();
        await deps.storage.writeRefreshToken(tokens.refreshToken);
        await deps.storage.writeCacheScope(cacheScope);
        deps.store.setState({ cacheScope });
        applyTokens(tokens);
      });
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
      if (inFlightRefresh === null) {
        const started: Promise<string | null> = runRefresh().finally(() => {
          if (inFlightRefresh === started) {
            inFlightRefresh = null;
          }
        });
        inFlightRefresh = started;
      }
      return inFlightRefresh;
    },

    async signOut({ revokeRemote = true, reason = 'user' } = {}) {
      try {
        if (revokeRemote && deps.revoke !== undefined) {
          let refreshToken: string | null = null;
          try {
            refreshToken = await deps.storage.readRefreshToken();
          } catch (error) {
            report('read', error);
          }
          if (refreshToken !== null) {
            try {
              await deps.revoke(refreshToken, deps.store.getState().accessToken);
            } catch (error) {
              // Local sign-out must complete even offline; the family expires server-side.
              report('revoke', error);
            }
          }
        }
      } finally {
        await clearLocal(reason);
      }
    },

    onSignOut(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
