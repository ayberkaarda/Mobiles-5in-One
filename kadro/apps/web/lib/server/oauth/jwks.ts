import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';

/**
 * Provider signing keys (Apple, Google) fetched from their JWKS endpoints with a timeout and an
 * in-process cache. Keys are refetched when the cache is older than `cacheTtlMs`, and on an
 * unknown `kid` (key rotation) at most once per `refreshCooldownMs`, so a flood of tokens with
 * made-up key ids cannot turn into a flood of outbound requests. When a refresh fails, expired
 * keys keep serving for at most `maxStaleMs` (default 24 h) past their TTL, reported once through
 * `onStaleKeys` ('stale'); after that they are dropped ('expired') and the lookup fails closed with
 * {@link JwksUnavailableError} (the API answers 503) until a fetch succeeds again. A provider
 * that removed a compromised key is therefore honoured within TTL + 24 h even during an outage of
 * its JWKS endpoint.
 */

/** Minimal `fetch` shape; tests inject a stub that serves a locally generated key set. */
export type JwksFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface JwksSourceOptions {
  readonly url: string;
  readonly fetch: JwksFetch;
  readonly timeoutMs?: number;
  readonly cacheTtlMs?: number;
  readonly refreshCooldownMs?: number;
  /** How long expired keys may still serve while refreshing fails. Default 24 h. */
  readonly maxStaleMs?: number;
  /** Called when expired keys start serving (`stale`) and when they are dropped (`expired`). */
  readonly onStaleKeys?: (event: {
    readonly state: 'stale' | 'expired';
    readonly url: string;
  }) => void;
  /** Clock in milliseconds; defaults to `Date.now`. */
  readonly now?: () => number;
}

export class JwksUnavailableError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`provider key set unavailable (${reason})`, options);
    this.name = 'JwksUnavailableError';
  }
}

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_REFRESH_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_STALE_MS = 24 * 60 * 60 * 1_000;
const MAX_KEYS = 50;

function isKeySet(value: unknown): value is JSONWebKeySet {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const keys = (value as { keys?: unknown }).keys;
  return (
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.length <= MAX_KEYS &&
    keys.every((key) => key !== null && typeof key === 'object')
  );
}

export interface JwksSource {
  readonly getKey: JWTVerifyGetKey;
  /** Number of completed fetch attempts (tests assert caching and the cooldown). */
  fetchCount(): number;
}

export function createJwksSource(options: JwksSourceOptions): JwksSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cooldownMs = options.refreshCooldownMs ?? DEFAULT_REFRESH_COOLDOWN_MS;
  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const now = options.now ?? Date.now;
  let staleReported = false;

  let local: ReturnType<typeof createLocalJWKSet> | null = null;
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let attemptedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let fetches = 0;

  async function load(): Promise<void> {
    attemptedAt = now();
    fetches += 1;
    const signal = AbortSignal.timeout(timeoutMs);
    let body: unknown;
    try {
      const response = await options.fetch(options.url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) {
        throw new JwksUnavailableError(`http ${response.status}`);
      }
      body = await response.json();
    } catch (error) {
      if (error instanceof JwksUnavailableError) {
        throw error;
      }
      throw new JwksUnavailableError(signal.aborted ? 'timeout' : 'network', { cause: error });
    }
    if (!isKeySet(body)) {
      throw new JwksUnavailableError('malformed');
    }
    local = createLocalJWKSet(body);
    fetchedAt = now();
    staleReported = false;
  }

  /** Applies the staleness bound after a refresh attempt. */
  function enforceStaleness(): void {
    if (local === null) {
      return;
    }
    const age = now() - fetchedAt;
    if (age < cacheTtlMs) {
      return;
    }
    if (age >= cacheTtlMs + maxStaleMs) {
      local = null;
      options.onStaleKeys?.({ state: 'expired', url: options.url });
      return;
    }
    if (!staleReported) {
      staleReported = true;
      options.onStaleKeys?.({ state: 'stale', url: options.url });
    }
  }

  /** Single-flight refresh; a failure keeps the previous keys when there are any. */
  async function refresh(): Promise<void> {
    inFlight ??= load().finally(() => {
      inFlight = null;
    });
    try {
      await inFlight;
    } catch (error) {
      if (local === null) {
        throw error;
      }
    }
  }

  const getKey: JWTVerifyGetKey = async (header, token) => {
    if (local === null || now() - fetchedAt >= cacheTtlMs) {
      if (local === null || now() - attemptedAt >= cooldownMs) {
        await refresh();
      }
    }
    enforceStaleness();
    if (local === null) {
      throw new JwksUnavailableError('no keys');
    }
    try {
      return await local(header, token);
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey && now() - attemptedAt >= cooldownMs) {
        await refresh();
        return local(header, token);
      }
      throw error;
    }
  };

  return { getKey, fetchCount: () => fetches };
}
