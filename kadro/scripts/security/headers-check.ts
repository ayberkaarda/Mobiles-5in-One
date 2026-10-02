/**
 * Security checklist item 9: checks the response headers of a running Kadro web app.
 *
 * Usage (Node.js 22.18 or newer runs TypeScript directly):
 *
 *   node scripts/security/headers-check.ts [base-url]
 *
 * `base-url` defaults to http://localhost:3000. The script requests an HTML page twice, a
 * missing page, an API success response and an API error response, prints one line per check
 * and exits with 1 when any required header or directive is missing or weaker than specified:
 *
 * - pages: nonce CSP with `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `'unsafe-inline'`,
 *   no `'unsafe-eval'`), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, and a
 *   fresh nonce per response;
 * - every response: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
 *   (a longer max-age passes), `X-Content-Type-Options: nosniff`,
 *   `Referrer-Policy: strict-origin-when-cross-origin`,
 *   `Permissions-Policy` with `camera=()`, `microphone=()`, `geolocation=(self)`;
 * - API responses: `Cache-Control: no-store` and a CSP that denies everything.
 */

import { fileURLToPath } from 'node:url';

export const DEFAULT_BASE_URL = 'http://localhost:3000';

const HSTS_MIN_MAX_AGE = 63_072_000;
const NONCE = /^'nonce-([A-Za-z0-9+/_-]{16,}={0,2})'$/;

export interface HeaderCheck {
  /** Request the check belongs to, e.g. `page /`. */
  readonly target: string;
  readonly name: string;
  readonly ok: boolean;
  /** Observed value or the reason of the failure. */
  readonly detail: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface Target {
  readonly label: string;
  readonly path: string;
  readonly kind: 'page' | 'api';
}

const TARGETS: readonly Target[] = [
  { label: 'page /', path: '/', kind: 'page' },
  { label: 'missing page', path: '/headers-check-missing-page', kind: 'page' },
  { label: 'api success', path: '/api/v1/health', kind: 'api' },
  // No x-kadro-client header: the route wrapper answers with a 400 problem response.
  { label: 'api error', path: '/api/v1/me', kind: 'api' },
];

/** `default-src 'self'; script-src …` → directive name → source tokens. */
export function parseCsp(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '' && !directives.has(name.toLowerCase())) {
      directives.set(name.toLowerCase(), sources);
    }
  }
  return directives;
}

