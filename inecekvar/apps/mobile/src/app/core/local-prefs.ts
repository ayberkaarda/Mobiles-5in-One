/**
 * Small wrapper around localStorage for non-sensitive preferences (theme, language, guest
 * favourites). Storage can be missing or throw (private mode, blocked site data), so every
 * access is guarded and the app falls back to defaults.
 */
export const PREF_KEYS = {
  theme: 'iv.theme',
  lang: 'iv.lang',
  favorites: 'iv.favorites',
} as const;

export type PrefKey = (typeof PREF_KEYS)[keyof typeof PREF_KEYS];

export function readPref(key: PrefKey): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writePref(key: PrefKey, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Preference stays in memory for this session.
  }
}
