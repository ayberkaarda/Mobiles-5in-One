#!/usr/bin/env node
// Checks the release documents (ADR-0056). Not wired into CI; run from anywhere:
//   node ops/release/check-release-docs.mjs
// 1. Store listing limits: every field row with a numeric limit fits it (store title options at
//    most 30, short description at most 80, ...); full description at most 4000, what's new at
//    most 500. The specification title is reported, not failed: its length is an owner decision.
// 2. Every docs/screenshots/... path named in docs/release/*.md and docs/seo/aso.md exists; the
//    listing screenshots also get a size and ratio report.
// 3. Every INECEKVAR_* and IV_WEB_* key named in docs/release/*.md and the history-purge runbook
//    is documented in docs/ops/env.md; keys documented only in an ADR or ops/Caddyfile are
//    reported as warnings, keys documented nowhere fail.
// Exit code 0 when no check fails, 1 otherwise.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const length = (text) => [...text.normalize('NFC')].length;
const bytes = (text) => Buffer.byteLength(text.normalize('NFC'), 'utf8');

const failures = [];
const warnings = [];
const lines = [];

// 1. Listing limits -----------------------------------------------------------------------------

const STORE_TITLE_LIMIT = 30;
const BLOCK_LIMITS = { 'full-description': 4000, 'whats-new': 500 };
const listings = ['docs/release/store-listing.tr.md', 'docs/release/store-listing.en.md'];

for (const file of listings) {
  const text = read(file);
  const fields = new Map();
  for (const row of text.split('\n')) {
    const match = /^\|\s*`([a-z][a-z.-]*)`\s*\|\s*`([^`]*)`\s*\|\s*([^|]*?)\s*\|/.exec(row);
    if (match) fields.set(match[1], { value: match[2], limit: match[3] });
  }
  const titleOptions = [...fields.keys()].filter((id) => id.startsWith('title.option-'));
  for (const required of ['title.spec', 'subtitle', 'short', 'keywords']) {
    if (!fields.has(required)) failures.push(`${file}: field \`${required}\` missing`);
  }
  if (titleOptions.length === 0) failures.push(`${file}: no store title option`);

  for (const [id, { value, limit }] of fields) {
    const count = length(value);
    if (id === 'title.spec') {
      const over = count > STORE_TITLE_LIMIT;
      lines.push(
        `${file} ${id}: ${count} chars (store cap ${STORE_TITLE_LIMIT}: ${over ? 'over, owner decision' : 'fits'})`,
      );
      continue;
    }
    const numeric = Number(limit);
    let cap = Number.isInteger(numeric) && numeric > 0 ? numeric : null;
    if (id.startsWith('title.option-')) cap = Math.min(cap ?? STORE_TITLE_LIMIT, STORE_TITLE_LIMIT);
    if (cap === null) {
      failures.push(`${file} ${id}: no numeric limit`);
      continue;
    }
    const ok = count <= cap;
    let note = '';
    if (id === 'keywords') {
      note = `, ${bytes(value)} UTF-8 bytes`;
      if (bytes(value) > cap) {
        warnings.push(
          `${file} keywords: ${bytes(value)} UTF-8 bytes over ${cap} if the store counts bytes`,
        );
      }
    }
    lines.push(`${file} ${id}: ${count}/${cap} chars${note} ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failures.push(`${file} ${id}: ${count} chars over ${cap}`);
  }

  for (const [block, cap] of Object.entries(BLOCK_LIMITS)) {
    const match = new RegExp(`<!-- ${block}:start -->([\\s\\S]*?)<!-- ${block}:end -->`).exec(text);
    if (!match) {
      failures.push(`${file}: block ${block} missing`);
      continue;
    }
    const count = length(match[1].trim());
    const ok = count <= cap;
    lines.push(`${file} ${block}: ${count}/${cap} chars ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failures.push(`${file} ${block}: ${count} chars over ${cap}`);
  }
}

// 2. Screenshot paths ---------------------------------------------------------------------------