/** The nonce of `script-src`, or `null`. */
export function cspNonce(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  for (const source of parseCsp(value).get('script-src') ?? []) {
    const match = NONCE.exec(source);
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

function check(target: string, name: string, ok: boolean, detail: string): HeaderCheck {
  return { target, name, ok, detail };
}

function exactDirective(
  target: string,
  directives: Map<string, string[]>,
  name: string,
  expected: string,
): HeaderCheck {
  const sources = directives.get(name);
  const observed = sources === undefined ? 'missing' : sources.join(' ');
  return check(target, `CSP ${name} ${expected}`, observed === expected, observed);
}

function pageCspChecks(target: string, csp: string | null): HeaderCheck[] {
  if (csp === null) {
    return [check(target, 'Content-Security-Policy', false, 'missing')];
  }
  const directives = parseCsp(csp);
  const script = directives.get('script-src') ?? [];
  return [
    check(
      target,
      "CSP script-src 'self' 'nonce-…' 'strict-dynamic'",
      script.includes("'self'") && cspNonce(csp) !== null && script.includes("'strict-dynamic'"),
      script.join(' ') || 'missing',
    ),
    check(
      target,
      "CSP script-src without 'unsafe-inline' and 'unsafe-eval'",
      !script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"),
      script.join(' ') || 'missing',
    ),
    exactDirective(target, directives, 'object-src', "'none'"),
    exactDirective(target, directives, 'frame-ancestors', "'none'"),
    exactDirective(target, directives, 'base-uri', "'self'"),
  ];
}

function apiChecks(target: string, headers: Headers): HeaderCheck[] {
  const cacheControl = headers.get('cache-control');
  const csp = headers.get('content-security-policy');
  const directives = parseCsp(csp ?? '');
  return [
    check(
      target,
      'Cache-Control no-store',
      (cacheControl ?? '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .includes('no-store'),
      cacheControl ?? 'missing',
    ),
    check(
      target,
      "CSP default-src 'none' and frame-ancestors 'none'",
      directives.get('default-src')?.join(' ') === "'none'" &&
        directives.get('frame-ancestors')?.join(' ') === "'none'",
      csp ?? 'missing',
    ),
  ];
}

function hstsCheck(target: string, value: string | null): HeaderCheck {
  if (value === null) {
    return check(target, 'Strict-Transport-Security', false, 'missing');
  }
  const parts = value.split(';').map((part) => part.trim().toLowerCase());
  const maxAge = Number(
    /^max-age=(\d+)$/.exec(parts.find((part) => part.startsWith('max-age=')) ?? '')?.[1],
  );
  const ok =
    Number.isSafeInteger(maxAge) &&
    maxAge >= HSTS_MIN_MAX_AGE &&
    parts.includes('includesubdomains') &&
    parts.includes('preload');
  return check(
    target,
    'Strict-Transport-Security max-age>=63072000; includeSubDomains; preload',
    ok,
    value,
  );
}

function permissionsPolicyCheck(target: string, value: string | null): HeaderCheck {
  const entries = new Set((value ?? '').split(',').map((part) => part.trim().replace(/\s+/g, '')));
  const ok = ['camera=()', 'microphone=()', 'geolocation=(self)'].every((entry) =>
    entries.has(entry),
  );
  return check(
    target,
    'Permissions-Policy camera=(), microphone=(), geolocation=(self)',
    ok,
    value ?? 'missing',
  );
}

function commonChecks(target: string, headers: Headers): HeaderCheck[] {
  const nosniff = headers.get('x-content-type-options');
  const referrer = headers.get('referrer-policy');
  return [
    hstsCheck(target, headers.get('strict-transport-security')),
    check(
      target,
      'X-Content-Type-Options nosniff',
      nosniff?.toLowerCase() === 'nosniff',
      nosniff ?? 'missing',
    ),
    check(
      target,
      'Referrer-Policy strict-origin-when-cross-origin',
      referrer?.toLowerCase() === 'strict-origin-when-cross-origin',
      referrer ?? 'missing',
    ),
    permissionsPolicyCheck(target, headers.get('permissions-policy')),
  ];
}

/** Runs every check against `baseUrl`; a request that fails becomes a failed check. */
export async function checkSecurityHeaders(
  baseUrl: string,
  fetchImpl: Fetch = fetch,
): Promise<HeaderCheck[]> {
  const base = new URL(baseUrl);
  const results: HeaderCheck[] = [];
  const nonces: string[] = [];
  for (const target of [TARGETS[0], ...TARGETS] as Target[]) {
    let response: Response;
    try {
      response = await fetchImpl(new URL(target.path, base).toString(), { redirect: 'manual' });
      await response.arrayBuffer();
    } catch (error) {
      results.push(
        check(
          target.label,
          'request',
          false,
          error instanceof Error ? error.message : String(error),
        ),
      );
      continue;
    }
    results.push(...commonChecks(target.label, response.headers));
    if (target.kind === 'page') {
      const csp = response.headers.get('content-security-policy');
      results.push(...pageCspChecks(target.label, csp));
      if (target.path === '/') {
        nonces.push(cspNonce(csp) ?? '');
      }
    } else {
      results.push(...apiChecks(target.label, response.headers));
    }
  }
  const [first, second] = nonces;
  results.push(
    check(
      'page / (two requests)',
      'CSP nonce differs per response',
      first !== undefined &&
        first !== '' &&
        second !== undefined &&
        second !== '' &&
        first !== second,
      `${first ?? 'missing'} / ${second ?? 'missing'}`,
    ),
  );
  return results;
}

/** One line per check, failures marked with FAIL. */
export function formatReport(results: readonly HeaderCheck[]): string {
  return results
    .map(
      (result) =>
        `${result.ok ? 'ok  ' : 'FAIL'} ${result.target}: ${result.name} (${result.detail})`,
    )
    .join('\n');
}

async function main(argv: readonly string[]): Promise<number> {
  const baseUrl = argv[0] ?? DEFAULT_BASE_URL;
  const results = await checkSecurityHeaders(baseUrl);
  const failed = results.filter((result) => !result.ok).length;
  process.stdout.write(`${formatReport(results)}\n`);
  process.stdout.write(
    failed === 0
      ? `headers-check: all ${results.length} checks passed for ${baseUrl}\n`
      : `headers-check: ${failed} of ${results.length} checks failed for ${baseUrl}\n`,
  );
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `headers-check: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
