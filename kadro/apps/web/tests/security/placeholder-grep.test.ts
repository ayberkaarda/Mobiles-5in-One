import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AllowEntry,
  formatScan,
  scanRepository,
} from '../../../../scripts/security/placeholder-grep';
import { REPOSITORY_ROOT, runScript } from './support/server';

/**
 * Phase gate "no placeholder tokens": `scripts/security/placeholder-grep.ts` finds none in the
 * source of apps/ and packages/ outside its allow-list, and it does find each token in a
 * temporary tree. The tokens are joined at run time so this file contains none of them.
 */

const workMarker = ['TO', 'DO'].join('');
const fixMarker = ['FIX', 'ME'].join('');
const tripleMarker = 'X'.repeat(3);
const filler = ['Lo', 'rem ipsum'].join('');
const templateValue = ['YOU', 'R_API_KEY'].join('');

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'kadro-placeholder-grep-'));
  const write = (relative: string, content: string | Buffer) => {
    const file = path.join(fixtureRoot, relative);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary fixture tree
    mkdirSync(path.dirname(file), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary fixture tree
    writeFileSync(file, content);
  };
  // Scanned and matching, one token per file.
  write('apps/web/src/a.ts', `// ${workMarker}: later\n`);
  write('apps/web/src/b.tsx', `// ${fixMarker} this\n`);
  write('packages/db/src/c.ts', `// ${tripleMarker} hack\n`);
  write('packages/ui/src/d.css', `/* ${filler} */\n`);
  write('apps/mobile/app.json', `{ "key": "${templateValue}" }\n`);
  // Scanned and clean: look-alikes that are not tokens.
  write('apps/web/src/clean.ts', 'const todos = []; const mixed = "axxxb"; const your_x = 1;\n');
  // Skipped: documentation and files outside the scanned roots, lockfiles, dependencies, build
  // output, binary files and extensions that are not source.
  write('docs/notes.md', `${workMarker} ${filler}\n`);
  write('scripts/tool.ts', `// ${workMarker}\n`);
  write('apps/web/README.md', `${workMarker}\n`);
  write('apps/web/pnpm-lock.yaml', `${workMarker}\n`);
  write('apps/web/node_modules/pkg/index.js', `// ${workMarker}\n`);
  write('apps/web/.next/server/chunk.js', `// ${fixMarker}\n`);
  write('packages/db/dist/index.js', `// ${tripleMarker}\n`);
  write('packages/brand/logo.ts', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(workMarker)]));
  write('packages/brand/fonts/face.woff2', Buffer.from(workMarker));
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('placeholder-grep on the repository', () => {
  it('finds nothing outside the allow-list and no stale allow-list entry', () => {
    const result = scanRepository(REPOSITORY_ROOT);
    expect(result.filesScanned).toBeGreaterThan(100);
    expect(formatScan({ ...result, allowed: [] })).toMatch(/^placeholder-grep: clean/);
    expect(result.findings).toEqual([]);
    expect(result.staleAllowEntries).toEqual([]);
  });

  it('exits with 0 from the command line', async () => {
    const run = await runScript('placeholder-grep.ts', [REPOSITORY_ROOT]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain('placeholder-grep: clean');
  });
});

describe('placeholder-grep on a temporary tree', () => {
  it('reports each token in scanned files and applies every exclusion', () => {
    const result = scanRepository(fixtureRoot, []);
    expect(result.findings.map((finding) => `${finding.path} ${finding.pattern}`).sort()).toEqual(
      [
        'apps/mobile/app.json template-prefix',
        'apps/web/src/a.ts work-marker',
        'apps/web/src/b.tsx work-marker',
        'packages/db/src/c.ts work-marker',
        'packages/ui/src/d.css filler-text',
      ].sort(),
    );
    // Six scanned text files: the five matching ones and the clean one.
    expect(result.filesScanned).toBe(6);
  });

  it('exits with 1 from the command line', async () => {
    const run = await runScript('placeholder-grep.ts', [fixtureRoot]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('FAIL apps/web/src/a.ts:1 matches work-marker');
  });

  it('allows only the exact file, pattern and line of an entry', () => {
    const entry: AllowEntry = {
      path: 'apps/web/src/a.ts',
      pattern: 'work-marker',
      lineContains: 'later',
      reason: 'test entry',
    };
    const result = scanRepository(fixtureRoot, [entry]);
    expect(result.allowed.map((finding) => finding.path)).toEqual(['apps/web/src/a.ts']);
    expect(result.findings.map((finding) => finding.path)).not.toContain('apps/web/src/a.ts');
    expect(result.findings).toHaveLength(4);

    const otherPattern = scanRepository(fixtureRoot, [{ ...entry, pattern: 'filler-text' }]);
    expect(otherPattern.findings.map((finding) => finding.path)).toContain('apps/web/src/a.ts');
  });

  it('fails on an allow-list entry that no longer matches', () => {
    const stale: AllowEntry = {
      path: 'apps/web/src/a.ts',
      pattern: 'work-marker',
      lineContains: 'a line that is not there',
      reason: 'test entry',
    };
    const result = scanRepository(fixtureRoot, [stale]);
    expect(result.staleAllowEntries).toEqual([stale]);
    expect(formatScan(result)).toContain('FAIL stale allow-list entry apps/web/src/a.ts');
  });
});
