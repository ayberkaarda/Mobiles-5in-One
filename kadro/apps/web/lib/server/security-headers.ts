/**
 * Security response headers (security checklist item 9, threat model §6.2). This module has no
 * runtime dependencies because `next.config.ts` imports it, and it uses only erasable TypeScript
 * syntax because `scripts/security/headers-check.ts` loads it with Node.js type stripping.
 *
 * Responsibilities:
 * - `next.config.ts` `headers()` sends {@link STATIC_SECURITY_HEADERS} on every route, including
 *   static assets that the proxy does not run for, and `Cache-Control: no-store` on `/api/*`.
 * - `proxy.ts` classifies every request path into one of the {@link SURFACES} (ADR-0021,
 *   ADR-0055), sends that surface's CSP (per-request nonce for HTML, deny-all for JSON) and
 *   per-surface headers, and repeats the static headers so a response never depends on one layer
 *   only. `headers-check.ts` asserts the same table against a running server.
 */

export const HSTS_VALUE = 'max-age=63072000; includeSubDomains; preload';
export const REFERRER_POLICY_VALUE = 'strict-origin-when-cross-origin';
export const PERMISSIONS_POLICY_VALUE = 'camera=(), microphone=(), geolocation=(self)';
export const NOINDEX_VALUE = 'noindex, nofollow';
export const NO_STORE_VALUE = 'no-store';

/**
 * Request header through which the proxy hands the response's CSP nonce to server components
 * (`components/seo/json-ld.tsx`); it is set on the forwarded request only, never on a response.
 */
export const NONCE_HEADER = 'x-nonce';

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
  { key: 'Cache-Control', value: NO_STORE_VALUE },
];

/** `nonce`: per-request nonce CSP, dynamic render (HTML). `deny-all`: JSON responses. */
export type CspVariant = 'nonce' | 'deny-all';

export type SurfaceName = 'api' | 'token-page' | 'email-link-page' | 'marketing' | 'seo' | 'app';

/** One row of the surface table: which paths it covers and which headers they get. */
export interface Surface {
  readonly name: SurfaceName;
  /** Exact paths, or `/base/**` for `/base` itself and every path below it (whole segments). */
  readonly paths: readonly string[];
  /** A path of this surface that `headers-check.ts` and the tests request. */
  readonly probe: string;
  readonly csp: CspVariant;
  /** Sends `X-Robots-Tag: noindex, nofollow`. */
  readonly noindex: boolean;
  readonly referrerPolicy: string;
  /**
   * `Cache-Control` set by the proxy; `null` leaves it to Next.js, which marks dynamic pages
   * `private, no-cache, no-store, max-age=0, must-revalidate`.
   */
  readonly cacheControl: string | null;
}

/**
 * The surface table (ADR-0021, decided in ADR-0055). Route groups do not appear in URLs, so the
 * proxy classifies by path; the first matching row wins and the last row (`app`, no paths) takes
 * every other path. Every HTML surface keeps the nonce CSP and renders per request: ADR-0055
 * found that a hash-based CSP cannot follow static or ISR HTML. A new public route therefore
 * defaults to `app` until it is listed under `marketing` or `seo`.
 */
export const SURFACES: readonly Surface[] = [
  {
    name: 'api',
    paths: ['/api/**'],
    probe: '/api/v1/health',
    csp: 'deny-all',
    noindex: false,
    referrerPolicy: REFERRER_POLICY_VALUE,
    cacheControl: NO_STORE_VALUE,
  },
  {
    // Pages that read a token from the URL fragment (ADR-0040, threat model T-WEB-01).
    name: 'token-page',
    paths: ['/e-posta-dogrula', '/sifre-sifirla'],
    probe: '/sifre-sifirla',
    csp: 'nonce',
    noindex: true,
    referrerPolicy: 'no-referrer',
    cacheControl: NO_STORE_VALUE,
  },
  {
    // The other email-link pages (ADR-0040): app surfaces that are never indexed.
    name: 'email-link-page',
    paths: ['/sifremi-unuttum', '/giris', '/hesap-silme'],
    probe: '/giris',
    csp: 'nonce',
    noindex: true,
    referrerPolicy: REFERRER_POLICY_VALUE,
    cacheControl: null,
  },
  {
    // `(marketing)` route group (ADR-0021 group 2, rendering per ADR-0055).
    name: 'marketing',
    paths: [
      '/',
      '/ozellikler',
      '/hakkinda',
      '/sss',
      '/gizlilik',
      '/kvkk-aydinlatma',
      '/iletisim',
      '/blog/**',
    ],
    probe: '/',
    csp: 'nonce',
    noindex: false,
    referrerPolicy: REFERRER_POLICY_VALUE,
    cacheControl: null,
  },
  {
    // `(seo)` route group: programmatic pages (ADR-0021 group 2, rendering per ADR-0055).
    name: 'seo',
    paths: ['/sahalar/**', '/saha/**', '/eksik-var/**'],
    probe: '/sahalar/istanbul',
    csp: 'nonce',
    noindex: false,
    referrerPolicy: REFERRER_POLICY_VALUE,
    cacheControl: null,
  },
  {
    // ADR-0021 group 1: `(app)` pages, `/admin/**`, `/mac/[inviteCode]`, the 404 page and every
    // path not listed above.
    name: 'app',
    paths: [],
    probe: '/headers-check-missing-page',
    csp: 'nonce',
    noindex: false,
    referrerPolicy: REFERRER_POLICY_VALUE,
    cacheControl: null,
  },
];

