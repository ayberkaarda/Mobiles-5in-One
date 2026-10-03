import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILD_PRESENT, freePort } from '../security/support/server';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { testEnvSource } from '../support/env';
import { createRoleLogins, type RoleLogins } from '../support/jobs';
import { seed, slugs } from './fixtures';

/**
 * Lighthouse CI on the production build (ADR-0059). Opt-in: runs only with KADRO_LIGHTHOUSE=1
 * (`pnpm lighthouse` sets it), because it downloads `@lhci/cli` through npx (nothing is added to
 * the repository dependencies), needs Chrome (`CHROME_PATH`) and takes several minutes. Seeds a
 * disposable database, starts `next start` and audits home, features, a venue and a district
 * page, three runs each, asserting the median (`lighthouserc.cjs`). The blog index joins the list
 * when the blog pages exist.
 */

// eslint-disable-next-line no-restricted-properties -- test-run switch, not application configuration
const ENABLED = process.env.KADRO_LIGHTHOUSE === '1' && BUILD_PRESENT;

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));
const LHCI = '@lhci/cli@0.15.1';

interface Lhr {
  readonly requestedUrl?: string;
  readonly finalDisplayedUrl?: string;
  readonly categories: Record<string, { score: number | null }>;
  readonly audits: Record<string, { numericValue?: number }>;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** Median category scores and LCP / CLS / TBT per audited URL, read from the saved reports. */
function medianTable(dir: string): string {
  const byUrl = new Map<string, Lhr[]>();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary directory of this run
  for (const file of readdirSync(dir).filter((name) => /^lhr-.*\.json$/.test(name))) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary directory of this run
    const lhr = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Lhr;
    const url = (lhr.finalDisplayedUrl ?? lhr.requestedUrl ?? file).replace(
      /^https?:\/\/[^/]+/,
      '',
    );
    byUrl.set(url, [...(byUrl.get(url) ?? []), lhr]);
  }
  const rows = [...byUrl].map(([url, runs]) => {
    const score = (id: string) =>
      Math.round(median(runs.map((run) => (run.categories[id]?.score ?? 0) * 100)));
    const audit = (id: string) => median(runs.map((run) => run.audits[id]?.numericValue ?? 0));
    return (
      `${url}  runs=${runs.length}  perf=${score('performance')} a11y=${score('accessibility')} ` +
      `seo=${score('seo')} best=${score('best-practices')}  LCP=${Math.round(audit('largest-contentful-paint'))}ms ` +
      `CLS=${audit('cumulative-layout-shift').toFixed(3)} TBT=${Math.round(audit('total-blocking-time'))}ms`
    );
  });
  return ['', 'MEDIAN SCORES', ...rows, ''].join('\n');
}

let database: TestDatabase | undefined;
let logins: RoleLogins | undefined;
let server: ChildProcess | undefined;
let outputDir = '';
let base = '';
let output = '';

describe.skipIf(!ENABLED)('Lighthouse CI (production build)', { timeout: 900_000 }, () => {
  beforeAll(async () => {
    database = await createMigratedDatabase('web_lighthouse');
    logins = await createRoleLogins(database.url);
    await seed(database.client.db);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    outputDir = mkdtempSync(join(tmpdir(), 'kadro-lhci-'));
    server = spawn(
      process.execPath,
      [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
      {
        cwd: APP_DIR,
        env: {
          ...testEnvSource({
            WEB_ORIGIN: base,
            CORS_ALLOWED_ORIGINS: base,
            DATABASE_URL: logins.appUrl,
          }),
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
    };
    server.stdout?.on('data', collect);
    server.stderr?.on('data', collect);
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/v1/health`)).ok) {
          break;
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error(`built server did not become ready\n${output}`);
      }
      await delay(250);
    }
  }, 180_000);

  afterAll(async () => {
    if (server !== undefined && server.exitCode === null) {
      const exited = new Promise((resolve) => server?.once('exit', resolve));
      server.kill();
      await exited;
    }
    await logins?.drop();
    await database?.dispose();
    rmSync(outputDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it('home, features, blog index, venue and district reach 0.9 in every category (median of 3)', async () => {
    const urls = [
      '/',
      '/ozellikler',
      '/blog',
      `/saha/${slugs.verified}`,
      `/eksik-var/${slugs.il}/${slugs.district}`,
    ].map((path) => `${base}${path}`);
    const lines: string[] = [];
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn('npx', ['--yes', LHCI, 'autorun', '--config=./lighthouserc.cjs'], {
        cwd: APP_DIR,
        // npx is a .cmd shim on Windows
        shell: process.platform === 'win32',
        env: {
          // eslint-disable-next-line no-restricted-properties -- the child needs PATH and CHROME_PATH
          ...process.env,
          LHCI_URLS: urls.join(','),
          LHCI_OUTPUT_DIR: outputDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const collect = (chunk: Buffer) => {
        lines.push(chunk.toString('utf8'));
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('exit', resolve);
    });
    process.stdout.write(lines.join(''));
    process.stdout.write(medianTable(join(APP_DIR, '.lighthouseci')));
    expect(code, lines.join('')).toBe(0);
  });
});
