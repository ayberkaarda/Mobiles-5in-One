// Reads the PWA response headers from the `(pwa_headers)` snippet of ops/Caddyfile (ADR-0055), so
// the CSP check and the e2e static server use exactly what Caddy sends. Caddy environment
// placeholders `{$NAME:default}` are resolved from `env` the way Caddy resolves them at start-up.
// No import.meta here: the Playwright specs load this file through their CommonJS transform, so
// every caller passes the Caddyfile path (`<workspace>/ops/Caddyfile`).
import { readFileSync } from 'node:fs';

function snippet(text, name) {
  // Placeholders are masked (same length) so their braces do not count as blocks.
  const masked = text.replace(/\{\$[^}\n]*\}/g, (m) => 'x'.repeat(m.length));
  const start = masked.indexOf(`(${name}) {`);
  if (start === -1) throw new Error(`snippet (${name}) not found in the Caddyfile`);
  let depth = 0;
  for (let i = masked.indexOf('{', start); i < masked.length; i += 1) {
    if (masked[i] === '{') depth += 1;
    if (masked[i] === '}') depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`snippet (${name}) is not closed`);
}

export function resolvePlaceholders(value, env = process.env) {
  return value.replace(/\{\$([A-Z0-9_]+)(?::([^}]*))?\}/g, (_m, name, fallback) => {
    const set = env[name];
    return set !== undefined && set !== '' ? set : (fallback ?? '');
  });
}

/** Header name to value, in file order; `-Name` deletions are skipped. */
export function readPwaHeaders(path, env = process.env) {
  const block = snippet(readFileSync(path, 'utf8'), 'pwa_headers');
  const headers = {};
  for (const line of block.split('\n')) {
    const match = /^\s*([A-Za-z][A-Za-z0-9-]*)\s+"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (match) headers[match[1]] = resolvePlaceholders(match[2], env);
  }
  if (!headers['Content-Security-Policy']) {
    throw new Error('the (pwa_headers) snippet has no Content-Security-Policy line');
  }
  return headers;
}

/** The CSP as directive name to source list. */
export function parsePolicy(policy) {
  const directives = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = sources;
  }
  return directives;
}
