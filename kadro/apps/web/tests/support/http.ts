import { type ProblemDetails, problemDetailsSchema } from '@kadro/contracts';
import { expect } from 'vitest';

import { type RouteHandler } from '../../lib/server/http';

export interface CallOptions {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array | ReadableStream<Uint8Array>;
  readonly json?: unknown;
  readonly params?: Readonly<Record<string, string | string[]>>;
}

/** Invokes a route handler the way Next.js does: a `Request` plus `{ params: Promise }`. */
export function call(handler: RouteHandler, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  } else if (options.body !== undefined) {
    body = options.body as BodyInit;
  }
  const init: RequestInit & { duplex?: 'half' } = {
    method: options.method ?? 'GET',
    headers,
    body,
  };
  if (body instanceof ReadableStream) {
    init.duplex = 'half';
  }
  const request = new Request(`https://kadro.app${options.path ?? '/api/v1/test'}`, init);
  return handler(request, { params: Promise.resolve(options.params ?? {}) });
}

/** Parses and schema-checks a problem body, asserting the shared response headers. */
export async function expectProblem(
  response: Response,
  status: number,
  code: string,
): Promise<ProblemDetails> {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const body = problemDetailsSchema.parse(JSON.parse(text));
  expect(body.code).toBe(code);
  expect(body.status).toBe(status);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  return body;
}

export const MOBILE = { 'x-kadro-client': 'mobile' } as const;
export const WEB = { 'x-kadro-client': 'web' } as const;
