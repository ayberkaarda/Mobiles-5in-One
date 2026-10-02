import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { PERSIST_MAX_AGE_MS } from './persistence';

/**
 * Query defaults for an app used on the pitch with a weak signal:
 * - `offlineFirst`: a query runs once even when the device looks offline, so a cached or
 *   persisted result is shown and a request that can still get through is not held back.
 * - no Query-level retry: the API client already repeats idempotent GETs after network failures
 *   and 502/503/504, and a second layer would multiply the attempts.
 * - `gcTime` matches the persistence max age, otherwise restored entries would be dropped.
 * - mutations are never retried (a repeated POST could create a duplicate).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: 'offlineFirst',
        retry: false,
        staleTime: 30_000,
        gcTime: PERSIST_MAX_AGE_MS,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
      },
      mutations: {
        networkMode: 'online',
        retry: false,
      },
    },
  });
}

/** Treats the app returning to the foreground as a window focus (stale queries refetch). */
export function connectFocusManager(): () => void {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      setFocused(status === 'active');
    });
    return () => subscription.remove();
  });
  return () => focusManager.setEventListener(() => undefined);
}
