import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { TEAM_ROLES } from '../../../packages/contracts/src/roles';
import { POSITIONS } from '../../../packages/contracts/src/users';
import { type TeamValidationKey } from '../src/teams/validation';
import { createTestI18n, translationFile } from './support/i18n';

interface Tree {
  [key: string]: string | Tree;
}

function load(language: 'tr' | 'en'): Tree {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path under src/i18n
  return JSON.parse(readFileSync(translationFile(language, 'teams'), 'utf8')) as Tree;
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

describe('teams copy', () => {
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

  it('covers every validation key, position and role the screens look up', () => {
    const validation: TeamValidationKey[] = [
      'validation.nameTooShort',
      'validation.nameTooLong',
      'validation.nameInvalid',
    ];
    for (const key of validation) {
      expect(tr[key], key).toBeDefined();
    }
    for (const position of POSITIONS) {
      expect(tr[`member.position.${position}`], position).toBeDefined();
    }
    const i18n = createTestI18n('tr');
    for (const role of TEAM_ROLES) {
      expect(i18n.exists(`common:teams.role.${role}`), role).toBe(true);
    }
  });

  it('is loaded as the teams namespace in both languages', () => {
    expect(createTestI18n('tr').t('teams:invite.accept')).toBe('Takıma katıl');
    expect(createTestI18n('en').t('teams:invite.accept')).toBe('Join team');
  });
});