const releaseDocs = readdirSync(join(root, 'docs/release'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => `docs/release/${name}`);
const screenshotSources = [...releaseDocs, 'docs/seo/aso.md'];
const screenshots = new Map();
for (const file of screenshotSources) {
  for (const match of read(file).matchAll(/docs\/screenshots\/[A-Za-z0-9_./-]+\.png/g)) {
    if (!screenshots.has(match[0])) screenshots.set(match[0], file);
  }
}
let missing = 0;
for (const [path, file] of screenshots) {
  if (!existsSync(join(root, path))) {
    missing += 1;
    failures.push(`${file}: screenshot ${path} does not exist`);
  }
}
lines.push(`screenshots: ${screenshots.size} paths referenced, ${missing} missing`);

const pngSize = (path) => {
  const data = readFileSync(join(root, path));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
};
const listed = new Set();
for (const file of listings) {
  for (const match of read(file).matchAll(/\|\s*\d+\s*\|\s*`(docs\/screenshots\/[^`]+\.png)`/g)) {
    listed.add(match[1]);
  }
}
for (const path of listed) {
  if (!existsSync(join(root, path))) continue;
  const { width, height } = pngSize(path);
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio > 2) {
    warnings.push(`${path}: ${width}x${height}, ratio ${ratio.toFixed(2)} above the 2:1 Play rule`);
  }
}
lines.push(`listing screenshots: ${listed.size} distinct files`);

// 3. Environment keys ---------------------------------------------------------------------------

const envDoc = read('docs/ops/env.md');
const secondary = [
  ...readdirSync(join(root, 'docs/adr'))
    .filter((name) => /^00(38|39)-/.test(name))
    .map((name) => `docs/adr/${name}`),
  'ops/Caddyfile',
];
const keySources = [...releaseDocs, 'docs/security/history-purge-runbook.md'];
const keys = new Map();
for (const file of keySources) {
  for (const match of read(file).matchAll(/\b(?:INECEKVAR|IV_WEB)_[A-Z0-9_]*[A-Z0-9_]/g)) {
    if (!keys.has(match[0])) keys.set(match[0], file);
  }
}
const documented = (text, key) =>
  key.endsWith('_')
    ? text.includes(key)
    : new RegExp(`(^|[^A-Z0-9_])${key}([^A-Z0-9_]|$)`).test(text);
let inEnv = 0;
const elsewhere = [];
for (const [key, file] of keys) {
  if (documented(envDoc, key)) {
    inEnv += 1;
    continue;
  }
  const source = secondary.find((path) => documented(read(path), key));
  if (source) elsewhere.push(`${key} (${source})`);
  else failures.push(`${file}: ${key} is documented nowhere`);
}
lines.push(
  `env keys: ${keys.size} named, ${inEnv} in docs/ops/env.md, ${elsewhere.length} only elsewhere`,
);
if (elsewhere.length > 0) {
  warnings.push(`not in docs/ops/env.md, documented elsewhere: ${elsewhere.join(', ')}`);
}

// 4. uvicorn start commands (phase 6 review F9, ADR-0055 decision 1) ----------------------------
// Every `uvicorn app.main:app` command in the start documents must carry --no-proxy-headers:
// uvicorn's default rewrites the client address and scheme from X-Forwarded-* headers.

const startDocs = [
  'README.md',
  'README.tr.md',
  'CONTRIBUTING.md',
  'docker-compose.yml',
  'docs/ops/env.md',
  'docs/ops/logging.md',
  'docs/release/release-checklist.md',
  'apps/web-e2e/playwright.config.ts',
  'api/app/main.py',
];
let commands = 0;
for (const file of startDocs) {
  const text = read(file);
  for (const match of text.matchAll(/uvicorn app\.main:app[^`\n]*(?:\n#[^`\n]*)?/g)) {
    commands += 1;
    if (!match[0].includes('--no-proxy-headers')) {
      failures.push(`${file}: uvicorn command without --no-proxy-headers: ${match[0].split('\n')[0]}`);
    }
  }
}
if (commands === 0) failures.push('no uvicorn start command found in the start documents');
lines.push(`uvicorn start commands: ${commands}, all with --no-proxy-headers unless listed below`);

// Report ----------------------------------------------------------------------------------------

for (const line of lines) console.log(line);
for (const warning of warnings) console.log(`WARN ${warning}`);
for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(
  failures.length === 0
    ? `release docs check passed (${warnings.length} warnings) in ${relative(process.cwd(), root) || '.'}`
    : `release docs check failed: ${failures.length} failures`,
);
process.exit(failures.length === 0 ? 0 : 1);
