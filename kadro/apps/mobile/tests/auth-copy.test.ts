import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { type ValidationKey, VALIDATION_PARAMS } from '../src/auth/validation';
import { LANGUAGES } from '../src/i18n';
import { createTestI18n, translationFile } from './support/i18n';

interface Tree {
  [key: string]: string | Tree;
}

function load(language: 'tr' | 'en'): Tree {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path under src/i18n
  return JSON.parse(readFileSync(translationFile(language, 'auth'), 'utf8')) as Tree;
}

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[`${prefix}${key}`, value]]
        : Object.entries(flatten(value, `${prefix}${key}.`)),
    ),
  );
}

const placeholders = (message: string): string =>
  [...message.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((match) => match[1] ?? '')
    .sort()
    .join(',');

describe('auth copy', () => {
  const tr = flatten(load('tr'));
  const en = flatten(load('en'));

  it('has the same keys and placeholders in Turkish and English', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    for (const key of Object.keys(tr)) {
      expect(placeholders(en[key] ?? ''), key).toBe(placeholders(tr[key] ?? ''));
    }
  });

  it('has no empty message', () => {
    for (const [key, message] of [...Object.entries(tr), ...Object.entries(en)]) {
      expect(message.trim(), key).not.toBe('');
    }
  });

  it('covers every validation key the form checks can return', () => {
    const keys: ValidationKey[] = [
      'validation.emailRequired',
      'validation.emailInvalid',
      'validation.passwordRequired',
      'validation.passwordTooShort',
      'validation.passwordTooLong',
      'validation.displayNameTooShort',
      'validation.displayNameTooLong',
      'validation.displayNameInvalid',
    ];
    for (const language of LANGUAGES) {
      const i18n = createTestI18n(language);
      for (const key of keys) {
        expect(i18n.exists(`auth:${key}`, { lng: language }), `${language} ${key}`).toBe(true);
        // Every placeholder of the message is supplied by VALIDATION_PARAMS.
        expect(i18n.t(`auth:${key}`, { ...VALIDATION_PARAMS, lng: language })).not.toMatch(/\{\{/);
      }
    }
  });

  it('adds no key to the error catalog namespace', () => {
    // API failures are worded by `errors.json` alone; this package of screens adds nothing there.
    expect(Object.keys(tr).some((key) => key.startsWith('errors.'))).toBe(false);
  });
});
