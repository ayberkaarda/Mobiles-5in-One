import type { Express } from 'express';
import { expect } from 'vitest';
import { once } from 'node:events';
import {
  request,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type Server,
} from 'node:http';
import { NONCE_PLACEHOLDER } from './csp-nonce';

const servers: Server[] = [];

export const fakeHtml =
  '<!doctype html><html><head>' +
  `<style nonce="${NONCE_PLACEHOLDER}">body{color:#14213d}</style></head><body>` +
  `<iv-root ngcspnonce="${NONCE_PLACEHOLDER}">İnecek Var</iv-root>` +
  `<script nonce="${NONCE_PLACEHOLDER}">window.__x=1</script>` +
  `<script NONCE="${NONCE_PLACEHOLDER}">window.__y=2</script>` +
  '<script type="module" src="main.js"></script></body></html>';

export function htmlResponse(status = 200, headers: Record<string, string> = {}): Response {
  return new Response(fakeHtml, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

export interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  bytes: Buffer;
}

export async function startApp(app: Express): Promise<number> {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing server address');
  }
  return address.port;
}

export async function closeServers(): Promise<void> {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
}

export function httpRequest(
  port: number,
  options: {
    path?: string;
    method?: string;
    headers?: OutgoingHttpHeaders | string[];
    body?: string;
  } = {},
): Promise<HttpResult> {
  const headers = Array.isArray(options.headers)
    ? options.headers
    : { Host: 'inecekvar.app', ...options.headers };
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path ?? '/',
        method: options.method ?? 'GET',
        headers,
        setHost: false,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: bytes.toString('utf8'),
            bytes,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

export function responseNonce(result: HttpResult): string {
  const nonce = String(result.headers['content-security-policy']).match(/'nonce-([^']+)'/)?.[1];
  if (!nonce) {
    throw new Error('Missing CSP nonce');
  }
  return nonce;
}

export function renderedRequest(render: { mock: { calls: [Request][] } }, index = 0): Request {
  const request = render.mock.calls[index]?.[0];
  if (!request) {
    throw new Error('Missing render request');
  }
  return request;
}

export function expectNonceAttributes(result: HttpResult): void {
  const nonce = responseNonce(result);
  expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  const attributes = [...result.body.matchAll(/\s(?:nonce|ngcspnonce)="([^"]+)"/gi)];
  expect(attributes.length).toBe(4);
  for (const attribute of attributes) {
    expect(attribute[1]).toBe(nonce);
  }
  const inlineScripts = [...result.body.matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>/gi)];
  expect(inlineScripts.length).toBe(2);
  for (const script of inlineScripts) {
    expect(script[1]).toMatch(new RegExp(`\\snonce="${nonce.replace(/[+]/g, '\\+')}"`, 'i'));
  }
  expect(result.body).not.toMatch(
    new RegExp(`\\s(?:nonce|ngcspnonce)="${NONCE_PLACEHOLDER}"`, 'i'),
  );
}
