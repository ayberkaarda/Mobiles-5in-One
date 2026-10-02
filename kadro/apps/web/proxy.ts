import { loadWebEnv } from '@kadro/config';
import { type NextRequest, type NextResponse } from 'next/server';

import { handleProxyRequest } from './lib/server/proxy-handler';

/**
 * Next.js 16 request proxy (the file convention formerly named `middleware.ts`): request ids,
 * nonce CSP, CORS and security headers. See `lib/server/proxy-handler.ts`.
 */
export function proxy(request: NextRequest): NextResponse {
  return handleProxyRequest(request, loadWebEnv());
}

/**
 * Every path runs through the proxy except exact static assets: files under `/_next/static/`,
 * the image optimizer endpoint `/_next/image` and `/favicon.ico` (dot escaped, end anchored), so
 * look-alike paths such as `/favicon.ico/x` or `/faviconXico` still get the nonce CSP and a
 * request id. `tests/proxy-matcher.test.ts` compiles this matcher with Next.js itself.
 */
export const config = {
  matcher: ['/((?!_next/static/|_next/image$|favicon\\.ico$).*)'],
};
