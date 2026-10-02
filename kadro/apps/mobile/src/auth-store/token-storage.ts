import * as SecureStore from 'expo-secure-store';

/**
 * Persistent credential storage (security checklist item 12, threat model T-MOB-01). The refresh
 * token is the only credential that survives an app restart, and it lives only in the iOS
 * Keychain / Android Keystore through `expo-secure-store`; never in AsyncStorage, the query cache
 * or logs. The access token is kept in memory only (`auth-store/store.ts`).
 */
export const REFRESH_TOKEN_KEY = 'kadro.refresh-token';

/**
 * Readable after the first unlock so a background refresh (push handling) still works; never
 * migrated to another device through a backup.
 */
export const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface TokenStorage {
  readRefreshToken(): Promise<string | null>;
  writeRefreshToken(token: string): Promise<void>;
  clear(): Promise<void>;
}

export const secureTokenStorage: TokenStorage = {
  readRefreshToken() {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS);
  },
  writeRefreshToken(token) {
    return SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, SECURE_STORE_OPTIONS);
  },
  clear() {
    return SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, SECURE_STORE_OPTIONS);
  },
};
