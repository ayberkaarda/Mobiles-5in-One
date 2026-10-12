// Serves the production build of the PWA like Caddy does locally: static files with an SPA
// fallback, and /api/* proxied to the API with the prefix stripped (ops/Caddyfile api_proxy).
// Binds to 127.0.0.1 only. Environment: IV_E2E_PORT, IV_E2E_API, IV_E2E_ROOT.
import { createReadStream, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(process.env.IV_E2E_ROOT ?? join(here, '../../dist/apps/mobile/browser'));
const port = Number(process.env.IV_E2E_PORT ?? 57990);
const api = new URL(process.env.IV_E2E_API ?? 'http://127.0.0.1:57980');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function proxy(req, res) {
  const target = new URL(req.url.replace(/^\/api/, '') || '/', api);
  const headers = { ...req.headers, host: target.host, 'x-real-ip': '127.0.0.1' };
  const upstream = request(target, { method: req.method, headers }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('api unreachable');
  });
  req.pipe(upstream);
}

function file(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let path = normalize(join(root, pathname));
  if (path !== root && !path.startsWith(root + sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  let stat = file(path);
  if (!stat) {
    // Unknown paths with an extension are missing files; everything else is an app route.
    if (extname(pathname)) {
      res.writeHead(404);
      res.end();
      return;
    }
    path = join(root, 'index.html');
    stat = file(path);
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(path).pipe(res);
}

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) proxy(req, res);
  else serveStatic(req, res);
}).listen(port, '127.0.0.1', () => {
  console.log(`mobile-e2e server on http://127.0.0.1:${port} (api ${api.origin})`);
});
