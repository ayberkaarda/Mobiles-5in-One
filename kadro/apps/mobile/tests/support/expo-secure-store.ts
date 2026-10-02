/**
 * Test double of `expo-secure-store`: an in-memory keychain. Tests read `secureStoreContents()`
 * to assert what was written and with which options.
 */
interface StoredItem {
  readonly value: string;
  readonly options: unknown;
}

const items = new Map<string, StoredItem>();

export const AFTER_FIRST_UNLOCK = 0;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;
export const WHEN_UNLOCKED = 5;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;

export async function getItemAsync(key: string): Promise<string | null> {
  return items.get(key)?.value ?? null;
}

export async function setItemAsync(key: string, value: string, options?: unknown): Promise<void> {
  items.set(key, { value, options });
}

export async function deleteItemAsync(key: string): Promise<void> {
  items.delete(key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export function secureStoreContents(): ReadonlyMap<string, StoredItem> {
  return items;
}

export function resetSecureStore(): void {
  items.clear();
}
