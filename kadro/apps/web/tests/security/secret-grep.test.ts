import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AllowEntry,
  formatScan,
  scanRepository,
} from '../../../../scripts/security/secret-grep';
import { REPOSITORY_ROOT, runScript } from './support/server';

/**
 * Security checklist item 1: `scripts/security/secret-grep.ts` finds no secret pattern in the
 * repository outside its allow-list, and it does find realistic look-alikes. The fixtures are
 * generated at run time in a temporary directory outside the repository and deleted afterwards;
 * no secret-shaped constant exists in this file.
 */

const AWS_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function awsKeyId(): string {
  const body = [...randomBytes(16)].map((byte) => AWS_ALPHABET[byte % 32] ?? 'A').join('');
  return ['AK', 'IA', body].join('');
}

function stripeStyleKey(): string {
  return ['s', 'k_', 'live_', randomBytes(18).toString('hex')].join('');
}

function privateKeyPem(): string {
  return generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'kadro-secret-grep-'));
  const write = (relative: string, content: string | Buffer) => {
    const file = path.join(fixtureRoot, relative);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary fixture tree
    mkdirSync(path.dirname(file), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary fixture tree
    writeFileSync(file, content);
  };
  write('src/config.ts', `export const key = '${stripeStyleKey()}';\n`);
  write('deploy/aws.ini', `aws_access_key_id = ${awsKeyId()}\n`);
  write('keys/server.pem', privateKeyPem());
  write('docs/notes.md', 'Masks and disks: mask_value, disk_size, risk_level are not keys.\n');
  // Skipped: dependencies, build output, Git-ignored local env files and binary files.
  write('node_modules/pkg/index.js', `module.exports = '${stripeStyleKey()}';\n`);
  write('apps/web/.next/server/chunk.js', `const k = '${awsKeyId()}';\n`);
  write('.env.local', `STRIPE_KEY=${stripeStyleKey()}\n`);
  write('assets/blob.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(awsKeyId())]));
  // Scanned: the documented example file.
  write('.env.example', `AWS_ACCESS_KEY_ID=${awsKeyId()}\n`);
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('secret-grep on the repository', () => {
  it('finds nothing outside the allow-list and no stale allow-list entry', () => {
    const result = scanRepository(REPOSITORY_ROOT);
    expect(result.filesScanned).toBeGreaterThan(100);
    expect(formatScan({ ...result, allowed: [] })).toMatch(/^secret-grep: clean/);
    expect(result.findings).toEqual([]);
    expect(result.staleAllowEntries).toEqual([]);
  });

  it('exits with 0 from the command line', async () => {
    const run = await runScript('secret-grep.ts', [REPOSITORY_ROOT]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain('secret-grep: clean');
  });
});

describe('secret-grep on generated look-alike secrets', () => {
  it('reports each pattern in scanned files and skips ignored locations', () => {
    const result = scanRepository(fixtureRoot, []);
    expect(result.findings.map((finding) => `${finding.path} ${finding.pattern}`).sort()).toEqual(
      [
        '.env.example aws-access-key-id',
        'deploy/aws.ini aws-access-key-id',
        'keys/server.pem private-key',
        'src/config.ts sk-prefix',
      ].sort(),
    );
  });

  it('exits with 1 from the command line', async () => {
    const run = await runScript('secret-grep.ts', [fixtureRoot]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('FAIL src/config.ts:1 matches sk-prefix');
  });

  it('allows only the exact file, pattern and line of an entry', () => {
    const entry: AllowEntry = {
      path: 'src/config.ts',
      pattern: 'sk-prefix',
      lineContains: 'export const key',
      reason: 'test entry',
    };
    const result = scanRepository(fixtureRoot, [entry]);
    expect(result.allowed.map((finding) => finding.path)).toEqual(['src/config.ts']);
    expect(result.findings.map((finding) => finding.path)).not.toContain('src/config.ts');
    expect(result.findings).toHaveLength(3);

    const otherPattern = scanRepository(fixtureRoot, [{ ...entry, pattern: 'aws-access-key-id' }]);
    expect(otherPattern.findings.map((finding) => finding.path)).toContain('src/config.ts');
  });

  it('fails on an allow-list entry that no longer matches', () => {
    const stale: AllowEntry = {
      path: 'src/config.ts',
      pattern: 'sk-prefix',
      lineContains: 'a line that is not there',
      reason: 'test entry',
    };
    const result = scanRepository(fixtureRoot, [stale]);
    expect(result.staleAllowEntries).toEqual([stale]);
    expect(formatScan(result)).toContain('FAIL stale allow-list entry src/config.ts');
  });
});
