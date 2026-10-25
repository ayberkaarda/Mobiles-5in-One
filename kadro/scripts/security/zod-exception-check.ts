/**
 * Guard for the audit exception of ADR-0085. `auditConfig.ignoreGhsas` hides GHSA-mrhx-c7xc-m3w5
 * for every zod copy, but the exception covers exactly one: `zod@3.25.76` as a dependency of
 * `@expo/cli`. This check reads the lockfile and fails when any other package or workspace
 * resolves a zod version below the patched 4.6.6.
 *
 * Usage (Node.js 22.18 or newer runs TypeScript directly; no install needed):
 *
 *   node scripts/security/zod-exception-check.ts [lockfile]
 *
 * `lockfile` defaults to `pnpm-lock.yaml` in the Kadro root (two levels above this file).
 * Resolutions are taken from importer dependencies, snapshot dependencies (`zod: <version>`) and
 * peer suffixes (`(zod@<version>)`). Exit code 1 lists every resolution outside the exception.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCHED = [4, 6, 6] as const;
const ALLOWED_VERSION = '3.25.76';
const ALLOWED_OWNER = '@expo/cli';

export interface ZodResolution {
  readonly owner: string;
  readonly version: string;
  readonly line: number;
}

function parts(version: string): number[] {
  const core = version.split(/[-+]/)[0] ?? '';
  return core.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

export function isVulnerable(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = parts(version);
  if (major !== PATCHED[0]) return major < PATCHED[0];
  if (minor !== PATCHED[1]) return minor < PATCHED[1];
  return patch < PATCHED[2];
}

/** Package name of a lockfile key such as `'@expo/cli@57.0.32(react@19.2.3)'`. */
function ownerName(key: string): string {
  const bare = key.replace(/^'|'$/g, '');
  const at = bare.indexOf('@', 1);
  return at === -1 ? bare : bare.slice(0, at);
}

export function zodResolutions(lockfile: string): ZodResolution[] {
  const found: ZodResolution[] = [];
  let section = '';
  let entry = '';
  let importerDep = '';
  lockfile.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    const top = /^(\S[^:]*):\s*$/.exec(text);
    if (top) {
      section = top[1] ?? '';
      entry = '';
      return;
    }
    const key = /^ {2}(\S.*):\s*$/.exec(text);
    if (key) {
      entry = key[1] ?? '';
      importerDep = '';
      if (section === 'packages' && ownerName(entry) === 'zod') {
        const version = entry.replace(/^'?zod@/, '').replace(/'$/, '');
        found.push({ owner: '(package entry)', version, line });
      }
    }
    const owner = section === 'importers' ? `workspace ${entry}` : ownerName(entry);
    if (section === 'importers') {
      const dep = /^ {6}('?[^ ]+?'?):\s*$/.exec(text);
      if (dep) importerDep = (dep[1] ?? '').replace(/'/g, '');
      const version = /^ {8}version: (\S+)/.exec(text);
      if (version && importerDep === 'zod') {
        found.push({ owner, version: (version[1] ?? '').split('(')[0] ?? '', line });
      }
    }
    // The packages section lists peer ranges (`zod: ^3.25.0 || ^4.0.0`), not resolutions.
    if (section === 'snapshots') {
      const dep = /^ {6}zod: (\d\S*)/.exec(text);
      if (dep) found.push({ owner, version: (dep[1] ?? '').split('(')[0] ?? '', line });
    }
    for (const peer of text.matchAll(/\(zod@([^()]+)\)/g)) {
      found.push({ owner, version: peer[1] ?? '', line });
    }
  });
  return found;
}

export function violations(lockfile: string): ZodResolution[] {
  return zodResolutions(lockfile).filter(({ owner, version }) => {
    if (!isVulnerable(version)) return false;
    if (version !== ALLOWED_VERSION) return true;
    return owner !== ALLOWED_OWNER && owner !== '(package entry)';
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'pnpm-lock.yaml');
  // The path is the Kadro lockfile or an operator-supplied one; it is only read.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const text = readFileSync(file, 'utf8');
  const all = zodResolutions(text);
  const bad = violations(text);
  if (bad.length > 0) {
    process.stderr.write(
      `zod-exception-check: ${bad.length} zod resolution(s) below 4.6.6 outside the ADR-0085 exception:\n`,
    );
    for (const { owner, version, line } of bad) {
      process.stderr.write(`  line ${line}: ${owner} -> zod@${version}\n`);
    }
    process.exit(1);
  }
  const versions = [...new Set(all.map(({ version }) => version))].sort().join(', ');
  process.stdout.write(
    `zod-exception-check: ok, ${all.length} zod resolution(s) (${versions}); below 4.6.6 only ${ALLOWED_OWNER} -> zod@${ALLOWED_VERSION}\n`,
  );
}
