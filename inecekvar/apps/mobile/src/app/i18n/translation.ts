import { tr } from './tr';

export const AVAILABLE_LANGS = ['tr', 'en'] as const;
export type AppLang = (typeof AVAILABLE_LANGS)[number];
export const DEFAULT_LANG: AppLang = 'tr';

export function isAppLang(value: unknown): value is AppLang {
  return typeof value === 'string' && (AVAILABLE_LANGS as readonly string[]).includes(value);
}

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape every language file must have: the Turkish keys with any string values. */
export type Translation = Widen<typeof tr>;

type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${KeyPaths<T[K]>}`;
}[keyof T & string];

/** Every valid translation key, for example `tabs.search` or `fare.free`. */
export type TranslationKey = KeyPaths<typeof tr>;

/** Values for {{name}} placeholders. */
export type TranslationParams = Record<string, unknown>;
