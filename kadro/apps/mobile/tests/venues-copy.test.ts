import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { VENUE_FEATURES } from '../../../packages/contracts/src/venues';
import { type SearchValidationKey, type VenueValidationKey } from '../src/venues/form';
import { createTestI18n, translationFile } from './support/i18n';

interface Tree {
  [key: string]: string | Tree;
}

function load(language: 'tr' | 'en'): Tree {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path under src/i18n
  return JSON.parse(readFileSync(translationFile(language, 'venues'), 'utf8')) as Tree;
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

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../src/venues/', import.meta.url));

function sourceFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed directories of this package
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
    .map((file) => path.join(directory, file));
}

/** Literal keys passed to the `venues` translator (`t('a.b')`) of the venue screens. */
function literalKeys(): string[] {
  const files = [
    ...sourceFiles(SRC_DIR),
    ...sourceFiles(APP_DIR).filter(
      (file) =>
        file.includes(`${path.sep}saha${path.sep}`) ||
        file.includes(path.join('(tabs)', 'sahalar')),
    ),
  ];
  const keys = new Set<string>();
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- files listed above
    const source = readFileSync(file, 'utf8');
    // `t(` is bound to the venues namespace in these files (`tc(` is `common`).
    for (const match of source.matchAll(/\bt\(\s*'([a-zA-Z]+\.[a-zA-Z_.]+)'/g)) {
      keys.add(match[1] ?? '');
    }
  }
  return [...keys];
}

describe('venue copy', () => {
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

  it('covers every value the screens look up by key', () => {
    const validation: (VenueValidationKey | SearchValidationKey)[] = [
      'validation.nameTooShort',
      'validation.nameTooLong',
      'validation.textInvalid',
      'validation.districtRequired',
      'validation.locationInvalid',
      'validation.addressTooLong',
      'validation.phoneInvalid',
      'validation.indoorRequired',
      'validation.priceInvalid',
      'validation.priceTooHigh',
      'validation.priceOrder',
      'validation.ratingRequired',
      'validation.reviewTooLong',
      'validation.reviewInvalid',
      'validation.searchTooShort',
      'validation.searchTooLong',
      'validation.searchInvalid',
    ];
    const keys = [
      ...validation,
      ...VENUE_FEATURES.map((feature) => `feature.${feature}`),
      ...['yes', 'no', 'unknown'].map((choice) => `add.featureChoice.${choice}`),
      ...['review_not_eligible', 'already_reviewed', 'venue_exists', 'email_unverified'].map(
        (code) => `errors.${code}`,
      ),
    ];
    for (const key of keys) {
      expect(tr[key], key).toBeDefined();
    }
  });

  it('has every literal key the venue screens use', () => {
    const used = literalKeys();
    expect(used.length).toBeGreaterThan(60);
    for (const key of used) {
      expect(tr[key], key).toBeDefined();
    }
  });

  it('labels sample rows with the [ÖRNEK] marker in both languages', () => {
    expect(tr['badge.sample']).toContain('[ÖRNEK]');
    expect(en['badge.sample']).toContain('[ÖRNEK]');
  });

  it('is loaded as the venues namespace in both languages', () => {
    expect(createTestI18n('tr').t('venues:matchHere.label')).toBe('Bu sahada maç kur');
    expect(createTestI18n('en').t('venues:matchHere.label')).toBe('Set up a match here');
  });
});
