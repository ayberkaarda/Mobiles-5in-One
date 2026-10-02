import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/api/errors';
import {
  buildResources,
  createI18n,
  errorMessage,
  LANGUAGES,
  NAMESPACES,
  pickLanguage,
} from '../src/i18n';
import { formatDateTime, formatPriceRange } from '../src/i18n/format';
import { appResources, readTranslationFiles } from './support/i18n';

interface Tree {
  readonly [key: string]: string | Tree;
}

function leafKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`),
  );
}

function leafValues(tree: Tree): string[] {
  return Object.values(tree).flatMap((value) =>
    typeof value === 'string' ? [value] : leafValues(value),
  );
}

describe('resource table', () => {
  it('registers every spec namespace for Turkish and English', () => {
    expect(NAMESPACES).toEqual([
      'common',
      'auth',
      'teams',
      'matches',
      'opencalls',
      'venues',
      'errors',
    ]);
    const resources = appResources();
    for (const language of LANGUAGES) {
      expect(Object.keys(resources[language]).sort()).toEqual([...NAMESPACES].sort());
    }
  });

  it('keeps a namespace whose file is not present yet as an empty namespace', () => {
    const resources = buildResources({
      './tr/common.json': { error: { unknown: 'Beklenmeyen bir hata oluştu.' } },
    });
    expect(resources.tr.errors).toEqual({});
    expect(resources.en.common).toEqual({});
    const i18n = createI18n(resources, 'tr');
    // A lookup in the empty namespace degrades to the generic copy instead of failing.
    expect(
      errorMessage(i18n, new ApiError({ kind: 'problem', status: 404, code: 'not_found' })),
    ).toBe('Beklenmeyen bir hata oluştu.');
  });

  it('ignores unknown languages, unknown namespaces and malformed files', () => {
    const resources = buildResources({
      './de/common.json': { app: { name: 'Kadro' } },
      './tr/billing.json': { title: 'x' },
      './tr/teams.json': ['not', 'a', 'tree'],
      './tr/venues.json': { default: { title: 'Sahalar' } },
    });
    expect(resources.tr.teams).toEqual({});
    expect(resources.tr.venues).toEqual({ title: 'Sahalar' });
    expect(Object.keys(resources)).toEqual(['tr', 'en']);
  });

  it('has the same common keys in Turkish and English, none empty', () => {
    const files = readTranslationFiles();
    const tr = files['./tr/common.json'] as Tree;
    const en = files['./en/common.json'] as Tree;
    expect(leafKeys(en).sort()).toEqual(leafKeys(tr).sort());
    for (const value of [...leafValues(tr), ...leafValues(en)]) {
      expect(value.trim()).not.toBe('');
    }
  });
});

describe('language selection', () => {
  it('uses the first supported device language and defaults to Turkish', () => {
    expect(pickLanguage(['en', 'tr'])).toBe('en');
    expect(pickLanguage(['de', null, 'tr'])).toBe('tr');
    expect(pickLanguage(['fr'])).toBe('tr');
    expect(pickLanguage([])).toBe('tr');
  });

  it('serves Turkish copy and falls back to Turkish for a key missing in English', () => {
    const resources = appResources();
    const tr = createI18n(resources, 'tr');
    expect(tr.t('common:tabs.openCalls')).toBe('Eksik Var');
    const en = createI18n(
      { ...resources, en: { ...resources.en, common: { tabs: { teams: 'Teams' } } } },
      'en',
    );
    expect(en.t('common:tabs.teams')).toBe('Teams');
    expect(en.t('common:tabs.openCalls')).toBe('Eksik Var');
  });
});

describe('errorMessage', () => {
  const resources = appResources();
  const i18n = createI18n(
    {
      ...resources,
      tr: { ...resources.tr, errors: { match_full: 'Maç dolu.' } },
    },
    'tr',
  );

  it('maps a problem code to the errors namespace', () => {
    const error = new ApiError({
      kind: 'problem',
      status: 409,
      code: 'match_full',
      requestId: 'r1',
    });
    expect(errorMessage(i18n, error)).toBe('Maç dolu.');
  });

  it('uses generic copy for a code without copy and for non-API errors', () => {
    const unknown = 'Beklenmeyen bir hata oluştu. Biraz sonra tekrar dene.';
    expect(
      errorMessage(i18n, new ApiError({ kind: 'problem', status: 500, code: 'brand_new' })),
    ).toBe(unknown);
    expect(errorMessage(i18n, new ApiError({ kind: 'problem', status: 502 }))).toBe(unknown);
    expect(errorMessage(i18n, new Error('render failure'))).toBe(unknown);
  });

  it('has dedicated copy for network failures and timeouts', () => {
    expect(errorMessage(i18n, new ApiError({ kind: 'network' }))).toBe(
      'Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.',
    );
    expect(errorMessage(i18n, new ApiError({ kind: 'timeout' }))).toBe(
      'Sunucu zamanında yanıt vermedi. Tekrar dene.',
    );
  });
});

describe('formatting', () => {
  it('formats lira from kuruş and price ranges', () => {
    expect(formatPriceRange(120_000, 180_000, 'tr')).toBe('₺1.200–₺1.800');
    expect(formatPriceRange(150_000, null, 'tr')).toBe('₺1.500');
    expect(formatPriceRange(null, null, 'tr')).toBeNull();
  });

  it('formats a match time with day and 24-hour clock', () => {
    const text = formatDateTime('2026-10-02T18:00:00Z', 'tr');
    expect(text).toMatch(/\d{2}:\d{2}/);
    expect(formatDateTime('not a date', 'tr')).toBe('');
  });
});
