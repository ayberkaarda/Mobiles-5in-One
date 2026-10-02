import { AUTH_CLIENT_HEADER, CSRF_HEADER } from '@kadro/contracts';

import { REQUEST_ID_HEADER } from './request-context';

/**
 * CORS for `/api/v1` (security checklist item 8, ADR-0014).
 *
 * - Only exact origins from `CORS_ALLOWED_ORIGINS` are echoed; there is no wildcard and an
 *   unknown origin gets no `Access-Control-Allow-*` header at all.
 * - `Access-Control-Allow-Credentials` is sent only for `WEB_ORIGIN`, and only that origin may
 *   send the `x-kadro-client` and `x-csrf-token` headers.
 * - `Vary: Origin` is always present so caches never mix responses for different origins.
 * - Requests without `Origin` (the mobile app, server-to-server) are not affected.
 */

export interface CorsConfig {
  readonly WEB_ORIGIN: string;
  readonly CORS_ALLOWED_ORIGINS: readonly string[];
}

export const CORS_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE';
export const CORS_MAX_AGE_SECONDS = 600;

/** Request headers a browser may send: the web origin gets the client and CSRF headers. */
export function allowedRequestHeaders(origin: string, config: CorsConfig): string {
  return origin === config.WEB_ORIGIN
    ? ['content-type', AUTH_CLIENT_HEADER, CSRF_HEADER].join(', ')
    : 'content-type';
}

export function isAllowedOrigin(origin: string | null, config: CorsConfig): origin is string {
  return origin !== null && config.CORS_ALLOWED_ORIGINS.includes(origin);
}

/** Headers for an actual (non-preflight) API response. */
export function corsResponseHeaders(origin: string | null, config: CorsConfig): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  if (!isAllowedOrigin(origin, config)) {
    return headers;
  }
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Expose-Headers', `${REQUEST_ID_HEADER}, retry-after`);
  if (origin === config.WEB_ORIGIN) {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return headers;
}

export function isPreflight(request: Request): boolean {
  return request.method === 'OPTIONS' && request.headers.has('access-control-request-method');
}

/**
 * Preflight answer. Always 204; for a disallowed origin it carries no `Access-Control-Allow-*`
 * header, so the browser refuses the actual request.
 */
export function preflightHeaders(request: Request, config: CorsConfig): Headers {
  const origin = request.headers.get('origin');
  const headers = corsResponseHeaders(origin, config);
  headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  headers.delete('Access-Control-Expose-Headers');
  if (isAllowedOrigin(origin, config)) {
    headers.set('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
    headers.set('Access-Control-Allow-Headers', allowedRequestHeaders(origin, config));
    headers.set('Access-Control-Max-Age', String(CORS_MAX_AGE_SECONDS));
  }
  return headers;
}
