/* eslint-disable security/detect-non-literal-fs-filename -- reads files of this package only */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { maestroArgs, parseEnvFile } from '../e2e/run-flows.mjs';
import {
  accountEmails,
  assertSafeEmail,
  E2E_ENV_KEYS,
  formatEnvFile,
  matchFormDate,
  newPassword,
  newRunId,
  psqlTarget,
  SEEDED_ROLES,
} from '../e2e/seed.mjs';

const MOBILE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAESTRO_ROOT = join(MOBILE_ROOT, '.maestro');
const ENV_KEYS = E2E_ENV_KEYS as readonly string[];

function filesUnder(directory: string, extensions: readonly string[]): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return filesUnder(path, extensions);
    }
    return extensions.some((extension) => entry.endsWith(extension)) ? [path] : [];
  });
}

const flowFiles = filesUnder(join(MAESTRO_ROOT, 'flows'), ['.yaml']);
const allMaestroFiles = filesUnder(MAESTRO_ROOT, ['.yaml']);
const source = [
  ...filesUnder(join(MOBILE_ROOT, 'app'), ['.tsx']),
  ...filesUnder(join(MOBILE_ROOT, 'src'), ['.tsx']),
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

/** Ids that a component derives from its own `testID` prop (`${testID}-${value}`, `-yes`). */
const DERIVED_IDS: Readonly<Record<string, string>> = {
  'rsvp-in': 'rsvp',
  'rsvp-maybe': 'rsvp',
  'venue-kind-text': 'venue-kind',
  'match-format-6v6': 'match-format',
  'profile-position-MID': 'profile-position',
  'deletion-continue-yes': 'deletion-continue',
  'deletion-submit-yes': 'deletion-submit',
};

function idsIn(text: string): string[] {
  return [...text.matchAll(/^\s+id: (\S+)$/gmu)].map((match) => match[1] ?? '');
}

describe('e2e seed helpers', () => {
  it('makes distinct example.com addresses per role and run', () => {
    const emails = accountEmails('ab12cd34') as Record<string, string>;
    expect(Object.keys(emails)).toEqual([...(SEEDED_ROLES as string[]), 'signup']);
    expect(new Set(Object.values(emails)).size).toBe(Object.keys(emails).length);
    for (const email of Object.values(emails)) {
      expect(assertSafeEmail(email)).toBe(email);
    }
  });

  it('refuses addresses that could change the SQL text', () => {
    expect(() => assertSafeEmail("x'); DROP TABLE users; --@example.com")).toThrow();
    expect(() => assertSafeEmail('someone@kadro.app')).toThrow();
  });

  it('builds the run id and password from the given random bytes', () => {
    expect(newRunId(Buffer.from([1, 2, 3, 255]))).toBe('010203ff');
    const password = newPassword(Buffer.alloc(15, 7)) as string;
    expect(password).toMatch(/^Kd-[A-Za-z0-9_-]{20}-9a$/u);
  });

  it('formats dates in the match form input format', () => {
    expect(matchFormDate(new Date(2026, 0, 5, 9, 7))).toEqual({
      date: '05.01.2026',
      time: '09:07',
    });
  });

  it('round-trips the env file and rejects line breaks', () => {
    const text = formatEnvFile({ E2E_RUN_ID: 'r1', E2E_PASSWORD: 'p=q' }) as string;
    expect(parseEnvFile(text)).toEqual({ E2E_RUN_ID: 'r1', E2E_PASSWORD: 'p=q' });
    expect(() => formatEnvFile({ E2E_RUN_ID: 'a\nB=c' })).toThrow();
    expect(() => formatEnvFile({ lower: 'x' })).toThrow();
  });

  it('reaches psql through compose by default or through a named container', () => {
    expect(psqlTarget(undefined)).toEqual(['compose', 'exec', '-T', 'postgres']);
    expect(psqlTarget('kadro-db')).toEqual(['exec', 'kadro-db']);
    expect(() => psqlTarget('x; rm -rf /')).toThrow();
  });

  it('passes every seeded value to maestro and defaults to the whole workspace', () => {
    const args = maestroArgs({ E2E_RUN_ID: 'r1' }, []) as string[];
    expect(args.slice(0, 3)).toEqual(['test', '-e', 'E2E_RUN_ID=r1']);
    expect(args.at(-1)).toBe('.maestro');
    expect((maestroArgs({}, ['.maestro/flows/rsvp.yaml']) as string[]).at(-1)).toBe(
      '.maestro/flows/rsvp.yaml',
    );
  });
});

describe('Maestro workspace', () => {
  it('lists every flow once in the execution order, under its own file name', () => {
    const config = readFileSync(join(MAESTRO_ROOT, 'config.yaml'), 'utf8');
    const order = [...config.matchAll(/^ {4}- (\S+)$/gmu)].map((match) => match[1]);
    const names = flowFiles.map((path) => {
      const name = /^name: (\S+)$/mu.exec(readFileSync(path, 'utf8'))?.[1];
      expect(path.endsWith(`${String(name)}.yaml`)).toBe(true);
      return name;
    });
    expect([...order].sort()).toEqual([...names].sort());
  });

  it('reads only values the seed script writes', () => {
    for (const path of allMaestroFiles) {
      const used = [...readFileSync(path, 'utf8').matchAll(/\$\{(E2E_[A-Z0-9_]+)\}/gu)];
      for (const match of used) {
        expect(ENV_KEYS, `${path}: ${String(match[1])}`).toContain(match[1]);
      }
    }
  });

  it('targets test ids that exist in the app', () => {
    for (const path of allMaestroFiles) {
      for (const id of idsIn(readFileSync(path, 'utf8'))) {
        const dynamic = /^([a-z-]+-)\$\{E2E_[A-Z0-9_]+\}$/u.exec(id);
        if (dynamic !== null) {
          expect(source, `${path}: ${id}`).toContain(`\`${String(dynamic[1])}\${`);
        } else if (id.startsWith('tab-')) {
          expect(source, `${path}: ${id}`).toContain(`name: '${id.slice('tab-'.length)}'`);
        } else {
          const literal = DERIVED_IDS[id] ?? id;
          expect(source, `${path}: ${id}`).toMatch(
            // eslint-disable-next-line security/detect-non-literal-regexp -- ids are [a-z-] from the flow files
            new RegExp(`testID(=|: )["'{]?${literal}["'}]`, 'u'),
          );
        }
      }
    }
  });
});
