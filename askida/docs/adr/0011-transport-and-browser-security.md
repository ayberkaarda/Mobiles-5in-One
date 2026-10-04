# ADR-0011: Transport and browser security

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Specification items 8, 9, 10 and 12 cover CORS, security headers, HTTPS and cookies, and item 6
sets the body size limit. The server serves a JSON API, Blade pages, the Filament admin panel and
(later) payment pages, behind an edge proxy.

## Decision

### Security headers

- A global middleware builds headers with the `bepsvpt/secure-headers` builders (not the package
  middleware) so that it can choose a CSP profile per route class and create a per-request nonce
  (24 base64 characters). The nonce is registered with the Vite helper, so `@vite` and Livewire use
  it, and Blade has a `@nonce` directive.
- Every route class sends: `X-Content-Type-Options: nosniff`, `X-Frame-Options: deny`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: geolocation=(self), camera=(), microphone=()`, COOP `same-origin`, CORP
  `same-site`, `X-Permitted-Cross-Domain-Policies: none`; `Server` and `X-Powered-By` are removed.
- HSTS (`max-age=63072000; includeSubDomains; preload`) is sent when the request is secure after
  trusted-proxy handling, or when `SECURITY_HSTS_FORCE` is true (for a TLS-terminating hop that is
  not trusted).
- Public CSP: `default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'nonce-…';
img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'none'`.
- API CSP: `default-src 'none'` and nothing else, plus `Cache-Control: no-store`.
- `/pay/*`: the public policy plus `frame-src` from `SECURITY_CSP_FRAME_SRC_PAY` (comma list). An
  empty list gives `frame-src 'none'`. Further hosts for the payment integration must be added as a
  reviewed profile change in the payment phase.
- `/admin/*` relaxations, each found by loading the real login page and reading the panel layout; a
  test fails if the page references an external host not covered:
  - `script-src 'unsafe-inline'`: the panel layout has inline theme and Livewire configuration
    scripts without a nonce.
  - `script-src 'unsafe-eval'`: Alpine.js, bundled with Livewire, evaluates expressions with the
    Function constructor.
  - `style-src 'unsafe-inline'`: inline style blocks and attributes.
  - `https://fonts.bunny.net` in `style-src` and `font-src`: the panel's default font provider.
  - `https://ui-avatars.com` in `img-src`: the default avatar provider after sign-in.
  - No nonce on admin, because a nonce makes browsers ignore `'unsafe-inline'`.
  - Residual risk: on admin pages XSS is mitigated by Blade escaping and not by CSP. Removing the
    font and avatar hosts needs local providers in the panel configuration.

### CORS

`api/*` only. Allowed origins come from `SECURITY_CORS_ALLOWED_ORIGINS` (default
`https://askida.app`); any entry containing `*` is dropped; credentials are off. With exactly one
plain origin the CORS library answers that origin to every caller, so each origin is also listed as an
exact anchored pattern, which switches the library to per-request matching: a foreign origin receives
no `Access-Control-Allow-Origin` and `Vary: Origin` is set. Methods GET, POST, PUT, PATCH, DELETE,
OPTIONS; request headers Accept, Accept-Language, Authorization, Content-Type, X-Request-Id; exposed
headers X-Request-Id and Retry-After; preflight cache 600 seconds.

### Proxies and HTTPS

- `TRUSTED_PROXIES` is a comma list of addresses or CIDR ranges. Empty means none (an empty array).
  The framework default (null) trusts any caller whose Host ends in certain hosting-vendor domains,
  which a client can spoof; a test proves this. `*` is honoured only as the whole value (trust the
  direct peer, for deployments reachable only through their own reverse proxy); a `*` inside a list
  is dropped.
- Outside local and testing the URL generator forces `https`, and an enforcement middleware (after
  proxy handling) rejects plain HTTP: API calls get 403 `https_required` (no redirect, so credentials
  are not resent in clear), web GET and HEAD get a 301 to `https://` plus the host of `APP_URL` (never
  the Host header, so it cannot be an open redirect), other web methods get 403. `/up` is exempt for
  the container health check.
- Edge proxy requirement: Caddy or nginx in front must redirect port 80 to HTTPS and set
  `X-Forwarded-Proto` and `X-Forwarded-For`. The proxy's address must be in `TRUSTED_PROXIES`, else
  HSTS and secure-request detection do not see HTTPS (or set `SECURITY_HSTS_FORCE`). The in-container
  nginx serves plain HTTP behind the edge and needed no change.

### Sessions and cookies

- Outside local and testing, regardless of environment values: cookie `__Host-askida_session`, `Secure`,
  `HttpOnly`, path `/`, no domain; `SameSite` is `lax` (the environment may choose `strict`, never
  `none`). Local and testing keep environment values and the name `askida_session`.
- Admin strictness: Laravel has one session configuration per request, not per guard, and the admin
  panel starts the framework session, so `SameSite` cannot be set per guard in the panel. A global
  middleware before session start switches `/admin/*` and `livewire/*` requests to a separate cookie
  `__Host-askida_admin_session` with `SameSite=strict` and resets the session manager's cached driver.
  The public cookie stays `lax`.
- Limits: following a link to `/admin` from another site arrives without the admin cookie and shows
  the login page; this is intended. `livewire/*` is treated as admin, which holds while public pages
  use no Livewire. The `XSRF-TOKEN` cookie name is shared and takes the `SameSite` of the last response.
- CSRF stays on for web routes and the panel. The API group has no session or cookies.

### Body limits

1 MB for every request and 6 MB for `api/v1/shops/*/documents`. The application middleware uses the
declared Content-Length, or the actual length when absent, and answers 413 `payload_too_large`.
nginx has `client_max_body_size 1m` with a 6m location for the documents path; the application
constants and the nginx values must change together.

## Consequences

- Admin pages carry a weaker CSP than the rest of the site; this is recorded and tested, not hidden.
- Production needs a correct `TRUSTED_PROXIES` value; a wrong value makes HTTPS look absent.
- Payment pages need a reviewed CSP change when the integration is built.

## Not exercised / limits

- HSTS preload and TLS on a real domain were not exercised (ADR-0006, gate G13). The edge redirect on
  port 80 was documented, not run: there is no Caddy in the compose stack.
- Evidence: `tests/Feature/Security/HeadersTest.php`, `HeadersHttpsTest.php`, `CorsTest.php`,
  `CookiesTest.php`, `ErrorsBodySizeTest.php`, `tests/Feature/WelcomePageTest.php`.
- Browser enforcement of CSP and cookies was asserted through response headers, not in a browser.
