/**
 * i18next namespaces (product spec §8). Turkish is authored first and is the fallback; English
 * follows. Each namespace is one JSON file at `src/i18n/<language>/<namespace>.json`.
 */
export const NAMESPACES = [
  'common',
  'auth',
  'teams',
  'matches',
  'opencalls',
  'venues',
  'errors',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const LANGUAGES = ['tr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'tr';
export const DEFAULT_NAMESPACE: Namespace = 'common';

export interface TranslationTree {
  readonly [key: string]: string | TranslationTree;
}

export type Resources = Record<Language, Record<Namespace, TranslationTree>>;

const RESOURCE_PATH = /^\.?\/?(?<language>[a-z]{2})\/(?<namespace>[a-z]+)\.json$/;

function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

function isNamespace(value: string): value is Namespace {
  return (NAMESPACES as readonly string[]).includes(value);
}

function isTranslationTree(value: unknown): value is TranslationTree {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) => typeof entry === 'string' || isTranslationTree(entry),
  );
}

/**
 * Builds the resource table from the JSON files found for each language, keyed by their path
 * relative to `src/i18n` (`./tr/common.json`). Every namespace exists for every language: a file
 * that is not present yet becomes an empty namespace, so lookups fall back to the caller's
 * default copy instead of failing. Unknown files and malformed contents are ignored.
 */
export function buildResources(files: Readonly<Record<string, unknown>>): Resources {
  const resources = Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      Object.fromEntries(NAMESPACES.map((namespace) => [namespace, {}])),
    ]),
  ) as Record<Language, Record<Namespace, TranslationTree>>;

  for (const [path, contents] of Object.entries(files)) {
    const match = RESOURCE_PATH.exec(path);
    const language = match?.groups?.language;
    const namespace = match?.groups?.namespace;
    if (language === undefined || namespace === undefined) {
      continue;
    }
    if (!isLanguage(language) || !isNamespace(namespace)) {
      continue;
    }
    const tree = unwrapModule(contents);
    if (isTranslationTree(tree)) {
      // eslint-disable-next-line security/detect-object-injection -- keys narrowed to Language / Namespace above
      resources[language][namespace] = tree;
    }
  }
  return resources;
}

/** JSON modules may arrive as the object itself or wrapped in an ES module `default`. */
function unwrapModule(contents: unknown): unknown {
  if (
    typeof contents === 'object' &&
    contents !== null &&
    'default' in contents &&
    Object.keys(contents).length === 1
  ) {
    return (contents as { default: unknown }).default;
  }
  return contents;
}

/** Picks the first supported device language, Turkish otherwise. */
export function pickLanguage(deviceLanguageCodes: readonly (string | null)[]): Language {
  for (const code of deviceLanguageCodes) {
    if (code !== null && isLanguage(code)) {
      return code;
    }
  }
  return DEFAULT_LANGUAGE;
}
