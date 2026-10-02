import { type i18n as I18n } from 'i18next';

import { type Language, LANGUAGES } from '../i18n/resources';

/**
 * AsyncStorage key of the language the user chose in the settings. A device preference, not
 * account data: it holds only `tr` or `en`, so it is not cleared at sign-out. Without it the app
 * follows the device language (ADR-0048).
 */
export const LANGUAGE_STORAGE_KEY = 'kadro.language';

export interface PreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** The language the app shows now (`tr` when i18next reports anything else). */
export function currentLanguage(i18n: I18n): Language {
  return isLanguage(i18n.language) ? i18n.language : 'tr';
}

/**
 * Switches the app language at once and remembers it. A storage failure keeps the switch for
 * this run (the choice is then lost at restart, nothing else breaks).
 */
export async function chooseLanguage(
  i18n: I18n,
  language: Language,
  storage: PreferenceStorage,
): Promise<void> {
  await i18n.changeLanguage(language);
  try {
    await storage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Preference not saved; the language stays switched until the app restarts.
  }
}

/** Applies the remembered language at start-up; an unreadable or unknown value is ignored. */
export async function restoreLanguage(i18n: I18n, storage: PreferenceStorage): Promise<void> {
  let stored: string | null = null;
  try {
    stored = await storage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return;
  }
  if (isLanguage(stored) && stored !== i18n.language) {
    await i18n.changeLanguage(stored);
  }
}
