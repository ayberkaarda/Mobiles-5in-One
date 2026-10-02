import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { REPOSITORY_ROOT } from './support/server';

/**
 * Security checklist item 15, "grep for `sql.raw(` shows only reviewed, parameter-free DDL":
 * application and package sources contain no `sql.raw(` call at all (migrations are SQL files,
 * not runtime strings), and the ESLint rule that bans interpolated or concatenated `sql.raw()`
 * is active for every workspace.
 */

const SOURCE_ROOTS = ['apps', 'packages'];
const SKIPPED = new Set(['node_modules', 'dist', '.next', '.turbo', '.expo', 'coverage']);
const SOURCE_FILE = /\.(ts|tsx|js|mjs|cjs)$/;

/** Reviewed `sql.raw(` call sites (`path:line`); empty while no source needs one. */
const REVIEWED_SQL_RAW: readonly string[] = [];

function sourceFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks the repository's own source tree
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED.has(entry.name) ? [] : sourceFiles(full);
    }
    return SOURCE_FILE.test(entry.name) ? [full] : [];
  });
}

describe('sql.raw usage (§6 item 15)', () => {
  it('has no sql.raw( call outside the reviewed list', () => {
    const calls: string[] = [];
    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(path.join(REPOSITORY_ROOT, root))) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- file inside the repository
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, index) => {
          if (/\bsql\s*\.\s*raw\s*\(/.test(line) && !file.endsWith('sql-raw.test.ts')) {
            calls.push(
              `${path.relative(REPOSITORY_ROOT, file).replaceAll('\\', '/')}:${index + 1}`,
            );
          }
        });
      }
    }
    expect(calls).toEqual(REVIEWED_SQL_RAW);
  });

  it('fails lint for interpolated or concatenated sql.raw() anywhere in the workspace', async () => {
    const eslint = new ESLint({ cwd: REPOSITORY_ROOT });
    const code = [
      "import { sql } from 'drizzle-orm';",
      'export const byTemplate = (id: string) => sql.raw(`select * from users where id = ${id}`);',
      "export const byConcat = (id: string) => sql.raw('select * from users where id = ' + id);",
      '',
    ].join('\n');
    for (const filePath of ['packages/db/src/probe.ts', 'apps/web/lib/server/probe.ts']) {
      const [result] = await eslint.lintText(code, {
        filePath: path.join(REPOSITORY_ROOT, filePath),
      });
      const banned = (result?.messages ?? []).filter(
        (message) => message.ruleId === 'no-restricted-syntax',
      );
      expect(
        banned.map((message) => message.line),
        filePath,
      ).toEqual([2, 3]);
    }
  });
});
