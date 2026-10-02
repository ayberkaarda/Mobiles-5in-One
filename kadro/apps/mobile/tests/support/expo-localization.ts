/** Test double of `expo-localization`: a Turkish device unless a test changes it. */
interface Locale {
  languageCode: string | null;
  languageTag: string;
}

let locales: [Locale, ...Locale[]] = [{ languageCode: 'tr', languageTag: 'tr-TR' }];

export function getLocales(): [Locale, ...Locale[]] {
  return locales;
}

export function __setLocales(next: [Locale, ...Locale[]]): void {
  locales = next;
}
