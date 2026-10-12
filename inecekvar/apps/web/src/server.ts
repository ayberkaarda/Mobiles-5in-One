import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule } from '@angular/ssr/node';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebApp } from './server/app';
import { loadWebServerConfig } from './server/config';
import { MemoryLruPageCache } from './server/page-cache';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const config = loadWebServerConfig(process.env);
const angularApp = new AngularNodeAppEngine({
  allowedHosts: config.allowedHosts,
  trustProxyHeaders: false,
});
const app = createWebApp({
  config,
  render: (request) => angularApp.handle(request),
  browserDistFolder,
  cache: new MemoryLruPageCache({
    maxEntries: config.cacheMaxEntries,
    maxBytes: config.cacheMaxBytes,
  }),
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const host = process.env['HOST'] || '127.0.0.1';
  const port = Number(process.env['PORT'] || 4000);
  const server = createServer(
    { maxHeaderSize: 16384, requestTimeout: 30_000, headersTimeout: 15_000 },
    app,
  );
  server.listen(port, host, () => {
    console.log(`Node Express server listening on http://${host}:${port}`);
  });
}

// Request handler used by the Angular CLI dev server and during the build.
export const reqHandler = createNodeRequestHandler(app);
