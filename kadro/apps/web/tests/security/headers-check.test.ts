import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkSecurityHeaders,
  cspNonce,
  formatReport,
  parseCsp,
} from '../../../../scripts/security/headers-check';
import {
  BUILD_PRESENT,
  type RunningServer,
  runScript,
  startBareServer,
  startBuiltServer,
} from './support/server';
import { prerequisite } from '../support/prerequisite';

/**
 * Security checklist item 9: `scripts/security/headers-check.ts` against the production build
 * (`next start` on the output of `pnpm build`, generated test configuration). Without a build
 * the build-backed block is skipped locally and says so on stderr, and the whole file fails
 * under CI=true; the parser tests and the negative run against a bare server (no security
 * headers → exit 1) always run otherwise.
 */

const BUILD_CHECKS = prerequisite(
  BUILD_PRESENT,
  'headers-check.test (production-build checks)',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

describe('CSP parsing', () => {
  it('splits directives and finds the script nonce', () => {
    const csp =
      "default-src 'self'; script-src 'self' 'nonce-AbCdEfGhIjKlMnOpQrSt12==' 'strict-dynamic'";
    expect(parseCsp(csp).get('script-src')).toEqual([
      "'self'",
      "'nonce-AbCdEfGhIjKlMnOpQrSt12=='",
      "'strict-dynamic'",
    ]);
    expect(cspNonce(csp)).toBe('AbCdEfGhIjKlMnOpQrSt12==');
    expect(cspNonce("script-src 'self' 'nonce-short'")).toBeNull();
    expect(cspNonce(null)).toBeNull();
  });
});

describe('headers-check against a server without security headers', () => {
  let bare: RunningServer;

  beforeAll(async () => {
    bare = await startBareServer();
  });

  afterAll(async () => {
    await bare.stop();
  });

  it('reports every required header as missing', async () => {
    const results = await checkSecurityHeaders(bare.base);
    const failed = new Set(results.filter((result) => !result.ok).map((result) => result.name));
    expect([...failed]).toEqual(
      expect.arrayContaining([
        'Content-Security-Policy',
        'Strict-Transport-Security',
        'X-Content-Type-Options nosniff',
        'Referrer-Policy strict-origin-when-cross-origin',
        'Permissions-Policy camera=(), microphone=(), geolocation=(self)',
        'Cache-Control no-store',
        'CSP nonce differs per response',
      ]),
    );
    expect(results.some((result) => result.ok)).toBe(false);
  });

  it('exits with 1 from the command line', async () => {
    const run = await runScript('headers-check.ts', [bare.base]);
    expect(run.code, run.stderr).toBe(1);
    expect(run.stdout).toContain('FAIL page /: Strict-Transport-Security');
    expect(run.stdout).toMatch(/headers-check: \d+ of \d+ checks failed/);
  });
});

describe.skipIf(!BUILD_CHECKS)('headers-check against the production build', () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await startBuiltServer();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('passes every check for pages, the 404 page and API responses', async () => {
    const results = await checkSecurityHeaders(server.base);
    expect(formatReport(results.filter((result) => !result.ok))).toBe('');
    const targets = new Set(results.map((result) => result.target));
    expect(targets).toEqual(
      new Set(['page /', 'missing page', 'api success', 'api error', 'page / (two requests)']),
    );
  });

  it('exits with 0 from the command line', async () => {
    const run = await runScript('headers-check.ts', [server.base]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toMatch(/headers-check: all \d+ checks passed/);
    expect(run.stdout).not.toContain('FAIL');
  });
});
