// Fails when the web build output contains the session or auth parts of libs/data-access
// (ADR-0038). Public SSR pages must not carry code that reads localStorage, location or history
// for sign-in state. Third-party code (the `debug` module inside express) may mention
// localStorage, so the check looks for markers that only libs/data-access defines.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(process.argv[2] ?? join(here, '../../../dist/apps/web'));
const markers = [
  'iv.logout_pending',
  'consumeMagicLinkFragment',
  'globalThis.localStorage',
  'X-CSRF-Token',
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const scanned = files(root).filter((path) => /\.(m?js|html)$/.test(path));
if (scanned.length === 0) {
  console.error(`No bundle files under ${root}; build the web project first.`);
  process.exit(1);
}
const hits = [];
for (const path of scanned) {
  const text = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (text.includes(marker)) hits.push(`${path}: ${marker}`);
  }
}
if (hits.length > 0) {
  console.error(`Session or auth code found in the public web bundle:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`Public web bundle clean: ${scanned.length} files, ${markers.length} markers.`);
