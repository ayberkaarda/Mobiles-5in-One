// Static snapshot of the public İnecek Var web for GitHub Pages (see README.md in this folder).
// It crawls a running SSR server (production build, sample seed) and writes plain HTML files whose
// links and assets point at the Pages base path. Scripts are removed, so sign-in, the admin area,
// the deletion panel, the interactive map and every API call stay off in the snapshot.
//
//   node inecekvar/ops/pages/snapshot.mjs --server http://127.0.0.1:58819 --out <dir>
//     [--base /Mobiles-5in-One/inecekvar/] [--site https://ayberkaarda.github.io]
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { dirname, join } from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, value, index, list) =>
        index % 2 === 0 ? [...pairs, [value.replace(/^--/, ''), list[index + 1]]] : pairs,
      [],
    ),
);
const server = new URL(args.server ?? 'http://127.0.0.1:58819');
const out = args.out;
const base = args.base ?? '/Mobiles-5in-One/inecekvar/';
const site = args.site ?? 'https://ayberkaarda.github.io';
const canonical = 'https://inecekvar.app';
const publicBase = site + base;
if (!out) {
  console.error('usage: snapshot.mjs --server <ssr origin> --out <dir>');
  process.exit(2);
}

const SEEDS = [
  '/',
  '/rehber',
  '/sss',
  '/veri',
  '/veri-lisansi',
  '/hakkinda',
  '/gizlilik',
  '/kvkk-aydinlatma',
  '/hesap-silme',
  '/iletisim',
];
const NOT_FOUND_PATH = '/bu-sayfa-bulunamadi/yok';
const SKIP = [/^\/admin/, /^\/api\//, /^\/v1\//, /^\/durum/, /^\/giris/];
const MAX_PAGES = 150;
const NOTICE =
  '<div role="note" style="margin:0;padding:.6rem 1rem;background:#14213D;color:#FFF8E7;font:14px/1.5 system-ui,sans-serif;text-align:center">' +
  'Statik demo: yerel derlemeden alınmış sayfalar, <strong>[ÖRNEK]</strong> etiketli örnek veri. Giriş, formlar, etkileşimli harita ve hesap silme burada çalışmaz. ' +
  `<a href="/Mobiles-5in-One/" style="color:#F2B705">Tüm projeler</a></div>`;

function get(path) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: server.hostname,
        port: server.port,
        path,
        headers: {
          host: new URL(canonical).host,
          'x-forwarded-proto': 'https',
          'accept-language': 'tr',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            type: response.headers['content-type'] ?? '',
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

const hasExtension = (path) => /\.[a-z0-9]{2,8}$/i.test(path.split('?')[0]);
const skip = (path) => SKIP.some((pattern) => pattern.test(path));
const pageFile = (path) =>
  path === '/' ? 'index.html' : join(path.replace(/^\/|\/$/g, ''), 'index.html');
const pageHref = (path) => base + (path === '/' ? '' : path.replace(/^\/|\/$/g, '') + '/');

const pages = new Set();
const queue = [...SEEDS];
const assets = new Set();

function collect(html) {
  const refs = [];
  for (const match of html.matchAll(/(?:href|src|content)="([^"]+)"/g)) refs.push(match[1]);
  for (const match of html.matchAll(/https:\/\/inecekvar\.app(\/[^"'\s<>\\]*)/g))
    refs.push(match[1]);
  for (let ref of refs) {
    ref = ref.replace(/&amp;/g, '&');
    if (ref.startsWith(canonical)) ref = ref.slice(canonical.length) || '/';
    if (/^[a-z]+:|^\/\/|^#|\s|=|,/i.test(ref)) continue;
    // A relative reference resolves against `<base href="/">`; only files are taken that way.
    if (!ref.startsWith('/') && !hasExtension(ref)) continue;
    const path = ref.startsWith('/') ? ref : '/' + ref;
    const clean = path.split('#')[0].split('?')[0];
    if (!clean || skip(clean) || /\.m?js$/.test(clean)) continue;
    if (hasExtension(clean)) assets.add(clean);
    else if (!pages.has(clean) && !queue.includes(clean)) queue.push(clean);
  }
}

function rewrite(html) {
  let text = html
    // Scripts go, except structured data.
    .replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link rel="modulepreload"[^>]*>/g, '')
    .replace(/\s(?:nonce|ngcspnonce|jsaction|ngh|ng-server-context)="[^"]*"/g, '')
    .replace(/<!--nghm-->/g, '')
    .replace(/media="print" data-beasties-media="all"/g, 'media="all"')
    // Links into the app or API cannot work here: keep the text, drop the target.
    .replace(
      /<a\b([^>]*?)\shref="https:\/\/(?:app|api)\.inecekvar\.app[^"]*"([^>]*)>/g,
      '<a$1$2 aria-disabled="true" title="Statik demoda çalışmaz">',
    )
    .replace(/<button\b/g, '<button disabled')
    .replace(/<form\b/g, '<form inert');
  // Canonical absolute URLs move to the Pages origin.
  text = text.replace(/https:\/\/inecekvar\.app(\/[^"'\s<>\\]*)?/g, (all, path = '/') =>
    hasExtension(path)
      ? publicBase + path.replace(/^\//, '')
      : site + pageHref(path.split(/[?#]/)[0]),
  );
  // Root-relative links and assets.
  text = text.replace(/(href|src)="\/(?!\/)([^"]*)"/g, (all, attribute, rest) => {
    const [path, hash] = ('/' + rest).split('#');
    const target = hasExtension(path)
      ? base + path.replace(/^\//, '')
      : pageHref(path.split('?')[0]);
    return `${attribute}="${target}${hash ? '#' + hash : ''}"`;
  });
  // After the root-relative pass, so the base itself is not prefixed twice.
  text = text.replace(/<base href="\/">/, `<base href="${base}">`);
  // Snapshot pages are never indexed.
  if (/<meta name="robots"[^>]*>/.test(text)) {
    text = text.replace(
      /<meta name="robots"[^>]*>/g,
      '<meta name="robots" content="noindex,nofollow">',
    );
  } else {
    text = text.replace('</head>', '<meta name="robots" content="noindex,nofollow"></head>');
  }
  return text.replace(/<body([^>]*)>/, `<body$1>${NOTICE}`);
}

async function save(file, body) {
  const target = join(out, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
}

while (queue.length > 0 && pages.size < MAX_PAGES) {
  const path = queue.shift();
  if (pages.has(path)) continue;
  pages.add(path);
  const response = await get(path);
  if (response.status !== 200 || !response.type.includes('text/html')) {
    console.log(`skip ${path} ${response.status}`);
    continue;
  }
  const html = response.body.toString('utf8');
  collect(html);
  await save(pageFile(path), rewrite(html));
  console.log(`page ${path}`);
}

const missing = await get(NOT_FOUND_PATH);
collect(missing.body.toString('utf8'));
// The not-found page names no canonical address of its own.
const notFound = rewrite(missing.body.toString('utf8'))
  .replace(/<link rel="(?:canonical|alternate)"[^>]*bu-sayfa-bulunamadi[^>]*>/g, '')
  .replace(/<meta property="og:url"[^>]*>/g, '');
await save('404.html', notFound);
console.log(`page 404.html (server status ${missing.status})`);

for (const path of assets) {
  const response = await get(path);
  if (response.status !== 200) {
    console.log(`asset missing ${path} ${response.status}`);
    continue;
  }
  let body = response.body;
  if (path.endsWith('.css')) {
    const css = body.toString('utf8');
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
      const ref = match[1];
      if (/^(data:|https?:|#)/.test(ref)) continue;
      const resolved = new URL(ref, 'http://x' + path).pathname;
      if (!assets.has(resolved)) assets.add(resolved);
    }
    body = Buffer.from(css.replace(/https:\/\/inecekvar\.app\//g, publicBase));
  } else if (/\.(svg|txt|xml)$/.test(path)) {
    body = Buffer.from(body.toString('utf8').replace(/https:\/\/inecekvar\.app\//g, publicBase));
  }
  await save(path.replace(/^\//, ''), body);
  console.log(`asset ${path}`);
}
console.log(`done: ${pages.size} pages visited, ${assets.size} assets`);
