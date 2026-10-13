#!/usr/bin/env node
// PWA Content-Security-Policy check (spec sections 6.9 and 6.16, ADR-0055). Run after the
// production build (`pnpm nx run mobile:csp-check` builds first):
//
//   node apps/mobile/scripts/csp-hash-check.mjs          # check, exit 1 on any problem
//   node apps/mobile/scripts/csp-hash-check.mjs --print  # print the hashes the build needs
//
// It computes the SHA-256 of every inline <script> in dist/apps/mobile/browser/index.html and
// requires the script-src of the `(pwa_headers)` snippet in ops/Caddyfile to list exactly those
// hashes, with no 'unsafe-inline', 'unsafe-eval', wildcard or scheme source for scripts. Inline
// event handler attributes are refused (script-src-attr is 'none'), and the fixed directives
// (object-src, base-uri, frame-ancestors, worker-src) are asserted.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePolicy, readPwaHeaders } from './pwa-headers.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const caddyfile = resolve(join(here, '../../../ops/Caddyfile'));
const index = resolve(
  process.env.IV_CSP_INDEX ?? join(here, '../../../dist/apps/mobile/browser/index.html'),
);

export function inlineScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    hashes.push(`'sha256-${createHash('sha256').update(match[2], 'utf8').digest('base64')}'`);
  }
  return hashes;
}

const html = readFileSync(index, 'utf8');
const wanted = inlineScriptHashes(html);
if (process.argv.includes('--print')) {
  console.log(wanted.join(' ') || '(no inline script)');
  process.exit(0);
}

const problems = [];
const policy = parsePolicy(readPwaHeaders(caddyfile, {})['Content-Security-Policy']);
const scriptSrc = policy['script-src'] ?? [];
const listed = scriptSrc.filter((source) => source.startsWith("'sha256-"));
for (const hash of wanted) {
  if (!listed.includes(hash)) problems.push(`inline script ${hash} is not allowed by script-src`);
}
for (const hash of listed) {
  if (!wanted.includes(hash))
    problems.push(`script-src lists ${hash}, which matches no inline script`);
}
for (const source of scriptSrc) {
  if (
    ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", '*'].includes(source) ||
    /^[a-z][a-z0-9+.-]*:$/i.test(source)
  ) {
    problems.push(`script-src must not contain ${source}`);
  }
}
const expectExact = {
  'script-src-attr': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'frame-ancestors': ["'none'"],
  'worker-src': ["'self'", 'blob:'],
};
for (const [name, sources] of Object.entries(expectExact)) {
  if ((policy[name] ?? []).join(' ') !== sources.join(' ')) {
    problems.push(`${name} must be ${sources.join(' ')}`);
  }
}
if (/\son[a-z]+\s*=/i.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ''))) {
  problems.push('index.html has an inline event handler attribute');
}

if (problems.length > 0) {
  console.error('PWA CSP check failed (' + index + '):\n  ' + problems.join('\n  '));
  console.error('Build hashes: ' + (wanted.join(' ') || '(none)'));
  process.exit(1);
}
console.log(`PWA CSP check passed: ${wanted.length} inline script hash(es) match ops/Caddyfile`);
