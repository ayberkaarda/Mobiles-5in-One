import * as SecureStore from 'expo-secure-store';

/**
 * Persistent credential storage (security checklist item 12, threat model T-MOB-01). The refresh
 * token is the only credential that survives an app restart, and it lives only in the iOS
 * Keychain / Android Keystore through `expo-secure-store`; never in AsyncStorage, the query cache
 * or logs. The access token is kept in memory only (`auth-store/store.ts`).
 */
export const REFRESH_TOKEN_KEY = 'kadro.refresh-token';
/**
 * Random id of the current sign-in, used to scope the persisted query cache. Not a credential;
 * kept next to the refresh token so both disappear together.
 */
export const CACHE_SCOPE_KEY = 'kadro.cache-scope';

/**
 * Readable after the first unlock so a background refresh (push handling) still works; never
 * migrated to another device through a backup.
 */
export const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface TokenStorage {
  /** The stored refresh token; an empty (overwritten) entry counts as none. */
  readRefreshToken(): Promise<string | null>;
  writeRefreshToken(token: string): Promise<void>;
  readCacheScope(): Promise<string | null>;
  writeCacheScope(scope: string): Promise<void>;
  /** Deletes both entries; attempts each one and rejects if either deletion failed. */
  clear(): Promise<void>;
}

export const secureTokenStorage: TokenStorage = {
  async readRefreshToken() {
    const token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS);
    return token === null || token === '' ? null : token;
  },
  writeRefreshToken(token) {
    return SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, SECURE_STORE_OPTIONS);
  },
  async readCacheScope() {
    const scope = await SecureStore.getItemAsync(CACHE_SCOPE_KEY, SECURE_STORE_OPTIONS);
    return scope === null || scope === '' ? null : scope;
  },
  writeCacheScope(scope) {
    return SecureStore.setItemAsync(CACHE_SCOPE_KEY, scope, SECURE_STORE_OPTIONS);
  },
  async clear() {
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS),
      SecureStore.deleteItemAsync(CACHE_SCOPE_KEY, SECURE_STORE_OPTIONS),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure !== undefined) {
      throw failure.reason;
    }
  },
};
