import { createStore, type StoreApi } from 'zustand/vanilla';

import { type ColorPreference, type ColorSchemeName, theming } from './tokens';

/**
 * AsyncStorage key of the colour scheme chosen in Ayarlar (`theming.storageKey`). A device
 * preference, not account data: it holds only `system`, `light` or `dark`, so it is not cleared at
 * sign-out.
 */
export const COLOR_SCHEME_STORAGE_KEY: string = theming.storageKey;

/** The three choices in display order: Sistem, Açık, Koyu. */
export const COLOR_PREFERENCES: readonly ColorPreference[] = theming.preferences;

export const DEFAULT_COLOR_PREFERENCE: ColorPreference = theming.defaultPreference;

export interface PreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function isColorPreference(value: unknown): value is ColorPreference {
  return typeof value === 'string' && (COLOR_PREFERENCES as readonly string[]).includes(value);
}

/**
 * The scheme to render: `light` and `dark` pin it; `system` follows the device appearance, and a
 * device that reports no preference (`null`, `unspecified`) gets the light scheme.
 */
export function resolveColorScheme(
  preference: ColorPreference,
  system: string | null | undefined,
): ColorSchemeName {
  if (preference !== 'system') {
    return preference;
  }
  return system === 'dark' ? 'dark' : 'light';
}

export interface ColorPreferenceState {
  readonly preference: ColorPreference;
  /** True once the stored choice has been read (or found missing / unreadable). */
  readonly restored: boolean;
}

export interface ColorPreferenceStore {
  readonly store: StoreApi<ColorPreferenceState>;
  /** Reads the stored choice; an unreadable or unknown value leaves `system`. */
  restore(): Promise<void>;
  /** Switches at once and remembers the choice; a storage failure keeps it for this run. */
  choose(preference: ColorPreference): Promise<void>;
}

export function createColorPreferenceStore(storage: PreferenceStorage): ColorPreferenceStore {
  const store = createStore<ColorPreferenceState>(() => ({
    preference: DEFAULT_COLOR_PREFERENCE,
    restored: false,
  }));
  return {
    store,
    async restore() {
      let stored: string | null = null;
      try {
        stored = await storage.getItem(COLOR_SCHEME_STORAGE_KEY);
      } catch {
        // Unreadable storage: follow the device appearance.
      }
      const current = store.getState();
      store.setState({
        // A choice made while the read was pending wins over the stored value.
        preference:
          current.restored || current.preference !== DEFAULT_COLOR_PREFERENCE
            ? current.preference
            : isColorPreference(stored)
              ? stored
              : DEFAULT_COLOR_PREFERENCE,
        restored: true,
      });
    },
    async choose(preference) {
      store.setState({ preference, restored: true });
      try {
        await storage.setItem(COLOR_SCHEME_STORAGE_KEY, preference);
      } catch {
        // Preference not saved; the scheme stays switched until the app restarts.
      }
    },
  };
}
