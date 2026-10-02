import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  APPLICATION_STATUSES,
  OPEN_CALL_STATUSES,
} from '../../../packages/contracts/src/open-calls';
import { LEVELS, POSITIONS } from '../../../packages/contracts/src/users';
import { type CallValidationKey, EXPIRY_CHOICES } from '../src/calls/form';
import { type PublishBlocker } from '../src/calls/permissions';
import { createTestI18n, translationFile } from './support/i18n';

interface Tree {
  [key: string]: string | Tree;
}

function load(language: 'tr' | 'en'): Tree {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path under src/i18n
  return JSON.parse(readFileSync(translationFile(language, 'opencalls'), 'utf8')) as Tree;
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
const SRC_DIR = fileURLToPath(new URL('../src/calls/', import.meta.url));

function sourceFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed directories of this package
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
    .map((file) => path.join(directory, file));
}

/** Literal keys passed to the `opencalls` translator (`t('a.b')`) of the open-call screens. */
function literalKeys(): string[] {
  const files = [
    ...sourceFiles(SRC_DIR),
    ...sourceFiles(APP_DIR).filter(
      (file) =>
        file.includes(`${path.sep}ilan${path.sep}`) ||
        file.includes(path.join('(tabs)', 'eksik-var')),
    ),
  ];
  const keys = new Set<string>();
  for (const file of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- files listed above
    const source = readFileSync(file, 'utf8');
    // `t(` is bound to the opencalls namespace in these files (`tc(` is `common`).
    for (const match of source.matchAll(/\bt\('([a-zA-Z]+\.[a-zA-Z.]+)'/g)) {
      keys.add(match[1] ?? '');
    }
  }
  return [...keys];
}

describe('open-call copy', () => {
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
    const validation: CallValidationKey[] = [
      'validation.messageTooLong',
      'validation.messageInvalid',
      'validation.missingInvalid',
      'validation.expiryInvalid',
    ];
    const blockers: PublishBlocker[] = ['notStaff', 'proLocked', 'notOpen', 'tooLate', 'full'];
    const keys = [
      ...validation,
      ...blockers.map((blocker) => `publish.blocked.${blocker}`),
      ...EXPIRY_CHOICES.map((choice) => `publish.expiryChoice.${choice}`),
      ...APPLICATION_STATUSES.map((status) => `apply.state.${status}`),
      ...APPLICATION_STATUSES.map((status) => `application.status.${status}`),
      ...OPEN_CALL_STATUSES.filter((status) => status !== 'open').map(
        (status) => `manage.callStatus.${status}`,
      ),
      ...LEVELS.map((level) => `level.${level}`),
      ...POSITIONS.map((position) => `position.${position}`),
      'level.any',
      'position.any',
    ];
    for (const key of keys) {
      expect(tr[key], key).toBeDefined();
    }
  });

  it('has every literal key the open-call screens use', () => {
    const used = literalKeys();
    expect(used.length).toBeGreaterThan(60);
    for (const key of used) {
      expect(tr[key], key).toBeDefined();
    }
  });

  it('is loaded as the opencalls namespace in both languages', () => {
    expect(createTestI18n('tr').t('opencalls:apply.submit')).toBe('Başvur');
    expect(createTestI18n('en').t('opencalls:apply.submit')).toBe('Apply');
  });
});
