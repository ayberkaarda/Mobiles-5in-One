import type { contribTr } from './contrib.tr';
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
/** Shape of the lazily loaded sign-in and contributor copy (`contrib.tr.ts`). */
export type ContribTranslation = Widen<typeof contribTr>;

/**
 * A count-dependent text: `Intl.PluralRules` picks the form (`one` for 1 in both languages,
 * `other` otherwise). Turkish uses the same words for both; English does not.
 */
export interface PluralForms {
  readonly one: string;
  readonly other: string;
}

type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? never
      : `${K}.${KeyPaths<T[K]>}`;
}[keyof T & string];

type PluralPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? never
    : T[K] extends PluralForms
      ? K
      : `${K}.${PluralPaths<T[K]>}`;
}[keyof T & string];

/** Every valid translation key, for example `tabs.search` or `fare.free`. */
export type TranslationKey = KeyPaths<typeof tr> | KeyPaths<typeof contribTr>;
/** Keys of count-dependent texts, used with the `tp` pipe or `LanguageService.tp()`. */
export type PluralKey = PluralPaths<typeof tr> | PluralPaths<typeof contribTr>;

/** Values for {{name}} placeholders. */
export type TranslationParams = Record<string, unknown>;
