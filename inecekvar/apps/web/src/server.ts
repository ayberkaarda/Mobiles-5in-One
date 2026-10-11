import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.disable('x-powered-by');

// Hashed static build output from /browser.
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// Every other request is rendered by the Angular application.
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

// Starts the server when run directly. It binds to loopback unless HOST names another
// interface (a deployment sets it); the port comes from PORT (default 4000). The Host header
// is still checked against security.allowedHosts whatever the bind address.
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const host = process.env['HOST'] || '127.0.0.1';
  const port = Number(process.env['PORT'] || 4000);
  app.listen(port, host, () => {
    console.log(`Node Express server listening on http://${host}:${port}`);
  });
}

// Request handler used by the Angular CLI dev server and during the build.
export const reqHandler = createNodeRequestHandler(app);
