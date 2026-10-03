import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the Maestro flows of `apps/mobile/.maestro` against the connected Android emulator with the
 * values written by `e2e/seed.mjs`. Extra arguments are passed to `maestro test`, for example a
 * single flow file or `--include-tags=smoke`.
 *
 *   node e2e/run-flows.mjs                 # every flow, in the order of .maestro/config.yaml
 *   node e2e/run-flows.mjs .maestro/flows/rsvp.yaml
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = resolve(HERE, '..');
const ENV_FILE = join(HERE, '.env.e2e');
const REPORT_DIR = join(HERE, 'output');

/** Parses the `KEY=value` lines written by the seed script. */
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error('malformed line in .env.e2e');
    }
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

/** `maestro test` arguments: one `-e KEY=value` pair per seeded value, then the flows. */
export function maestroArgs(values, extra) {
  const args = ['test'];
  for (const [key, value] of Object.entries(values)) {
    args.push('-e', `${key}=${value}`);
  }
  args.push('--format', 'junit', '--output', join(REPORT_DIR, 'report.xml'));
  args.push('--test-output-dir', REPORT_DIR);
  args.push(...(extra.length > 0 ? extra : ['.maestro']));
  return args;
}

function main() {
  if (!existsSync(ENV_FILE)) {
    process.stderr.write('e2e/.env.e2e is missing; run `node e2e/seed.mjs` first\n');
    process.exit(1);
  }
  const values = parseEnvFile(readFileSync(ENV_FILE, 'utf8'));
  const result = spawnSync('maestro', maestroArgs(values, process.argv.slice(2)), {
    cwd: MOBILE_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error !== undefined) {
    process.stderr.write(`could not start maestro: ${result.error.message}\n`);
  }
  process.exit(result.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
