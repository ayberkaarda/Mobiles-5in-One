import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { relative, sep } from 'node:path';
import { BypassRenderLimiter } from './bypass-limiter';
import type { WebServerConfig } from './config';
import { applyNonce, createNonce } from './csp-nonce';
import {
  isAdminPath,
  MemoryLruPageCache,
  pageCacheKey,
  renderPath,
  type PageCacheStore,
} from './page-cache';
import {
  bodyGuard,
  hostGuard,
  methodGuard,
  stripProxyHeaders,
  urlLengthGuard,
} from './request-guards';
import { robotsTxt } from './robots';
import { registerContentFiles } from '../content/llms-route';
import { createApiReader } from './api-reader';
import { registerMachineFiles } from './machine-files';
import { normalizeUrls } from './normalize';
import { helmetOptions, nonceMiddleware, PERMISSIONS_POLICY } from './security-headers';

/** Angular output: `chunk-`, `main-`, `polyfills-`, `styles-` plus an 8-character hash, `media/`. */
const HASHED_OUTPUT =
  /^(?:(?:chunk|main|polyfills|styles|worker)-[A-Za-z0-9_-]{8}\.(?:js|mjs|css)|media\/[^/]+-[A-Z0-9]{8}\.[a-z0-9]+)$/;

export type PageRenderer = (request: Request) => Promise<Response | null>;

const protectedHeaders = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'x-content-type-options',
  'x-frame-options',
  'x-powered-by',
  'x-cache',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

// Body substitution invalidates upstream encoding and validators.
const transformedHeaders = new Set(['content-encoding', 'etag', 'last-modified']);

