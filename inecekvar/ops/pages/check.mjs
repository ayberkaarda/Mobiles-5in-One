// Serves a checkout of the Pages branch under /Mobiles-5in-One/ (as GitHub Pages does) and checks
// that every link and asset inside one project folder resolves, plus the leak patterns.
//
//   node inecekvar/ops/pages/check.mjs --root <pages checkout> [--folder inecekvar] [--port 58830]
import { readFile, readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, list) =>
        index % 2 === 0 ? [...pairs, [value.replace(/^--/, ''), list[index + 1]]] : pairs,
      [],
    ),
);
const root = args.root;
const folder = args.folder ?? 'inecekvar';
const port = Number(args.port ?? 58830);
const prefix = '/Mobiles-5in-One/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

async function resolveFile(urlPath) {
  if (!urlPath.startsWith(prefix)) return null;
  const relative = normalize(decodeURIComponent(urlPath.slice(prefix.length))).replace(
    /^(\.\.[/\\])+/,
    '',
  );
  let file = join(root, relative);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    await stat(file);
    return file;
  } catch {
    return null;
  }
}

const server = http.createServer(async (request, response) => {
  const urlPath = new URL(request.url, 'http://x').pathname;
  const file = await resolveFile(urlPath);
  if (!file) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  response.end(await readFile(file));
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${port}`;

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

const files = await walk(join(root, folder));
const htmlFiles = files.filter((file) => file.endsWith('.html'));
const targets = new Map();
let leaks = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (/localhost|127\.0\.0\.1|:58\d{3}/.test(text) && /\.(html|css|svg|txt|xml)$/.test(file)) {
    console.log(`leak pattern in ${file}`);
    leaks += 1;
  }
  if (!file.endsWith('.html')) continue;
  const pagePath =
    prefix +
    file
      .slice(root.length + 1)
      .replace(/\\/g, '/')
      .replace(/index\.html$/, '');
  const baseHref = text.match(/<base href="([^"]+)">/)?.[1] ?? pagePath;
  for (const match of text.matchAll(/\s(?:href|src)="([^"#]+)/g)) {
    const ref = match[1].replace(/&amp;/g, '&');
    if (/^[a-z]+:/i.test(ref) && !ref.startsWith('https://ayberkaarda.github.io/')) continue;
    const url = new URL(ref, 'https://ayberkaarda.github.io' + baseHref);
    if (url.origin !== 'https://ayberkaarda.github.io') continue;
    if (!targets.has(url.pathname)) targets.set(url.pathname, file);
  }
}

let broken = 0;
for (const [path, from] of targets) {
  const status = (await fetch(origin + path)).status;
  if (status !== 200) {
    broken += 1;
    console.log(`broken ${status} ${path} (from ${from.slice(root.length + 1)})`);
  }
}
const sample = [
  '',
  'ornek-test-sehri/',
  'ornek-test-sehri/hat/ornek-hat-1/',
  'ornek-test-sehri/durak/ornek-durak-1-1/',
  'rehber/',
  'sss/',
  '404.html',
];
for (const page of sample) {
  const response = await fetch(`${origin}${prefix}${folder}/${page}`);
  console.log(`${response.status} ${prefix}${folder}/${page}`);
}
console.log(`root landing: ${(await fetch(origin + prefix)).status} ${prefix}`);
console.log(
  `${htmlFiles.length} pages, ${files.length} files, ${targets.size} distinct link and asset targets, ${broken} broken, ${leaks} leak pattern files`,
);
server.close();
process.exitCode = broken + leaks > 0 ? 1 : 0;
