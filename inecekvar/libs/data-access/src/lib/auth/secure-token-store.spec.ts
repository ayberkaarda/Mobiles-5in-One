import { CapacitorSecureTokenStore, REFRESH_TOKEN_KEY } from './secure-token-store';

function fakePlugin() {
  const items = new Map<string, string>();
  return {
    items,
    get: vi.fn(async ({ key }: { key: string }) => {
      const value = items.get(key);
      if (value === undefined) throw new Error('Item with given key does not exist');
      return { value };
    }),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      items.set(key, value);
      return { value: true };
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      if (!items.delete(key)) throw new Error('Item with given key does not exist');
      return { value: true };
    }),
  };
}

describe('CapacitorSecureTokenStore', () => {
  it('stores, reads and removes the refresh token under one key', async () => {
    const plugin = fakePlugin();
    const store = new CapacitorSecureTokenStore(plugin, () => true);
    await expect(store.get()).resolves.toBeNull();
    await store.set('refresh-1');
    expect(plugin.items.get(REFRESH_TOKEN_KEY)).toBe('refresh-1');
    await expect(store.get()).resolves.toBe('refresh-1');
    await store.clear();
    await expect(store.get()).resolves.toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('refuses to run outside the native shell, where the plugin falls back to localStorage', async () => {
    const plugin = fakePlugin();
    const store = new CapacitorSecureTokenStore(plugin, () => false);
    await expect(store.set('refresh-1')).rejects.toThrow('native app only');
    await expect(store.get()).rejects.toThrow('native app only');
    await expect(store.clear()).rejects.toThrow('native app only');
    expect(plugin.set).not.toHaveBeenCalled();
    expect(plugin.get).not.toHaveBeenCalled();
  });
});
