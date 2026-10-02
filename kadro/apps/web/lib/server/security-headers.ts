/**
 * Security response headers (security checklist item 9, threat model §6.2). This module has no
 * runtime dependencies because `next.config.ts` imports it.
 *
 * Responsibilities:
 * - `next.config.ts` `headers()` sends {@link STATIC_SECURITY_HEADERS} on every route, including
 *   static assets that the proxy does not run for, and `Cache-Control: no-store` on `/api/*`.
 * - `proxy.ts` sends the per-request nonce CSP on pages and error pages, the strict API CSP on
 *   `/api/*`, and repeats the static headers so a response never depends on one layer only.
 */

export const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';
export const REFERRER_POLICY_VALUE = 'strict-origin-when-cross-origin';
export const PERMISSIONS_POLICY_VALUE = 'camera=(), microphone=(), geolocation=(self)';

export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}

export const STATIC_SECURITY_HEADERS: readonly HeaderEntry[] = [
  { key: 'Strict-Transport-Security', value: HSTS_VALUE },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: REFERRER_POLICY_VALUE },
  { key: 'Permissions-Policy', value: PERMISSIONS_POLICY_VALUE },
  { key: 'X-Frame-Options', value: 'DENY' },
];

export const API_CACHE_HEADERS: readonly HeaderEntry[] = [
  { key: 'Cache-Control', value: 'no-store' },
];

/** Email-link pages (ADR-0040): app surfaces that are never indexed. */
export const EMAIL_LINK_PAGE_PATHS: readonly string[] = [
  '/e-posta-dogrula',
  '/sifre-sifirla',
  '/sifremi-unuttum',
  '/giris',
  '/hesap-silme',
];

/** Pages that read a token from the URL fragment (ADR-0040, threat model T-WEB-01). */
export const TOKEN_PAGE_PATHS: readonly string[] = ['/e-posta-dogrula', '/sifre-sifirla'];

const NOINDEX_HEADERS: readonly HeaderEntry[] = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const TOKEN_PAGE_HEADERS: readonly HeaderEntry[] = [
  ...NOINDEX_HEADERS,
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store' },
];

/**
 * Extra headers of one page path, applied after {@link STATIC_SECURITY_HEADERS} so the token
 * pages' `Referrer-Policy: no-referrer` replaces the site-wide value.
 */
export function pagePathHeaders(pathname: string): readonly HeaderEntry[] {
  if (TOKEN_PAGE_PATHS.includes(pathname)) {
    return TOKEN_PAGE_HEADERS;
  }
  return EMAIL_LINK_PAGE_PATHS.includes(pathname) ? NOINDEX_HEADERS : [];
}

/** JSON responses never render, so the API policy denies everything. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

export interface PageCspOptions {
  readonly nonce: string;
  /** React development builds need `eval` for error overlays; never set in production. */
  readonly allowEval: boolean;
  /** Adds `upgrade-insecure-requests`; off for the plain-http local environment. */
  readonly upgradeInsecureRequests: boolean;
}

/**
 * Nonce-based CSP for HTML. `'strict-dynamic'` lets scripts loaded by nonced scripts run, so no
 * host allow-list is needed. Style elements need the nonce; inline `style` attributes are
 * allowed through `style-src-attr` because React escapes them and they cannot execute script.
 */
export function pageContentSecurityPolicy(options: PageCspOptions): string {
  const nonce = `'nonce-${options.nonce}'`;
  const directives = [
    "default-src 'self'",
    `script-src 'self' ${nonce} 'strict-dynamic'${options.allowEval ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${nonce}`,
    `style-src-elem 'self' ${nonce}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (options.upgradeInsecureRequests) {
    directives.push('upgrade-insecure-requests');
  }
  return directives.join('; ');
}
