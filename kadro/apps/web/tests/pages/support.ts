import { randomBytes } from 'node:crypto';

import { type Mock, vi } from 'vitest';

/** A fresh email-link token shaped like the worker's (256 bits, base64url), made at run time. */
export function freshToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export interface StorageSpy {
  readonly writes: unknown[][];
  readonly storage: Storage;
}

/** A `Storage` whose every call is recorded; the token pages must never call it. */
export function storageSpy(): StorageSpy {
  const writes: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      writes.push([name, ...args]);
      return null;
    };
  const storage = {
    get length() {
      return 0;
    },
    clear: vi.fn(record('clear')),
    getItem: vi.fn(record('getItem')),
    key: vi.fn(record('key')),
    removeItem: vi.fn(record('removeItem')),
    setItem: vi.fn(record('setItem')),
  } as unknown as Storage;
  return { writes, storage };
}

export interface FakeBrowser {
  readonly location: { hash: string; pathname: string; search: string; href: string };
  readonly history: {
    replaceState: Mock<(data: unknown, unused: string, url?: string | URL | null) => void>;
    entries: string[];
  };
}

/** `window.location` / `window.history` stand-ins; `replaceState` rewrites the fake location. */
export function fakeBrowser(pathname: string, hash: string, search = ''): FakeBrowser {
  const location = {
    hash,
    pathname,
    search,
    href: `https://kadro.test${pathname}${search}${hash}`,
  };
  const entries = [location.href];
  const replaceState = vi.fn((_data: unknown, _unused: string, url?: string | URL | null): void => {
    if (url === undefined || url === null) {
      return;
    }
    const next = new URL(String(url), location.href);
    location.hash = next.hash;
    location.pathname = next.pathname;
    location.search = next.search;
    location.href = next.href;
    entries[entries.length - 1] = next.href;
  });
  return { location, history: { replaceState, entries } };
}
