import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { type Query } from '@tanstack/react-query';
import { type PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

import { QUERY_ROOTS, type QueryRoot } from './keys';

/** AsyncStorage key of the persisted query cache. Holds no credential (threat model T-MOB-04). */
export const QUERY_CACHE_STORAGE_KEY = 'kadro.query-cache.v1';

/** Persisted entries older than this are discarded on restore. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Query roots written to the device so the app shows the last known lists offline. `me` is left
 * out (email address, linked providers); anything not listed here stays in memory only.
 */
export const PERSISTED_QUERY_ROOTS: ReadonlySet<QueryRoot> = new Set([
  QUERY_ROOTS.teams,
  QUERY_ROOTS.matches,
  QUERY_ROOTS.openCalls,
  QUERY_ROOTS.venues,
  QUERY_ROOTS.districts,
]);

const SENSITIVE_KEY = /token|password|secret|authorization|cookie|email/i;
const MAX_INSPECTION_DEPTH = 12;

/**
 * Whether a value carries a field that must never reach unencrypted storage. A defence in depth
 * behind the allow-list: an API change that adds such a field to an allowed list keeps that
 * query in memory instead of writing it to disk.
 */
export function containsSensitiveField(value: unknown, depth = 0): boolean {
  if (depth > MAX_INSPECTION_DEPTH || typeof value !== 'object' || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsSensitiveField(entry, depth + 1));
  }
  return Object.entries(value).some(
    ([key, entry]) => SENSITIVE_KEY.test(key) || containsSensitiveField(entry, depth + 1),
  );
}

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const root = query.queryKey[0];
  if (typeof root !== 'string' || !PERSISTED_QUERY_ROOTS.has(root as QueryRoot)) {
    return false;
  }
  if (query.state.status !== 'success') {
    return false;
  }
  return !containsSensitiveField(query.state.data);
}

export interface PersistStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type QueryPersister = ReturnType<typeof createAsyncStoragePersister>;

export function createQueryPersister(storage: PersistStorage): QueryPersister {
  return createAsyncStoragePersister({
    storage,
    key: QUERY_CACHE_STORAGE_KEY,
    throttleTime: 1_000,
  });
}

/** `buster` invalidates the stored cache whenever the app version changes. */
export function persistOptions(
  persister: QueryPersister,
  buster: string,
): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister,
    maxAge: PERSIST_MAX_AGE_MS,
    buster,
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersistQuery,
      // Mutations carry request bodies (passwords, messages): never persisted.
      shouldDehydrateMutation: () => false,
    },
  };
}
