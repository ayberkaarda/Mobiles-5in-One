import { isPlatformServer } from '@angular/common';
import {
  inject,
  Injectable,
  makeStateKey,
  PendingTasks,
  PLATFORM_ID,
  TransferState,
} from '@angular/core';
import { PUBLIC_WEB_CONFIG } from '../public-config';
import { assertPublicPath } from '../public-path';
import { API_INTERNAL_BASE_URL } from './api-internal-base-url';

export type PublicApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'unavailable'; status: number; code: string | null };

export function apiPath(
  template: string,
  params: Readonly<Record<string, string | number>>,
): string {
  const path = template.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      throw new Error('Missing path parameter');
    }
    // Encode punctuation too, so each value stays within one path segment.
    return encodeURIComponent(String(params[key])).replace(
      /[.!'()*]/g,
      (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
    );
  });
  assertPublicPath(path);
  return path;
}

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  request_id: string;
  detail?: string;
}

function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const problem = value as Record<string, unknown>;
  return (
    typeof problem['type'] === 'string' &&
    typeof problem['title'] === 'string' &&
    Number.isInteger(problem['status']) &&
    typeof problem['code'] === 'string' &&
    typeof problem['request_id'] === 'string' &&
    (problem['detail'] === undefined || typeof problem['detail'] === 'string')
  );
}

function failure(status: number, code: string | null = null): PublicApiResult<never> {
  return {
    ok: false,
    kind: status === 404 || status === 410 ? 'not_found' : 'unavailable',
    status,
    code,
  };
}

const STOP_PAIRS_PATH = /^\/cities\/[^/]+\/stop-pairs$/;
export const STOP_PAIRS_TTL_MS = 10 * 60 * 1000;
export const STOP_PAIRS_NEGATIVE_TTL_MS = 30 * 1000;
export const STOP_PAIRS_MAX_ENTRIES = 256;

interface CacheEntry {
  promise: Promise<PublicApiResult<unknown>>;
  expires: number;
}

/**
 * Process-wide memo for the rate limited stop-pairs call. Concurrent callers share one request,
 * successes live 10 minutes, failures 30 seconds, and the map is bounded.
 */
export class StopPairsCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries: number = STOP_PAIRS_MAX_ENTRIES,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  load<T>(key: string, fetcher: () => Promise<PublicApiResult<T>>): Promise<PublicApiResult<T>> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) {
      return hit.promise as Promise<PublicApiResult<T>>;
    }
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const entry: CacheEntry = {
      promise: Promise.resolve().then(fetcher),
      expires: Number.POSITIVE_INFINITY,
    };
    this.entries.set(key, entry);
    entry.promise.then(
      (result) => {
        entry.expires = this.now() + (result.ok ? STOP_PAIRS_TTL_MS : STOP_PAIRS_NEGATIVE_TTL_MS);
      },
      () => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      },
    );
    return entry.promise as Promise<PublicApiResult<T>>;
  }
}

export const stopPairsCache = new StopPairsCache();

@Injectable({ providedIn: 'root' })
export class PublicApiClient {
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly state = inject(TransferState);
  private readonly pending = inject(PendingTasks);
  private readonly publicConfig = inject(PUBLIC_WEB_CONFIG);
  private readonly internalBase = inject(API_INTERNAL_BASE_URL, { optional: true });

  get<T>(
    path: string,
    query: Readonly<Record<string, string | number>> | undefined,
    guard: (value: unknown) => value is T,
  ): Promise<PublicApiResult<T>> {
    assertPublicPath(path);
    const search = new URLSearchParams();
    for (const key of Object.keys(query ?? {}).sort()) {
      search.set(key, String(query?.[key]));
    }
    const queryText = search.toString();
    const key = makeStateKey<PublicApiResult<T>>('iv-api:' + path + '?' + queryText);
    if (!this.server && this.state.hasKey(key)) {
      const result = this.state.get(key, failure(0));
      this.state.remove(key);
      return Promise.resolve(result);
    }
    const base = this.server ? this.internalBase : this.publicConfig.apiPublicBaseUrl;
    if (!base) {
      throw new Error('Missing internal API base URL');
    }
    const url = base.replace(/\/$/, '') + path + (queryText ? '?' + queryText : '');
    if (!this.server) {
      return this.request(url, guard);
    }
    return new Promise((resolve) => {
      this.pending.run(async () => {
        const result = STOP_PAIRS_PATH.test(path)
          ? await stopPairsCache.load(url, () => this.request(url, guard))
          : await this.request(url, guard);
        this.state.set(key, result);
        resolve(result);
      });
    });
  }

  private async request<T>(
    url: string,
    guard: (value: unknown) => value is T,
  ): Promise<PublicApiResult<T>> {
    let status = 0;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json, application/problem+json' },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      status = response.status;
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
        return { ok: false, kind: 'unavailable', status, code: null };
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return failure(status, response.ok ? 'invalid_response' : null);
      }
      if (response.ok) {
        return guard(body) ? { ok: true, data: body } : failure(status, 'invalid_response');
      }
      const problemType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      const code =
        problemType === 'application/problem+json' &&
        isProblem(body) &&
        /^[a-z0-9_.]{1,64}$/.test(body.code)
          ? body.code
          : null;
      return failure(status, code);
    } catch {
      return { ok: false, kind: 'unavailable', status, code: null };
    }
  }
}
