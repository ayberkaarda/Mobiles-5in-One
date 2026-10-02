import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MATCH_STATUSES,
  RSVP_CHOICES,
  RSVP_STATUSES,
} from '../../../packages/contracts/src/matches';
import { type MatchValidationKey } from '../src/matches/form';
import { createTestI18n, translationFile } from './support/i18n';

interface Tree {
  [key: string]: string | Tree;
}

function load(language: 'tr' | 'en'): Tree {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path under src/i18n
  return JSON.parse(readFileSync(translationFile(language, 'matches'), 'utf8')) as Tree;
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
const SRC_DIR = fileURLToPath(new URL('../src/matches/', import.meta.url));

function sourceFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed directories of this package
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
    .map((file) => path.join(directory, file));
}

/** Literal keys passed to the `matches` translator of the match screens (`t('a.b')`). */
function literalKeys(): string[] {
  const files = [
    ...sourceFiles(SRC_DIR),
    ...sourceFiles(APP_DIR).filter(
      // The match routes under `takim/[id]/mac` and the tab; `mac/[code]` is the team invite.
      (file) =>
        file.includes(path.join('takim', '[id]', 'mac')) ||
        file.includes(path.join('(tabs)', 'maclar')),
    ),
  ];
  const keys = new Set<string>();
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- files listed above
    const source = readFileSync(file, 'utf8');
    // `t(` and `tm(` are bound to the matches namespace in these files.
    for (const match of source.matchAll(/\b(?:t|tm)\('([a-zA-Z]+\.[a-zA-Z.]+)'/g)) {
      keys.add(match[1] ?? '');
    }
  }
  return [...keys].filter((key) => !key.startsWith('tabs.') && !key.startsWith('matches.'));
}

describe('matches copy', () => {
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

  it('covers every validation key, status and RSVP value the screens look up', () => {
    const validation: MatchValidationKey[] = [
      'validation.venueTextTooShort',
      'validation.venueTextTooLong',
      'validation.venueTextInvalid',
      'validation.venueRequired',
      'validation.dateInvalid',
      'validation.timeInvalid',
      'validation.startsInPast',
      'validation.slotsInvalid',
      'validation.feeInvalid',
      'validation.feeTooHigh',
      'validation.searchTooShort',
      'validation.searchTooLong',
      'validation.searchInvalid',
    ];
    for (const key of validation) {
      expect(tr[key], key).toBeDefined();
    }
    for (const status of MATCH_STATUSES) {
      expect(tr[`status.${status}`], status).toBeDefined();
    }
    for (const status of RSVP_STATUSES) {
      expect(tr[`rsvp.state.${status}`], status).toBeDefined();
      expect(tr[`participants.status.${status}`], status).toBeDefined();
    }
    for (const choice of RSVP_CHOICES) {
      expect(tr[`rsvp.choice.${choice}`], choice).toBeDefined();
    }
  });

  it('has every literal key the match screens use', () => {
    const used = literalKeys();
    // Teams-namespace keys are looked up through `tt` and are not part of this list.
    expect(used.length).toBeGreaterThan(50);
    for (const key of used) {
      expect(tr[key], key).toBeDefined();
    }
  });

  it('is loaded as the matches namespace in both languages', () => {
    expect(createTestI18n('tr').t('matches:rsvp.choice.in')).toBe('Geliyorum');
    expect(createTestI18n('en').t('matches:rsvp.choice.in')).toBe("I'm in");
  });
});
