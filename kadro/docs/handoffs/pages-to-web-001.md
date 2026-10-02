# Handoff pages → web 001

- From: email-link pages (`apps/web/app/(app)/**`, `apps/web/components/auth/**`,
  `apps/web/lib/client/**`, `apps/web/tests/pages/**`, Phase 2, ADR-0040)
- To: owner of the `apps/web` request proxy and security headers (`proxy.ts`,
  `lib/server/proxy-handler.ts`, `lib/server/security-headers.ts`) and of the app root files
- Status: open (changes already made, minimal; please review and take ownership)

## 1. Per-path headers for the email-link pages (made)

ADR-0040 requires `X-Robots-Tag: noindex, nofollow` on the five pages and `Referrer-Policy:
no-referrer` plus `Cache-Control: no-store` on `/e-posta-dogrula` and `/sifre-sifirla`. The proxy
sets the site-wide `Referrer-Policy` on every response and overrides `next.config.ts` headers, so
the change has to live in the proxy:

- `lib/server/security-headers.ts`: `EMAIL_LINK_PAGE_PATHS`, `TOKEN_PAGE_PATHS` and
  `pagePathHeaders(pathname)` (exact path match, no runtime dependencies).
- `lib/server/proxy-handler.ts`: one added call that applies `pagePathHeaders(pathname)` after
  the static headers, so `no-referrer` replaces the site-wide value. Nothing else changed; `/`
  and the API keep their headers.

Tests: `tests/pages/page-headers.test.ts` (proxy, unit) and `tests/pages/built-pages.test.ts`
(production build). ADR-0021 asks for one path-class module shared with `headers-check.ts`; when
that module lands, move the two path lists into it. `TOKEN_PAGES` in `lib/client/token-capture.ts`
must stay equal to `TOKEN_PAGE_PATHS` (asserted in `page-headers.test.ts`).

## 2. `apps/web/instrumentation-client.ts` (new)

ADR-0040 step 2 says the token leaves the address bar before any other script runs. Stripping it
in the page's own client module is too late: Next.js reads `window.location` for its router state
before page modules are evaluated and writes that URL, fragment included, back into the history
entry when it hydrates (reproduced in `tests/pages/browser.test.ts`). `instrumentation-client.ts`
runs before hydration and only imports `lib/client/token-capture.ts`, which acts on the two token
paths and leaves every other page's fragment alone. If the file later gains other client
instrumentation, the token capture import must stay first.

## 3. Open points

- `DELETE /api/v1/me` (ADR-0032) is called by `/hesap-silme` with the password re-auth body, the
  `x-csrf-token` header (value read from the CSRF cookie) and `x-kadro-client: web`, and reads
  `graceUntil` from the 202 body. The route is being added in parallel
  (`lib/server/account/deletion.ts`); until it ships, 404/405 show the generic "try later" state.
  Error codes the page maps: `unauthenticated`, `account_deactivated`, `csrf_failed` (sign in),
  `reauth_required`, `invalid_credentials`, `step_up_required`, `deletion_pending`, `last_admin`.
- The Playwright + axe flows of ADR-0027/ADR-0040 are not part of this change; the browser suite
  in `tests/pages/browser.test.ts` (headless Chrome or Edge over the DevTools protocol, skipped
  without a local browser) covers the token-removal part of T-WEB-01.
