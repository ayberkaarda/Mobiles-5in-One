/**
 * Test double of `@react-native-async-storage/async-storage` that enforces threat model T-MOB-01:
 * AsyncStorage is unencrypted, so no credential may ever be written to it. Every write is
 * inspected; a key that names a credential, or a value that contains a token a test registered
 * with `registerSecret`, is recorded as a violation and `tests/setup.ts` fails the test.
 */
const items = new Map<string, string>();
const secrets = new Set<string>();
const violations: string[] = [];

const CREDENTIAL_KEY = /token|secret|password|authorization|session|credential/i;

function inspect(key: string, value: string): void {
  if (CREDENTIAL_KEY.test(key)) {
    violations.push(`AsyncStorage key "${key}" names a credential`);
  }
  for (const secret of secrets) {
    if (value.includes(secret) || key.includes(secret)) {
      violations.push(`AsyncStorage write to "${key}" contains a registered token`);
    }
  }
}

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return items.get(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    inspect(key, value);
    items.set(key, value);
  },
  async mergeItem(key: string, value: string): Promise<void> {
    inspect(key, value);
    items.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    items.delete(key);
  },
  async getAllKeys(): Promise<string[]> {
    return [...items.keys()];
  },
  async multiGet(keys: readonly string[]): Promise<[string, string | null][]> {
    return keys.map((key) => [key, items.get(key) ?? null]);
  },
  async multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
    for (const [key, value] of pairs) {
      inspect(key, value);
      items.set(key, value);
    }
  },
  async multiRemove(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      items.delete(key);
    }
  },
  async clear(): Promise<void> {
    items.clear();
  },
};

export default AsyncStorage;

/** Marks a token value; any later AsyncStorage write containing it is a violation. */
export function registerSecret(value: string): void {
  secrets.add(value);
}

export function asyncStorageContents(): ReadonlyMap<string, string> {
  return items;
}

/** Returns and clears the violations recorded since the last call. */
export function takeAsyncStorageViolations(): string[] {
  return violations.splice(0, violations.length);
}

export function resetAsyncStorage(): void {
  items.clear();
  secrets.clear();
  violations.length = 0;
}
