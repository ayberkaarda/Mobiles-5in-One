import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '../../../packages/contracts/src/problem';
import { LANGUAGES } from '../src/i18n';
import { translationFile } from './support/i18n';

/**
 * Differences between an errors catalog and `ERROR_CODES`: codes without a non-empty message,
 * and keys that are not error codes.
 */
function catalogProblems(catalog: Readonly<Record<string, unknown>>): string[] {
  const problems: string[] = [];
  for (const code of ERROR_CODES) {
    const message = catalog[code];
    if (typeof message !== 'string' || message.trim() === '') {
      problems.push(`missing message for ${code}`);
    }
  }
  const known: ReadonlySet<string> = new Set(ERROR_CODES);
  for (const key of Object.keys(catalog)) {
    if (!known.has(key)) {
      problems.push(`unknown key ${key}`);
    }
  }
  return problems;
}

describe('errors catalog check', () => {
  const complete = Object.fromEntries(ERROR_CODES.map((code) => [code, `copy for ${code}`]));

  it('accepts a catalog with one message per code', () => {
    expect(catalogProblems(complete)).toEqual([]);
  });

  it('reports missing, empty and unknown entries', () => {
    const { match_full: _removed, ...withoutMatchFull } = complete;
    expect(catalogProblems({ ...withoutMatchFull, not_found: ' ', made_up_code: 'x' })).toEqual([
      'missing message for not_found',
      'missing message for match_full',
      'unknown key made_up_code',
    ]);
  });
});

/**
 * `KADRO_REQUIRE_ERROR_CATALOG=1` makes a missing catalog a failure (delivery gate, ADR-0048).
 * Without it a missing catalog is reported as skipped, never as passed.
 */
// eslint-disable-next-line no-restricted-properties -- test switch read by the test runner only
const catalogRequired = process.env.KADRO_REQUIRE_ERROR_CATALOG === '1';

/**
 * Product spec §6 item 13: every problem `code` the API can return has localized copy in
 * `src/i18n/<language>/errors.json`, and nothing else is in those files.
 */
describe.each(LANGUAGES)('errors.json (%s)', (language) => {
  const file = translationFile(language, 'errors');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path under the fixed src/i18n directory
  const present = existsSync(file);
  const title = 'has exactly one non-empty message for every ERROR_CODES entry';

  if (!present && !catalogRequired) {
    it.skip(`${title} (src/i18n/${language}/errors.json not delivered yet)`, () => undefined);
    return;
  }

  it(title, () => {
    expect(present, `src/i18n/${language}/errors.json is missing`).toBe(true);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path under the fixed src/i18n directory
    const catalog = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(catalogProblems(catalog)).toEqual([]);
  });
});
