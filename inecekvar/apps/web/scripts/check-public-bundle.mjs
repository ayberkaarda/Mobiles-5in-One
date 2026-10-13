// Boundary check of the web build output (ADR-0038, extended by ADR-0041 and ADR-0057).
//
// Public SSR pages must not carry the session or auth parts of libs/data-access (code that reads
// localStorage, location or history for sign-in state). The client-only admin area and the
// account deletion panel of /hesap-silme may use them, so the check allows those markers only in
// browser chunks that public code never loads statically:
//   1. server output (every SSR render) contains no session marker and no admin marker;
//   2. the browser entry (main, polyfills, modulepreload links of index.csr.html) and everything
//      it imports statically contains neither;
//   3. no browser chunk without markers imports a marked chunk statically, so opening a public
//      route never loads admin code; the admin chunk is reached only through a dynamic import;
//   4. at least one browser chunk carries the admin marker and one the deletion panel marker
//      (the check is not vacuous), and no admin page is prerendered.
// Third-party code (the `debug` module inside express) may mention localStorage, so the check
// looks for markers that only libs/data-access and the admin shell define.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(process.argv[2] ?? join(here, '../../../dist/apps/web'));
const sessionMarkers = [
  'iv.logout_pending',
  'consumeMagicLinkFragment',
  'globalThis.localStorage',
  'X-CSRF-Token',
];
const adminMarker = 'data-iv-admin';
const deletionMarker = 'data-iv-deletion';
const markers = [...sessionMarkers, adminMarker, deletionMarker];

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function hitsIn(path) {
  const text = readFileSync(path, 'utf8');
  return markers.filter((marker) => text.includes(marker));
}

const scanned = files(root).filter((path) => /\.(m?js|html)$/.test(path));
if (scanned.length === 0) {
  console.error(`No bundle files under ${root}; build the web project first.`);
  process.exit(1);
}

const failures = [];
const browserDir = join(root, 'browser');
const serverDir = join(root, 'server');
const hasLayout = existsSync(browserDir) && existsSync(serverDir);

if (!hasLayout) {
  // A single-folder bundle (for example the mobile build as a control): no marker allowed.
  for (const path of scanned) {
    for (const marker of hitsIn(path)) {
      if (sessionMarkers.includes(marker)) failures.push(`${path}: ${marker}`);
    }
  }
} else {
  for (const path of files(serverDir).filter((file) => /\.(m?js|html)$/.test(file))) {
    for (const marker of hitsIn(path))
      failures.push(`server output ${relative(root, path)}: ${marker}`);
  }

  const browserFiles = files(browserDir);
  const scripts = new Map(
    browserFiles.filter((path) => /\.m?js$/.test(path)).map((path) => [basename(path), path]),
  );
  const marked = new Set(
    [...scripts].filter(([, path]) => hitsIn(path).length > 0).map(([name]) => name),
  );
  const staticImports = (name) => {
    const text = readFileSync(scripts.get(name), 'utf8');
    const found = new Set();
    for (const pattern of [
      /\bfrom\s*["'`]\.\/([\w.-]+\.m?js)["'`]/g,
      /\bimport\s*["'`]\.\/([\w.-]+\.m?js)["'`]/g,
    ]) {
      for (const match of text.matchAll(pattern)) found.add(match[1]);
    }
    return [...found].filter((child) => scripts.has(child));
  };

  // 2. Initial closure of the browser entry.
  const entries = new Set([...scripts.keys()].filter((name) => /^(main|polyfills)-/.test(name)));
  for (const html of browserFiles.filter((path) => path.endsWith('.html'))) {
    const text = readFileSync(html, 'utf8');
    for (const match of text.matchAll(/\b(?:src|href)="([\w.-]+\.m?js)"/g)) {
      if (scripts.has(match[1])) entries.add(match[1]);
      if (marked.has(match[1]))
        failures.push(`${relative(root, html)} references marked chunk ${match[1]}`);
    }
    for (const marker of hitsIn(html)) failures.push(`${relative(root, html)}: ${marker}`);
  }
  if (entries.size === 0) failures.push('no browser entry (main-*.js) found');
  const initial = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const name = queue.pop();
    if (initial.has(name)) continue;
    initial.add(name);
    queue.push(...staticImports(name));
  }
  for (const name of initial) {
    for (const marker of hitsIn(scripts.get(name))) {
      failures.push(`initial browser chunk ${name}: ${marker}`);
    }
  }

  // 3. Chunks public code can reach (static or dynamic imports from the entry, never entering a
  //    marked chunk) import marked chunks only dynamically. Chunks reached only through the
  //    admin chunk (its own lazy parts) are admin code and are not checked here.
  const dynamicImports = (name) => {
    const text = readFileSync(scripts.get(name), 'utf8');
    const found = new Set();
    for (const match of text.matchAll(/\bimport\(\s*["'`]\.\/([\w.-]+\.m?js)["'`]\s*\)/g)) {
      found.add(match[1]);
    }
    return [...found].filter((child) => scripts.has(child));
  };
  const reachable = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const name = pending.pop();
    if (reachable.has(name) || marked.has(name)) continue;
    reachable.add(name);
    pending.push(...staticImports(name), ...dynamicImports(name));
  }
  for (const name of reachable) {
    for (const child of staticImports(name)) {
      if (marked.has(child))
        failures.push(`public chunk ${name} statically imports marked chunk ${child}`);
    }
  }

  // 4. The admin chunk exists and nothing of /admin is prerendered.
  const adminChunks = [...marked].filter((name) =>
    readFileSync(scripts.get(name), 'utf8').includes(adminMarker),
  );
  if (adminChunks.length === 0)
    failures.push(`no browser chunk carries ${adminMarker}; the check would be vacuous`);
  const deletionChunks = [...marked].filter((name) =>
    readFileSync(scripts.get(name), 'utf8').includes(deletionMarker),
  );
  if (deletionChunks.length === 0)
    failures.push(`no browser chunk carries ${deletionMarker}; the check would be vacuous`);
  for (const path of browserFiles) {
    if (/[\\/]admin([\\/]|\.html$)/i.test(relative(browserDir, path))) {
      failures.push(`prerendered admin output ${relative(root, path)}`);
    }
  }
  if (failures.length === 0) {
    console.log(
      `Admin chunks (lazy, browser only): ${adminChunks.join(', ')}; ` +
        `deletion panel chunks (lazy, browser only): ${deletionChunks.join(', ')}; ` +
        `initial browser chunks: ${initial.size}; marked chunks: ${marked.size}.`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `Session, auth or admin code found in the public web bundle:\n${failures.join('\n')}`,
  );
  process.exit(1);
}
console.log(`Public web bundle clean: ${scanned.length} files, ${markers.length} markers.`);
