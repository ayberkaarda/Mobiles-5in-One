import { randomUUID } from 'node:crypto';

/**
 * Request correlation (security checklist item 14). `proxy.ts` assigns a fresh id to every
 * request, overwriting anything the client sent, and forwards it to route handlers in this
 * header. The same value is returned to the client in the response header and in every problem
 * body (`requestId`), and it is attached to every log line written for the request.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newRequestId(): string {
  return randomUUID();
}

export function isRequestId(value: string | null | undefined): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/**
 * Returns the id assigned by `proxy.ts`. Handlers invoked without the proxy (unit tests, a
 * misconfigured matcher) get a fresh id; a value that is not a lowercase UUID is never trusted.
 */
export function resolveRequestId(headers: Headers): string {
  const candidate = headers.get(REQUEST_ID_HEADER);
  return isRequestId(candidate) ? candidate : newRequestId();
}
