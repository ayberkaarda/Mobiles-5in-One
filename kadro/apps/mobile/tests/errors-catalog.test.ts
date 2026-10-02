import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '../../../packages/contracts/src/problem';
import { LANGUAGES } from '../src/i18n';
import { CLIENT_ERROR_KEYS } from '../src/i18n/error-copy';
import { translationFile } from './support/i18n';

/**
 * Differences between an errors catalog and the contract: every `ERROR_CODES` entry needs a
 * non-empty message; besides the codes only the named client-side keys (`CLIENT_ERROR_KEYS`)
 * are allowed, and they need a message too.
 */
function catalogProblems(catalog: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  for (const key of [...ERROR_CODES, ...CLIENT_ERROR_KEYS]) {
    const message = catalog[key];
    if (typeof message !== 'string' || message.trim() === '') {
      problems.push(`missing message for ${key}`);
    }
  }
  const allowed: ReadonlySet<string> = new Set([...ERROR_CODES, ...CLIENT_ERROR_KEYS]);
  for (const key of Object.keys(catalog)) {
    if (!allowed.has(key)) {
      problems.push(`unknown key ${key}`);
    }
  }
  return problems;
}

function placeholders(message: unknown): string[] {
  return typeof message === 'string'
    ? [...message.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1] ?? '').sort()
    : [];
}

/** Key set and `{{placeholder}}` differences between the Turkish and English catalogs. */
function parityProblems(
  tr: Readonly<Record<string, unknown>>,
  en: Readonly<Record<string, unknown>>,
): string[] {
  const problems: string[] = [];
  const keys = new Set([...Object.keys(tr), ...Object.keys(en)]);
  for (const key of keys) {
    if (!(key in tr) || !(key in en)) {
      problems.push(`key ${key} is not in both languages`);
      continue;
    }
    if (placeholders(tr[key]).join(',') !== placeholders(en[key]).join(',')) {
      problems.push(`placeholders of ${key} differ`);
    }
  }
  return problems;
}

/**
 * Shape of the delivered catalogs (`feat/mobile-error-copy`): one message per code, the six
 * client-side keys, and `{{seconds}}` in `rate_limited`.
 */
function fixtureCatalog(language: 'tr' | 'en'): Record<string, string> {
  return Object.fromEntries([
    ...ERROR_CODES.map((code) => [
      code,
      code === 'rate_limited' ? `${language} {{seconds}}` : `${language} copy for ${code}`,
    ]),
    ...CLIENT_ERROR_KEYS.map((key) => [key, `${language} copy for ${key}`]),
  ]);
}

describe('errors catalog check', () => {
  it('names exactly the six client-side keys', () => {
    expect([...CLIENT_ERROR_KEYS].sort()).toEqual([
      'network_error',
      'offline',
      'server_error',
      'session_expired',
      'timeout',
      'unknown',
    ]);
  });

  it('accepts the delivered shape: every code plus the client-side keys', () => {
    expect(catalogProblems(fixtureCatalog('tr'))).toEqual([]);
    expect(parityProblems(fixtureCatalog('tr'), fixtureCatalog('en'))).toEqual([]);
  });

  it('reports missing, empty and unlisted entries', () => {
    const { match_full: _code, offline: _client, ...rest } = fixtureCatalog('tr');
    expect(catalogProblems({ ...rest, not_found: ' ', made_up_code: 'x' })).toEqual([
      'missing message for not_found',
      'missing message for match_full',
      'missing message for offline',
      'unknown key made_up_code',
    ]);
  });

  it('reports keys or placeholders that differ between Turkish and English', () => {
    const en = { ...fixtureCatalog('en'), rate_limited: 'Try again later.' };
    const { timeout: _missing, ...tr } = fixtureCatalog('tr');
    expect(parityProblems(tr, en)).toEqual([
      'placeholders of rate_limited differ',
      'key timeout is not in both languages',
    ]);
  });
});

/**
 * `KADRO_REQUIRE_ERROR_CATALOG=1` makes a missing catalog a failure (delivery gate, ADR-0048).
 * Without it a missing catalog is reported as skipped, never as passed.
 */
// eslint-disable-next-line no-restricted-properties -- test switch read by the test runner only
const catalogRequired = process.env.KADRO_REQUIRE_ERROR_CATALOG === '1';

function readCatalog(file: string): Record<string, unknown> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path under the fixed src/i18n directory
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/**
 * Product spec §6 item 13: every problem `code` the API can return has localized copy in
 * `src/i18n/<language>/errors.json`; the only other keys are the client-side ones.
 */
describe('errors.json', () => {
  const files = { tr: translationFile('tr', 'errors'), en: translationFile('en', 'errors') };
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path under the fixed src/i18n directory
  const present = { tr: existsSync(files.tr), en: existsSync(files.en) };

  for (const language of LANGUAGES) {
    const title = `${language}: one non-empty message per ERROR_CODES entry and client-side key`;
    if (!present[language] && !catalogRequired) {
      it.skip(`${title} (src/i18n/${language}/errors.json not delivered yet)`, () => undefined);
      continue;
    }
    it(title, () => {
      expect(present[language], `src/i18n/${language}/errors.json is missing`).toBe(true);
      expect(catalogProblems(readCatalog(files[language]))).toEqual([]);
    });
  }

  const parityTitle = 'tr and en have the same keys and placeholders';
  if (!(present.tr && present.en) && !catalogRequired) {
    it.skip(`${parityTitle} (catalogs not delivered yet)`, () => undefined);
  } else {
    it(parityTitle, () => {
      expect(present.tr && present.en, 'both errors.json files are required').toBe(true);
      expect(parityProblems(readCatalog(files.tr), readCatalog(files.en))).toEqual([]);
    });
  }
});
