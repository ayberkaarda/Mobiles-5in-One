import { InjectionToken } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/**
 * Base URL of the API including the version prefix. Web and PWA use the same-origin proxy path
 * (`/api/v1`) so the session cookie stays first-party; native builds use the API host.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

/** Public base URL of the PMTiles CDN (no key, spec section 6.1). */
export const TILES_BASE_URL = new InjectionToken<string>('TILES_BASE_URL');

/** Fetch implementation used by every client; tests replace it with a fake. */
export const FETCH = new InjectionToken<typeof fetch>('FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

/** True inside the Capacitor Android or iOS shell; selects the bearer strategy. */
export const IS_NATIVE_PLATFORM = new InjectionToken<boolean>('IS_NATIVE_PLATFORM', {
  providedIn: 'root',
  factory: () => Capacitor.isNativePlatform(),
});

export interface ApiClientOptions {
  /** Abort a request after this many milliseconds. */
  timeoutMs: number;
  /** A 429 with a `Retry-After` up to this many seconds is retried once for idempotent methods. */
  maxAutoRetryAfterSeconds: number;
  /** Waits before a retry; tests replace it so nothing sleeps. */
  sleep: (ms: number) => Promise<void>;
  /** Current time in milliseconds; tests replace it to move access-token expiry. */
  now: () => number;
}

export const DEFAULT_API_CLIENT_OPTIONS: ApiClientOptions = {
  timeoutMs: 15_000,
  maxAutoRetryAfterSeconds: 5,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export const API_CLIENT_OPTIONS = new InjectionToken<ApiClientOptions>('API_CLIENT_OPTIONS', {
  providedIn: 'root',
  factory: () => DEFAULT_API_CLIENT_OPTIONS,
});
