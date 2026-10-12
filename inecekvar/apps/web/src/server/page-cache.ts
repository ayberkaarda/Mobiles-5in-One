import { createHash } from 'node:crypto';
import type { WebServerConfig } from './config';

export interface CachedPage {
  status: 200;
  contentType: string;
  body: string;
  storedAt: number;
}

export interface PageCacheStore {
  get(key: string): Promise<CachedPage | undefined>;
  set(key: string, page: CachedPage, ttlMs: number): Promise<void>;
}

interface MemoryEntry {
  page: CachedPage;
  expiresAt: number;
  bytes: number;
}

export class MemoryLruPageCache implements PageCacheStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private bytes = 0;

  constructor(options: { maxEntries: number; maxBytes: number; now?: () => number }) {
    if (
      !Number.isSafeInteger(options.maxEntries) ||
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxEntries <= 0 ||
      options.maxBytes <= 0
    ) {
      throw new Error('Invalid page cache limits');
    }
    this.maxEntries = options.maxEntries;
    this.maxBytes = options.maxBytes;
    this.now = options.now ?? Date.now;
  }

  async get(key: string): Promise<CachedPage | undefined> {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.remove(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { ...entry.page };
  }

  async set(key: string, page: CachedPage, ttlMs: number): Promise<void> {
    this.remove(key);
    const bytes = Buffer.byteLength(page.body, 'utf8');
    if (bytes > this.maxBytes || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      return;
    }
    const now = this.now();
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.remove(entryKey);
      }
    }
    this.entries.set(key, { page: { ...page }, expiresAt: now + ttlMs, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.remove(oldestKey);
    }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
}

export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
}

export class RedisPageCache implements PageCacheStore {
  private errorReported = false;

  constructor(
    private readonly client: RedisLikeClient,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  async get(key: string): Promise<CachedPage | undefined> {
    try {
      const value = await this.client.get(this.key(key));
      if (value === null) {
        return undefined;
      }
      let page: unknown;
      try {
        page = JSON.parse(value);
      } catch {
        return undefined;
      }
      if (
        typeof page !== 'object' ||
        page === null ||
        !('status' in page) ||
        page.status !== 200 ||
        !('contentType' in page) ||
        typeof page.contentType !== 'string' ||
        !('body' in page) ||
        typeof page.body !== 'string' ||
        !('storedAt' in page) ||
        typeof page.storedAt !== 'number' ||
        !Number.isFinite(page.storedAt)
      ) {
        return undefined;
      }
      return {
        status: 200,
        contentType: page.contentType,
        body: page.body,
        storedAt: page.storedAt,
      };
    } catch (error) {
      this.report(error);
      return undefined;
    }
  }

  async set(key: string, page: CachedPage, ttlMs: number): Promise<void> {
    try {
      await this.client.set(this.key(key), JSON.stringify(page), 'PX', ttlMs);
    } catch (error) {
      this.report(error);
    }
  }

  private key(key: string): string {
    return `iv:web:page:v1:${createHash('sha256').update(key).digest('hex')}`;
  }

  private report(error: unknown): void {
    if (!this.errorReported) {
      this.errorReported = true;
      try {
        this.onError(error);
      } catch {
        // Logging must not interrupt a page response.
      }
    }
  }
}

export class LayeredPageCache implements PageCacheStore {
  constructor(
    private readonly memory: PageCacheStore,
    private readonly redis: PageCacheStore,
    private readonly ttlMs = 600_000,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string): Promise<CachedPage | undefined> {
    const local = await this.memory.get(key).catch(() => undefined);
    if (local) {
      return local;
    }
    const page = await this.redis.get(key).catch(() => undefined);
    if (page) {
      // Rewarming preserves the original expiry rather than extending it.
      const remainingTtl = page.storedAt + this.ttlMs - this.now();
      if (remainingTtl <= 0) {
        return undefined;
      }
      await this.memory.set(key, page, remainingTtl).catch(() => undefined);
    }
    return page;
  }

  async set(key: string, page: CachedPage, ttlMs: number): Promise<void> {
    await Promise.allSettled([this.memory.set(key, page, ttlMs), this.redis.set(key, page, ttlMs)]);
  }
}

export function renderPath(
  path: string,
  query: URLSearchParams,
  allowlist: readonly string[],
): string {
  const filtered = new URLSearchParams();
  for (const [name, value] of query) {
    if (allowlist.includes(name)) {
      filtered.append(name, value);
    }
  }
  filtered.sort();
  const search = filtered.toString();
  return path + (search ? `?${search}` : '');
}

export function pageCacheKey(
  input: {
    method: string;
    hostname: string;
    path: string;
    query: URLSearchParams;
    headers: Readonly<Record<string, string | string[] | undefined>>;
  },
  config: WebServerConfig,
): string | undefined {
  if (
    !['GET', 'HEAD'].includes(input.method) ||
    Object.keys(input.headers).some((name) => {
      return ['cookie', 'authorization'].includes(name.toLowerCase());
    })
  ) {
    return undefined;
  }
  const path = input.path;
  if (
    path.length > 512 ||
    !/^\/[A-Za-z0-9\-._~%/]*$/.test(path) ||
    path.includes('//') ||
    (path !== '/' && path.endsWith('/')) ||
    /%(?:2f|5c|2e)/i.test(path) ||
    path.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  try {
    if (/^\/admin(?:\/|$)/i.test(decodeURIComponent(path))) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const names = new Set<string>();
  for (const [name, value] of input.query) {
    if (names.has(name) || (config.cacheQueryAllowlist.includes(name) && value.length > 64)) {
      return undefined;
    }
    names.add(name);
  }
  const rendered = renderPath(path, input.query, config.cacheQueryAllowlist);
  const search = rendered.slice(path.length).replace(/^\?/, '');
  return `v1|${input.hostname}|${path}|${search}`;
}