export function createWebApp(options: {
  config: WebServerConfig;
  render: PageRenderer;
  browserDistFolder?: string;
  cache?: PageCacheStore;
  apiFetch?: typeof fetch;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}): express.Express {
  const { config, render } = options;
  const app = express();
  const cache =
    options.cache ??
    new MemoryLruPageCache({
      maxEntries: config.cacheMaxEntries,
      maxBytes: config.cacheMaxBytes,
    });
  const bypassLimiter = new BypassRenderLimiter(
    config.bypassRenderBurst,
    config.bypassRenderPerMinute,
  );
  const security = helmet(helmetOptions(config));
  const log = (event: string): void => {
    try {
      options.log?.(event);
    } catch {
      // Logging must not change the response.
    }
  };

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  // Probes use loopback even when public hosts are restricted.
  app.get('/healthz', (_req, res) => {
    res.set('Cache-Control', 'no-store').type('text/plain').send('ok');
  });
  app.use(stripProxyHeaders);
  app.use(methodGuard);
  app.use(bodyGuard);
  app.use(urlLengthGuard);
  app.use(hostGuard(config));
  app.use(nonceMiddleware());
  app.use(security);
  app.use((req, res, next) => {
    res.set('Permissions-Policy', PERMISSIONS_POLICY);
    // The client-only admin area is never indexed and never stored (ADR-0041).
    if (isAdminPath(req.path)) {
      res.locals['admin'] = true;
      res.set('X-Robots-Tag', 'noindex, nofollow');
    }
    next();
  });
  app.get('/robots.txt', (_req, res) => {
    res
      .set('Cache-Control', 'public, max-age=3600')
      .type('text/plain; charset=utf-8')
      .send(robotsTxt(config));
  });
  registerContentFiles(app, config.canonicalOrigin);
  registerMachineFiles(app, {
    config,
    reader: createApiReader({ baseUrl: config.apiInternalUrl, fetch: options.apiFetch }),
    cache: new MemoryLruPageCache({
      maxEntries: config.cacheMaxEntries,
      maxBytes: config.cacheMaxBytes,
    }),
  });

  const browserDistFolder = options.browserDistFolder;
  if (browserDistFolder) {
    const staticFiles = express.static(browserDistFolder, {
      index: false,
      redirect: false,
      maxAge: '1y',
      fallthrough: true,
      setHeaders: (res, path) => {
        // Only the build's own fingerprinted output stays fresh for a year; copied assets such as
        // `maplibre/maplibre-gl-worker.mjs` keep their name across upgrades and must revalidate.
        const name = relative(browserDistFolder, path).split(sep).join('/');
        if (!HASHED_OUTPUT.test(name)) {
          res.setHeader('Cache-Control', 'public, max-age=0');
        }
      },
    });
    app.use((req, res, next) => {
      let path: string;
      try {
        path = decodeURIComponent(req.path);
      } catch {
        next();
        return;
      }
      if (/\.html$/i.test(path)) {
        next();
        return;
      }
      staticFiles(req, res, next);
    });
  }

  app.use(normalizeUrls(config.cacheQueryAllowlist));

  app.use(async (req, res, next) => {
    const separator = req.originalUrl.indexOf('?');
    const path = separator < 0 ? req.originalUrl : req.originalUrl.slice(0, separator);
    const query = new URLSearchParams(separator < 0 ? '' : req.originalUrl.slice(separator + 1));
    const key = pageCacheKey(
      {
        method: req.method,
        hostname: res.locals['hostname'],
        path,
        query,
        headers: req.headers,
      },
      config,
    );
    if (key === undefined && !res.locals['admin']) {
      // The admin shell is a static client render; every other bypass costs API calls.
      const retryAfter = bypassLimiter.take(req.socket.remoteAddress ?? 'unknown');
      if (retryAfter > 0) {
        res
          .status(429)
          .set('Retry-After', String(retryAfter))
          .set('Cache-Control', 'no-store')
          .type('text/plain')
          .send('Too many requests');
        return;
      }
    }
    if (config.cacheDebugHeader) {
      res.set('X-Cache', key === undefined ? 'BYPASS' : 'MISS');
    }
    if (key !== undefined) {
      try {
        const page = await cache.get(key);
        if (page) {
          if (config.cacheDebugHeader) {
            res.set('X-Cache', 'HIT');
          }
          res
            .status(page.status)
            .set('Content-Type', page.contentType)
            .set('Cache-Control', 'private, no-cache');
          const body = applyNonce(page.body, res.locals['cspNonce']);
          if (req.method === 'HEAD') {
            res.end();
          } else {
            res.send(body);
          }
          return;
        }
      } catch {
        log('page_cache_read_failed');
      }
    }

    const renderUrl = config.canonicalOrigin + renderPath(path, query, config.cacheQueryAllowlist);
    const response = await render(
      new Request(renderUrl, { method: 'GET', headers: { accept: 'text/html' } }),
    );
    if (response === null) {
      next();
      return;
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const isHtml = contentType.toLowerCase().startsWith('text/html');
    const body = isHtml ? await response.text() : Buffer.from(await response.arrayBuffer());
    if (
      key !== undefined &&
      response.status === 200 &&
      !response.headers.has('set-cookie') &&
      isHtml &&
      typeof body === 'string' &&
      Buffer.byteLength(body, 'utf8') <= 1024 * 1024
    ) {
      try {
        await cache.set(
          key,
          { status: 200, contentType, body, storedAt: Date.now() },
          config.cacheTtlMs,
        );
      } catch {
        log('page_cache_write_failed');
      }
    }
    for (const [name, value] of response.headers) {
      if (
        !protectedHeaders.has(name) &&
        !(isHtml && transformedHeaders.has(name)) &&
        name !== 'set-cookie' &&
        !(isHtml && name === 'cache-control')
      ) {
        res.set(name, value);
      }
    }
    if (response.headers.has('set-cookie')) {
      res.set('Set-Cookie', response.headers.getSetCookie());
    }
    res.status(response.status).set('Content-Type', contentType);
    if (isHtml) {
      res.set('Cache-Control', res.locals['admin'] ? 'no-store' : 'private, no-cache');
    }
    const output = typeof body === 'string' ? applyNonce(body, res.locals['cspNonce']) : body;
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.send(output);
    }
  });

  app.use((_req, res) => {
    res.status(404).set('Cache-Control', 'no-store').type('text/plain').send('Sayfa bulunamadı');
  });
  const errorHandler: ErrorRequestHandler = (_error, req, res, next) => {
    if (res.headersSent) {
      next(_error);
      return;
    }
    log('page_render_failed');
    res.locals['cspNonce'] ??= createNonce();
    security(req, res, () => {
      res.removeHeader('Set-Cookie');
      res
        .status(500)
        .set('Permissions-Policy', PERMISSIONS_POLICY)
        .set('Cache-Control', 'no-store')
        .type('text/html')
        .send(
          '<!doctype html><html lang="tr"><title>Bir sorun oluştu</title>' +
            '<body>Bir sorun oluştu</body></html>',
        );
    });
  };
  app.use(errorHandler);
  return app;
}
