import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type i18n as I18n } from 'i18next';

import { createI18n } from '../../src/i18n/create-i18n';
import { buildResources, type Language, LANGUAGES, type Resources } from '../../src/i18n/resources';

export const I18N_DIR = fileURLToPath(new URL('../../src/i18n/', import.meta.url));

export function translationFile(language: Language, namespace: string): string {
  return path.join(I18N_DIR, language, `${namespace}.json`);
}

/**
 * The JSON files present under `src/i18n`, keyed like the Metro context in `bundled.ts`
 * (`./tr/common.json`), so tests load exactly what the app bundles.
 */
export function readTranslationFiles(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const language of LANGUAGES) {
    const directory = path.join(I18N_DIR, language);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path under the fixed src/i18n directory
    if (!existsSync(directory)) {
      continue;
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path under the fixed src/i18n directory
    for (const file of readdirSync(directory)) {
      if (file.endsWith('.json')) {
        files[`./${language}/${file}`] = JSON.parse(
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- path under the fixed src/i18n directory
          readFileSync(path.join(directory, file), 'utf8'),
        ) as unknown;
      }
    }
  }
  return files;
}

export function appResources(): Resources {
  return buildResources(readTranslationFiles());
}

export function createTestI18n(language: Language = 'tr', resources = appResources()): I18n {
  return createI18n(resources, language);
}