function matches(pattern: string, pathname: string): boolean {
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3);
    return pathname === base || pathname.startsWith(`${base}/`);
  }
  return pathname === pattern;
}

/** A `%` not followed by two hex digits: the path cannot be decoded unambiguously. */
const INVALID_ESCAPE = /%(?![0-9a-f]{2})/i;
/** Encoded `/`, `\`, NUL and other control characters: they could rejoin or split segments. */
const AMBIGUOUS_ESCAPE = /%(?:2f|5c|[01][0-9a-f]|7f)/i;
/** Raw backslashes and control characters (some clients and servers treat `\` as `/`). */
function hasAmbiguousCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) {
      return true;
    }
  }
  return false;
}

/**
 * The path the surface table is matched against (ADR-0055), or `null` when the path is ambiguous
 * and the proxy rejects it with 400.
 *
 * The router may match a page by its decoded path, so classification decodes too, exactly once
 * (`%252d` stays the text `%2d`). Matching is case-insensitive and ignores empty segments (`//`,
 * trailing `/`) and dot segments, so every spelling that could reach a page gets that page's
 * headers; spellings the router does not serve then only receive stricter headers on a 404.
 * Encoded separators, control characters and invalid escapes have no single meaning and are
 * refused instead of guessed.
 */
export function canonicalPath(pathname: string): string | null {
  if (
    INVALID_ESCAPE.test(pathname) ||
    AMBIGUOUS_ESCAPE.test(pathname) ||
    hasAmbiguousCharacter(pathname)
  ) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Invalid UTF-8 sequence such as `%E0%A4`.
    return null;
  }
  if (hasAmbiguousCharacter(decoded)) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of decoded.split('/')) {
    if (segment === '..') {
      segments.pop();
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment.toLowerCase());
    }
  }
  return `/${segments.join('/')}`;
}

/**
 * The surface of a request path: exact or whole-segment match on {@link canonicalPath}, never a
 * substring. An ambiguous path falls to the catch-all row here; the proxy rejects it first.
 */
export function surfaceFor(pathname: string): Surface {
  const canonical = canonicalPath(pathname);
  const found =
    canonical === null
      ? undefined
      : SURFACES.find((surface) => surface.paths.some((pattern) => matches(pattern, canonical)));
  // The table ends with the catch-all row, so `found` is only undefined for an empty table.
  return found ?? (SURFACES.at(-1) as Surface);
}

function surfaceNamed(name: SurfaceName): Surface {
  return SURFACES.find((surface) => surface.name === name) as Surface;
}

/** Pages that read a token from the URL fragment (ADR-0040, threat model T-WEB-01). */
export const TOKEN_PAGE_PATHS: readonly string[] = surfaceNamed('token-page').paths;

/** Email-link pages (ADR-0040): the token pages and the other never-indexed app pages. */
export const EMAIL_LINK_PAGE_PATHS: readonly string[] = [
  ...TOKEN_PAGE_PATHS,
  ...surfaceNamed('email-link-page').paths,
];

/**
 * Per-surface headers, applied after {@link STATIC_SECURITY_HEADERS} so a surface's
 * `Referrer-Policy` (`no-referrer` on the token pages) replaces the site-wide value.
 */
export function surfaceHeaders(surface: Surface): readonly HeaderEntry[] {
  const headers: HeaderEntry[] = [{ key: 'Referrer-Policy', value: surface.referrerPolicy }];
  if (surface.noindex) {
    headers.push({ key: 'X-Robots-Tag', value: NOINDEX_VALUE });
  }
  if (surface.cacheControl !== null) {
    headers.push({ key: 'Cache-Control', value: surface.cacheControl });
  }
  return headers;
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
