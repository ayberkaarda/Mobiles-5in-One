import { randomBytes } from 'node:crypto';

import { type WebEnv } from '@kadro/config';
import { type NextRequest, NextResponse } from 'next/server';

import { corsResponseHeaders, isPreflight, preflightHeaders } from './cors';
import { newRequestId, REQUEST_ID_HEADER } from './request-context';
import {
  API_CONTENT_SECURITY_POLICY,
  type HeaderEntry,
  NONCE_HEADER,
  pageContentSecurityPolicy,
  STATIC_SECURITY_HEADERS,
  surfaceFor,
  surfaceHeaders,
} from './security-headers';

/**
 * Request proxy logic (`proxy.ts`, the Next.js 16 name of the `middleware.ts` convention).
 *
 * - Assigns every request a fresh `x-request-id`, replacing any client-supplied value, and
 *   forwards it to route handlers (security checklist item 14).
 * - Classifies the path into a surface of the shared table (`SURFACES` in
 *   `security-headers.ts`, ADR-0021, ADR-0055) and sends that surface's headers.
 * - HTML surfaces (pages and error pages): per-request nonce CSP with `'strict-dynamic'`
 *   (item 9). Next.js reads the nonce from the forwarded `Content-Security-Policy` request header
 *   and applies it to its own scripts; server components read it from `x-nonce`.
 * - API surface (`/api/**`): answers CORS preflights and adds CORS headers for allowed origins
 *   (item 8), plus a deny-all CSP and `Cache-Control: no-store`.
 * - Every response: HSTS, `nosniff`, Referrer-Policy, Permissions-Policy, `X-Frame-Options`,
 *   then the surface's Referrer-Policy, `X-Robots-Tag` and `Cache-Control`.
 */

export type ProxyEnv = Pick<WebEnv, 'NODE_ENV' | 'APP_ENV' | 'WEB_ORIGIN' | 'CORS_ALLOWED_ORIGINS'>;

export { NONCE_HEADER };

function applyHeaders(target: Headers, entries: readonly HeaderEntry[]): void {
  for (const { key, value } of entries) {
    target.set(key, value);
  }
}

export function handleProxyRequest(request: NextRequest, env: ProxyEnv): NextResponse {
  const requestId = newRequestId();
  const forwarded = new Headers(request.headers);
  forwarded.set(REQUEST_ID_HEADER, requestId);

  const surface = surfaceFor(request.nextUrl.pathname);
  let response: NextResponse;
  let contentSecurityPolicy: string;

  if (surface.csp === 'deny-all') {
    contentSecurityPolicy = API_CONTENT_SECURITY_POLICY;
    if (isPreflight(request)) {
      response = new NextResponse(null, { status: 204, headers: preflightHeaders(request, env) });
    } else {
      response = NextResponse.next({ request: { headers: forwarded } });
      corsResponseHeaders(request.headers.get('origin'), env).forEach((value, key) => {
        response.headers.set(key, value);
      });
    }
  } else {
    const nonce = randomBytes(16).toString('base64');
    contentSecurityPolicy = pageContentSecurityPolicy({
      nonce,
      allowEval: env.NODE_ENV === 'development',
      upgradeInsecureRequests: env.APP_ENV !== 'local',
    });
    forwarded.set(NONCE_HEADER, nonce);
    forwarded.set('Content-Security-Policy', contentSecurityPolicy);
    response = NextResponse.next({ request: { headers: forwarded } });
  }

  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  applyHeaders(response.headers, STATIC_SECURITY_HEADERS);
  applyHeaders(response.headers, surfaceHeaders(surface));
  return response;
}
