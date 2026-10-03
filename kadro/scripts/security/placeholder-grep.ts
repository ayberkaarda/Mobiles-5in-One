/**
 * Phase gate "no placeholder tokens": the source of `apps/` and `packages/` contains no work
 * marker (`TO` + `DO`, `FIX` + `ME` or three X letters, whole upper-case words), no filler-text
 * word (`lo` + `rem`, any case) and no template prefix (`YOU` + `R_`, as in a placeholder key).
 *
 * Usage (Node.js 22.18 or newer runs TypeScript directly):
 *
 *   node scripts/security/placeholder-grep.ts [root]
 *
 * `root` defaults to the Kadro repository root (two levels above this file). Only the directories
 * in SCANNED_ROOTS are walked, and only files with an extension in SOURCE_EXTENSIONS. Exclusions
 * are explicit below: dependency, build and cache directories, lockfiles, binary files, and an
 * allow-list of guard tests that must spell a token to assert its absence. The specification and
 * the documentation live outside the scanned roots. Exit code 1 when a token matches outside the
 * allow-list, or when an allow-list entry no longer matches anything (stale entries are removed,
 * never kept "just in case").
 *
 * The patterns are written so this file does not match them itself.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PlaceholderPattern {
  readonly id: string;
  readonly description: string;
  readonly regex: RegExp;
}

export const PLACEHOLDER_PATTERNS: readonly PlaceholderPattern[] = [
  {
    id: 'work-marker',
    description: 'work marker as a whole upper-case word',
    regex: /\b(?:TO[D]O|FIX[M]E|X[X]X)\b/,
  },
  {
    id: 'filler-text',
    description: 'filler text word, any case',
    regex: /lo[r]em/i,
  },
  {
    id: 'template-prefix',
    description: 'template prefix of a placeholder value',
    regex: /(?<![A-Za-z0-9])YOU[R]_/,
  },
];

/** Directories (relative to the root) that hold the source to check. */
export const SCANNED_ROOTS: readonly string[] = ['apps', 'packages'];

/** Text source and configuration files; everything else (fonts, images, archives) is skipped. */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.sql',
  '.json',
  '.yml',
  '.yaml',
]);

/** Directory names never descended into: dependencies, build output, caches, reports. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  '.git',
  '.next',
  '.turbo',
  '.expo',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'playwright-report',
  'test-results',
]);

/** File names never scanned: package manager lockfiles. */
export const SKIPPED_FILES: ReadonlySet<string> = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
]);

export interface AllowEntry {
  /** Path relative to the scanned root, with forward slashes. */
  readonly path: string;
  readonly pattern: PlaceholderPattern['id'];
  /** The matching line must contain this text; keeps the entry to one known line. */
  readonly lineContains: string;
  readonly reason: string;
}

/**
 * Narrow, explicit exceptions: guard tests that spell a token to assert it is absent. Each entry
 * names one file, one pattern and one line, and must keep matching: a stale entry fails the scan.
 */
export const ALLOWLIST: readonly AllowEntry[] = [
  {
    path: 'apps/web/tests/pages/source-guards.test.ts',
    pattern: 'work-marker',
    lineContains: 'not.toMatch(',
    reason: 'The page source guard asserts that the token pages contain no work marker.',
  },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly pattern: PlaceholderPattern['id'];
}

export interface ScanResult {
  readonly findings: readonly Finding[];
  readonly allowed: readonly Finding[];
  readonly staleAllowEntries: readonly AllowEntry[];
  readonly filesScanned: number;
}

function listFiles(root: string, relative: string): string[] {
  const directory = path.join(root, relative);
  let entries;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks the scanned tree
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    // A scanned root that does not exist (a temporary tree without packages/) has no files.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listFiles(root, child));
      }
    } else if (
      entry.isFile() &&
      !SKIPPED_FILES.has(entry.name) &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
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
  const files = SCANNED_ROOTS.flatMap((scanned) => listFiles(root, scanned)).sort();
  for (const file of files) {
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
      for (const pattern of PLACEHOLDER_PATTERNS) {
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
      ? `placeholder-grep: clean, ${result.filesScanned} files scanned`
      : `placeholder-grep: ${result.findings.length} finding(s), ${result.staleAllowEntries.length} stale allow-list entr(ies) in ${result.filesScanned} files`,
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
      `placeholder-grep: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
