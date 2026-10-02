import { QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';
import { describe, expect, it } from 'vitest';

import {
  REFRESH_TOKEN_KEY,
  secureTokenStorage,
  type TokenStorage,
} from '../src/auth-store/token-storage';
import { cacheBusterFor, createQueryPersister, persistOptions } from '../src/query';
import { createTestApi, issueTokens } from './support/api';
import AsyncStorage from './support/async-storage';
import { secureStoreContents } from './support/expo-secure-store';

function failing(overrides: Partial<Record<keyof TokenStorage, Error>>): TokenStorage {
  const wrap =
    <K extends keyof TokenStorage>(key: K) =>
    (...args: Parameters<TokenStorage[K]>) => {
      const error = overrides[key];
      if (error !== undefined) {
        return Promise.reject(error);
      }
      return (
        secureTokenStorage[key] as (
          ...a: Parameters<TokenStorage[K]>
        ) => ReturnType<TokenStorage[K]>
      )(...args);
    };
  return {
    readRefreshToken: wrap('readRefreshToken'),
    writeRefreshToken: wrap('writeRefreshToken'),
    readCacheScope: wrap('readCacheScope'),
    writeCacheScope: wrap('writeCacheScope'),
    clear: wrap('clear'),
  } as TokenStorage;
}

describe('sign-out cleanup is independent of storage failures', () => {
  it('clears memory and caches when reading the stored token fails', async () => {
    const reported: string[] = [];
    const storage: { current: TokenStorage } = { current: secureTokenStorage };
    const proxy = new Proxy({} as TokenStorage, {
      get: (_target, key: keyof TokenStorage) => storage.current[key],
    });
    const { session, store } = createTestApi({
      storage: proxy,
      reportError: (stage) => {
        reported.push(stage);
      },
    });
    await session.establish(issueTokens());
    storage.current = failing({ readRefreshToken: new Error('keychain locked') });
    const cleared: string[] = [];
    session.onSignOut((reason) => {
      cleared.push(reason);
    });

    await session.signOut();

    expect(store.getState().status).toBe('signedOut');
    expect(store.getState().accessToken).toBeNull();
    expect(cleared).toEqual(['user']);
    expect(reported).toContain('read');
  });

  it('still clears the query caches when deleting the secure-store entry fails', async () => {
    const reported: string[] = [];
    const { session, store } = createTestApi({
      storage: failing({ clear: new Error('keystore unavailable') }),
      reportError: (stage) => {
        reported.push(stage);
      },
    });
    await session.establish(issueTokens());
    const cleared: string[] = [];
    session.onSignOut(() => {
      cleared.push('cache');
    });

    await session.signOut({ revokeRemote: false });

    expect(store.getState().status).toBe('signedOut');
    expect(cleared).toEqual(['cache']);
    expect(reported).toContain('clear');
    // The token that could not be deleted is overwritten, so a restart does not sign back in.
    expect(secureStoreContents().get(REFRESH_TOKEN_KEY)?.value ?? '').toBe('');
    const restarted = createTestApi();
    await restarted.session.bootstrap();
    expect(restarted.store.getState().status).toBe('signedOut');
  });

  it('runs every cleanup listener even when one fails, and reports the failure', async () => {
    const reported: string[] = [];
    const { session } = createTestApi({
      reportError: (stage) => {
        reported.push(stage);
      },
    });
    await session.establish(issueTokens());
    const ran: string[] = [];
    session.onSignOut(() => {
      throw new Error('disk full');
    });
    session.onSignOut(() => {
      ran.push('second');
    });
    await session.signOut({ revokeRemote: false });
    expect(ran).toEqual(['second']);
    expect(reported).toEqual(['listener']);
  });
});

describe('persisted cache is scoped to one sign-in', () => {
  it('gives each sign-in its own scope, kept across restarts and refreshes', async () => {
    const first = createTestApi();
    await first.session.establish(issueTokens());
    const scope = first.store.getState().cacheScope;
    expect(scope).toEqual(expect.any(String));

    const restarted = createTestApi();
    await restarted.session.bootstrap();
    expect(restarted.store.getState().cacheScope).toBe(scope);

    await restarted.session.signOut({ revokeRemote: false });
    expect(restarted.store.getState().cacheScope).toBeNull();
    await restarted.session.establish(issueTokens());
    expect(restarted.store.getState().cacheScope).not.toBe(scope);
  });

  it('does not restore a cache written under another sign-in', async () => {
    const persister = createQueryPersister(AsyncStorage);
    const writer = new QueryClient();
    writer.setQueryData(['teams', 'list'], { pages: [{ items: [{ name: 'Yıldızlar FK' }] }] });
    await persistQueryClientSave({
      queryClient: writer,
      ...persistOptions(persister, cacheBusterFor('1.0.0', 'scope-a')),
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const sameScope = new QueryClient();
    await persistQueryClientRestore({
      queryClient: sameScope,
      ...persistOptions(persister, cacheBusterFor('1.0.0', 'scope-a')),
    });
    expect(sameScope.getQueryData(['teams', 'list'])).toBeDefined();

    const otherScope = new QueryClient();
    await persistQueryClientRestore({
      queryClient: otherScope,
      ...persistOptions(persister, cacheBusterFor('1.0.0', 'scope-b')),
    });
    expect(otherScope.getQueryData(['teams', 'list'])).toBeUndefined();
    expect(cacheBusterFor('1.0.0', null)).not.toBe(cacheBusterFor('1.0.0', 'scope-a'));
  });
});
