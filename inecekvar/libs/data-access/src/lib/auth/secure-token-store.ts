import { InjectionToken } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  SecureStoragePlugin,
  type SecureStoragePluginPlugin,
} from 'capacitor-secure-storage-plugin';

/**
 * Holds the native refresh token in Keychain (iOS) or Keystore-backed storage (Android),
 * ADR-0004. Never localStorage, Preferences or the filesystem.
 */
export interface SecureTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export const SECURE_TOKEN_STORE = new InjectionToken<SecureTokenStore>('SECURE_TOKEN_STORE');

export const REFRESH_TOKEN_KEY = 'iv.refresh';

type StoragePlugin = Pick<SecureStoragePluginPlugin, 'get' | 'set' | 'remove'>;

/**
 * Adapter over `capacitor-secure-storage-plugin`. The plugin's web fallback writes to
 * localStorage, so every call refuses to run outside the native shell.
 */
export class CapacitorSecureTokenStore implements SecureTokenStore {
  constructor(
    private readonly plugin: StoragePlugin = SecureStoragePlugin,
    private readonly isNative: () => boolean = () => Capacitor.isNativePlatform(),
  ) {}

  async get(): Promise<string | null> {
    this.assertNative();
    try {
      const { value } = await this.plugin.get({ key: REFRESH_TOKEN_KEY });
      return value || null;
    } catch {
      // The plugin rejects when the key does not exist.
      return null;
    }
  }

  async set(token: string): Promise<void> {
    this.assertNative();
    await this.plugin.set({ key: REFRESH_TOKEN_KEY, value: token });
  }

  async clear(): Promise<void> {
    this.assertNative();
    try {
      await this.plugin.remove({ key: REFRESH_TOKEN_KEY });
    } catch {
      // Nothing stored.
    }
  }

  private assertNative(): void {
    if (!this.isNative()) {
      throw new Error('secure token storage is available in the native app only');
    }
  }
}
