import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LEGAL_PAGES } from '../src/settings/legal';
import { translationFile } from './support/i18n';

interface Tree {
  [key: string]: string | Tree;
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

function load(language: 'tr' | 'en', namespace: string): Record<string, string> {
  return flatten(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path under src/i18n
    JSON.parse(readFileSync(translationFile(language, namespace), 'utf8')) as Tree,
  );
}

const placeholders = (message: string): string =>
  [...message.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((match) => match[1] ?? '')
    .sort()
    .join(',');

/** Files of the profile and settings area whose `t('…')` calls use the `common` namespace. */
const COMMON_FILES = [
  '../app/(tabs)/profil/index.tsx',
  '../app/profil/duzenle.tsx',
  '../app/ayarlar/index.tsx',
  '../app/ayarlar/hesabi-sil.tsx',
  '../app/ayarlar/hesap-silindi.tsx',
  '../src/profile/components.tsx',
];

function literalKeys(): string[] {
  const keys = new Set<string>();
  for (const file of COMMON_FILES) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed files of this package
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
      keys.add(match[1] ?? '');
    }
    for (const match of source.matchAll(/'common:([a-zA-Z0-9_.]+)'/g)) {
      keys.add(match[1] ?? '');
    }
    for (const match of source.matchAll(/'(profileEdit\.photo[A-Za-z]+)'/g)) {
      keys.add(match[1] ?? '');
    }
  }
  return [...keys].sort();
}

describe('profile and settings copy', () => {
  const tr = load('tr', 'common');
  const en = load('en', 'common');

  it('has every key the screens use, in Turkish and English', () => {
    const keys = literalKeys();
    expect(keys.length).toBeGreaterThan(60);
    for (const key of keys) {
      expect(tr[key], `tr ${key}`).toBeTypeOf('string');
      expect(en[key], `en ${key}`).toBeTypeOf('string');
    }
  });

  it('has the keys built at run time', () => {
    const dynamic = [
      ...[
        'loading',
        'unavailable',
        'undetermined',
        'denied',
        'granted',
        'registered',
        'failed',
      ].map((state) => `settings.pushState.${state}`),
      ...LEGAL_PAGES.map((page) => `settings.legalPage.${page.key}`),
      ...[
        'reauth_required',
        'step_up_required',
        'deletion_pending',
        'last_admin',
        'rate_limited',
      ].map((code) => `deletion.errors.${code}`),
      'deletion.doneMessage',
      'deletion.doneCancel',
    ];
    for (const key of dynamic) {
      expect(tr[key], `tr ${key}`).toBeTypeOf('string');
      expect(en[key], `en ${key}`).toBeTypeOf('string');
    }
  });

  it('uses the same placeholders in both languages', () => {
    for (const [key, message] of Object.entries(tr)) {
      expect(placeholders(en[key] ?? ''), key).toBe(placeholders(message));
    }
  });

  it('labels the legal texts as samples', () => {
    expect(tr['settings.legalSample']).toMatch(/örnek/);
    expect(en['settings.legalSample']).toMatch(/sample/);
  });

  it('explains the cancel-by-sign-in rule on the sign-in screen in both languages', () => {
    const authTr = load('tr', 'auth');
    const authEn = load('en', 'auth');
    expect(authTr['signIn.deletionNote']).toMatch(/7 gün/);
    expect(authEn['signIn.deletionNote']).toMatch(/7 days/);
  });
});
