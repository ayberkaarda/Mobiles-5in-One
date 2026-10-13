// Same-origin reverse proxy for the admin e2e run, shaped like ops/Caddyfile: `/api/*` goes to
// the API with the prefix stripped, everything else to the SSR web server. The web server itself
// answers GET and HEAD only (ADR-0038), so mutations must never reach it; in production Caddy
// routes `/api/*` before the web server, as here.
//
// The local API allows cookie sign-in only from its configured web origins (http://localhost:4200
// and :8100 in `local`); IV_E2E_ORIGIN presents one of them for browser requests, as the phase 3
// PWA run does (ADR-0035). Binds to 127.0.0.1 only.
import { createServer, request } from 'node:http';

const port = Number(process.env.IV_E2E_ADMIN_PROXY_PORT ?? 57996);
const api = new URL(process.env.IV_E2E_API ?? 'http://127.0.0.1:57947');
const web = new URL(process.env.IV_E2E_WEB ?? 'http://127.0.0.1:57992');
const presentedOrigin = process.env.IV_E2E_ORIGIN ?? 'http://localhost:4200';

function forward(req, res, target, isApi) {
  const headers = { ...req.headers, host: isApi ? target.host : req.headers.host };
  // A spec may name its client address (`x-e2e-client-ip`), so one run's quota windows (per
  // client IP) do not spill into the next spec; Caddy sets the real peer the same way.
  const clientIp = req.headers['x-e2e-client-ip'];
  delete headers['x-e2e-client-ip'];
  if (isApi) {
    headers['x-real-ip'] =
      typeof clientIp === 'string' && /^[0-9.]{7,15}$/.test(clientIp) ? clientIp : '127.0.0.1';
    if (headers.origin) headers.origin = presentedOrigin;
    delete headers.referer;
  }
  const upstream = request(target, { method: req.method, headers }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(isApi ? 'api unreachable' : 'web unreachable');
  });
  req.pipe(upstream);
}

createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/__proxy/ready') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (url === '/api' || url.startsWith('/api/')) {
    forward(req, res, new URL(url.slice('/api'.length) || '/', api), true);
    return;
  }
  forward(req, res, new URL(url, web), false);
}).listen(port, '127.0.0.1');
