/**
 * Security checklist item 1: the repository contains no Stripe-style secret key prefix, no PEM
 * private key block and no AWS access key id.
 *
 * Usage (Node.js 22.18 or newer runs TypeScript directly):
 *
 *   node scripts/security/secret-grep.ts [root]
 *
 * `root` defaults to the Kadro repository root (two levels above this file). Every text file is
 * scanned except dependency, build and cache directories and local `.env` files, which Git
 * ignores and which never reach the repository. Exit code 1 when a pattern matches outside the
 * allow-list, or when an allow-list entry no longer matches anything (stale entries are removed,
 * never kept "just in case").
 *
 * The patterns are written so this file does not match them itself.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SecretPattern {
  readonly id: string;
  readonly description: string;
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: 'sk-prefix',
    description: 'secret key prefix "s" + "k_" (Stripe-style keys)',
    regex: /(?<![A-Za-z0-9])s[k]_/,
  },
  {
    id: 'private-key',
    description: 'PEM private key block header',
    regex: /BEGIN [A-Z ]*PRIVATE[ ]KEY/,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key id prefix',
    regex: /(?<![A-Za-z0-9])A[K]IA/,
  },
];

export interface AllowEntry {
  /** Path relative to the scanned root, with forward slashes. */
  readonly path: string;
  readonly pattern: SecretPattern['id'];
  /** The matching line must contain this text; keeps the entry to one known line. */
  readonly lineContains: string;
  readonly reason: string;
}

/**
 * Narrow, explicit exceptions. Each entry names one file, one pattern and one line, and must keep
 * matching: a stale entry fails the scan.
 */
export const ALLOWLIST: readonly AllowEntry[] = [
  {
    path: '01-kadro-react-native-expo.md',
    pattern: 'sk-prefix',
    lineContains: 'Anahtarları çıkar',
    reason: 'The specification lists the search patterns of checklist item 1.',
  },
  {
    path: '01-kadro-react-native-expo.md',
    pattern: 'private-key',
    lineContains: 'Anahtarları çıkar',
    reason: 'The specification lists the search patterns of checklist item 1.',
  },
  {
    path: '01-kadro-react-native-expo.md',
    pattern: 'aws-access-key-id',
    lineContains: 'Anahtarları çıkar',
    reason: 'The specification lists the search patterns of checklist item 1.',
  },
];

/** Directory names never descended into: dependencies, build output, caches, VCS data. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  '.next',
  '.turbo',
  '.expo',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly pattern: SecretPattern['id'];
}

export interface ScanResult {
  readonly findings: readonly Finding[];
  readonly allowed: readonly Finding[];
  readonly staleAllowEntries: readonly AllowEntry[];
  readonly filesScanned: number;
}

/** Local environment files are ignored by Git (`.env`, `.env.*`), except the documented example. */
function isLocalEnvFile(name: string): boolean {
  return (name === '.env' || name.startsWith('.env.')) && name !== '.env.example';
}

function listFiles(root: string, relative = ''): string[] {
  const directory = path.join(root, relative);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks the scanned tree
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listFiles(root, child));
      }
    } else if (entry.isFile() && !isLocalEnvFile(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8_192).includes(0);
}

export function scanRepository(
  root: string,
  allowlist: readonly AllowEntry[] = ALLOWLIST,
): ScanResult {
  const findings: Finding[] = [];
  const allowed: Finding[] = [];
  const used = new Set<AllowEntry>();
  let filesScanned = 0;
  for (const file of listFiles(root).sort()) {
    const absolute = path.join(root, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- file inside the scanned tree
    if (statSync(absolute).size > MAX_FILE_BYTES) {
      continue;
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- file inside the scanned tree
    const content = readFileSync(absolute);
    if (isBinary(content)) {
      continue;
    }
    filesScanned += 1;
    const lines = content.toString('utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const pattern of SECRET_PATTERNS) {
        if (!pattern.regex.test(text)) {
          continue;
        }
        const finding: Finding = { path: file, line: index + 1, pattern: pattern.id };
        const entry = allowlist.find(
          (candidate) =>
            candidate.path === file &&
            candidate.pattern === pattern.id &&
            text.includes(candidate.lineContains),
        );
        if (entry === undefined) {
          findings.push(finding);
        } else {
          used.add(entry);
          allowed.push(finding);
        }
      }
    });
  }
  return {
    findings,
    allowed,
    staleAllowEntries: allowlist.filter((entry) => !used.has(entry)),
    filesScanned,
  };
}

export function formatScan(result: ScanResult): string {
  const lines = [
    ...result.findings.map(
      (finding) => `FAIL ${finding.path}:${finding.line} matches ${finding.pattern}`,
    ),
    ...result.staleAllowEntries.map(
      (entry) => `FAIL stale allow-list entry ${entry.path} (${entry.pattern}): ${entry.reason}`,
    ),
    ...result.allowed.map(
      (finding) => `allowed ${finding.path}:${finding.line} (${finding.pattern})`,
    ),
  ];
  const failed = result.findings.length + result.staleAllowEntries.length;
  lines.push(
    failed === 0
      ? `secret-grep: clean, ${result.filesScanned} files scanned`
      : `secret-grep: ${result.findings.length} finding(s), ${result.staleAllowEntries.length} stale allow-list entr(ies) in ${result.filesScanned} files`,
  );
  return lines.join('\n');
}

function main(argv: readonly string[]): number {
  const root = path.resolve(argv[0] ?? fileURLToPath(new URL('../..', import.meta.url)));
  const result = scanRepository(root);
  process.stdout.write(`${formatScan(result)}\n`);
  return result.findings.length === 0 && result.staleAllowEntries.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `secret-grep: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
