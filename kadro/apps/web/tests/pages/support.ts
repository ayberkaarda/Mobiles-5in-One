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

type HistoryWrite = (data: unknown, unused: string, url?: string | URL | null) => void;
type Listener = (event: { readonly type: string; readonly persisted?: boolean }) => void;

export interface FakeBrowser {
  readonly location: { hash: string; pathname: string; search: string; href: string };
  readonly history: {
    replaceState: HistoryWrite;
    pushState: HistoryWrite;
    entries: string[];
  };
  /** The original history methods; code under test may wrap the `history` properties. */
  readonly native: {
    readonly replaceState: Mock<HistoryWrite>;
    readonly pushState: Mock<HistoryWrite>;
  };
  addEventListener(type: string, listener: Listener): void;
  /** Dispatches `type` to the registered listeners. */
  fire(type: string, init?: { readonly persisted?: boolean }): void;
  /**
   * A same-document fragment navigation started by the browser (a link opened in the same tab,
   * the address bar): a new history entry, then `popstate` and `hashchange`, as browsers do.
   */
  navigateFragment(hash: string): void;
}

/** `window.location` / `window.history` stand-ins; history writes rewrite the fake location. */
export function fakeBrowser(pathname: string, hash: string, search = ''): FakeBrowser {
  const location = {
    hash,
    pathname,
    search,
    href: `https://kadro.test${pathname}${search}${hash}`,
  };
  const entries = [location.href];
  const moveTo = (url: string | URL) => {
    const next = new URL(String(url), location.href);
    location.hash = next.hash;
    location.pathname = next.pathname;
    location.search = next.search;
    location.href = next.href;
  };
  const replaceState = vi.fn<HistoryWrite>((_data, _unused, url) => {
    if (url === undefined || url === null) {
      return;
    }
    moveTo(url);
    entries[entries.length - 1] = location.href;
  });
  const pushState = vi.fn<HistoryWrite>((_data, _unused, url) => {
    if (url !== undefined && url !== null) {
      moveTo(url);
    }
    entries.push(location.href);
  });
  const listeners = new Map<string, Listener[]>();
  const fire = (type: string, init: { readonly persisted?: boolean } = {}) => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ type, ...init });
    }
  };
  return {
    location,
    history: { replaceState, pushState, entries },
    native: { replaceState, pushState },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    fire,
    navigateFragment(next) {
      moveTo(`${location.pathname}${location.search}${next}`);
      entries.push(location.href);
      fire('popstate');
      fire('hashchange');
    },
  };
}
