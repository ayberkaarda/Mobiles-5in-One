# ADR-0040: Email-link pages at the end of Phase 2 — page set, token handling, CSP and accessibility

- Status: Accepted; details [ADR-0027](0027-email-link-landing-pages.md)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0021, ADR-0027, ADR-0029, ADR-0032; threat model T-AUTH-08, T-WEB-01..03, RR-8

## Context

ADR-0027 moves the email-link pages to the end of Phase 2. Phase 2 also adds a deletion
confirmation email (ADR-0032) whose instructions point to a page. The exact page set, the order of
operations around the fragment token, the CSP group and the accessibility bar were open.

## Decision

### Pages delivered at the end of Phase 2

| Path               | Purpose                                                             | Token |
| ------------------ | ------------------------------------------------------------------- | ----- |
| `/e-posta-dogrula` | Redeem a verification token (`POST auth/verify-email`)              | yes   |
| `/sifre-sifirla`   | Set a new password with a reset token (`POST auth/reset`)           | yes   |
| `/sifremi-unuttum` | Request a reset email (`POST auth/forgot`)                          | no    |
| `/giris`           | Web sign-in (password); also cancels a pending deletion (ADR-0032)  | no    |
| `/hesap-silme`     | Explain deletion and the 7-day grace; signed-in users start it here | no    |

`/hesap-silme` is required for the store policies (product spec §6 item 21) and is linked from the
deletion emails. Apple and Google buttons on `/giris` follow in Phase 4; the API already supports
them.

### Token handling (verification and reset pages)

1. The link carries the token only in the fragment: `/sifre-sifirla#token=<43..128 base64url>`.
   Fragments are not sent to the server, logged by Caddy or included in `Referer`.
2. The first statement of the page's client entry script reads `location.hash`, keeps the token in
   a module-scoped variable (never `localStorage`, `sessionStorage`, cookies or URL state), and
   calls `history.replaceState(null, '', location.pathname)` so the token leaves the address bar,
   history entry and any later bookmark or share. No other application script runs before it (only
   the framework bootstrap that loads it); the pages load no analytics or third-party resources.
   The capture lives for the whole document, not only its first evaluation:
   - A fragment that arrives later in the same document (a second link opened in the same tab is a
     same-document navigation: `popstate` / `hashchange`, no reload) is captured and stripped the
     same way.
   - `history.pushState` / `replaceState` are wrapped before the router installs its own patch, so
     every history write, the router's included, that would put a fragment into a token page entry
     is written with the bare path instead and its token captured. A write the router takes from
     outside (`history.pushState` by other code) briefly records the fragment in the router state;
     the router is then told the bare path, so it does not write the fragment back. That update is
     skipped when a later history write has happened meanwhile, so it never undoes a navigation. A
     URL of another origin is passed through unchanged, so the browser rejects it as before and
     nothing is captured from it.
   - A new token replaces the held one under a new version; the page keys its flow state by that
     version, so a new link starts a fresh flow and the request of the replaced token is aborted. A
     held token is never replaced by itself. Verification posts once per mounted flow; a real
     unmount and remount of the page (navigating away and back on the client) starts a new flow,
     so the single use of a token is guaranteed by the server, not by the page.
3. A malformed or missing token shows the "link invalid or expired" state without calling the API.
4. Verification posts automatically once; reset posts only when the user submits the new password.
   A 401 `token_invalid` shows the same "invalid or expired" state with a link to
   `/sifremi-unuttum`; the page never says whether the token existed.
5. After success the token variable is cleared; reset shows "all sessions were signed out"
   (ADR-0025) and a link to `/giris`. Only the token the request carried is cleared, never a newer
   one.
6. An unused token is released when the user leaves the page: on `pagehide` (navigation, close and
   entry into the back/forward cache, which `no-store` alone does not prevent) and one task after
   the page component unmounts (the delay keeps it across an immediate remount; the delayed release
   applies only to the token held at unmount, never to a newer one). Releasing aborts
   the pending request that carries the token. A page restored from the back/forward cache
   (`pageshow` with `persisted`) has no token and shows the "link invalid or expired" state
   without calling the API; the user opens the link again. A settled page (success or rejected
   token) holds nothing and keeps its state.

### Headers and CSP

- All five pages are app surfaces (ADR-0021 group 1): per-request nonce CSP with `strict-dynamic`,
  `connect-src 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, plus `noindex, nofollow`
  (`X-Robots-Tag` and meta), `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on the two
  token pages.
- Mutations go through the existing web client transport (`x-kadro-client: web`, CSRF for
  signed-in mutations; the token endpoints are unauthenticated and CSRF-exempt by design, protected
  by the token itself and group A limits).

### Accessibility

- WCAG 2.2 AA: one `h1` per page, labelled inputs with `autocomplete` (`email`, `new-password`,
  `current-password`), visible focus, errors announced through an `aria-live="polite"` region and
  linked with `aria-describedby`, status changes (verifying, success, failure) announced, no
  time-limited content, contrast ≥ 4.5:1 with the brand palette, usable at 320 px width and 200 %
  zoom, password field with a show/hide toggle that is a real button.
- Target (Phase 2 gate, ADR-0027): an automated axe run on each page in its initial, error and
  success state.

### Verification coverage (amended 2026-10-02)

The repository has no Playwright and no axe dependency; adding one is an owner decision (lockfile
and CI cost) and is not part of this ADR. The accessibility bar above is verified today as follows,
and no automated axe rule set runs on any page:

| Page               | Initial state                                    | Error state                                                                                                            | Success state         |
| ------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `/e-posta-dogrula` | server render (unit), built server, browser      | browser (invalid link after a synthetic `pagehide`), unit (failure map, messages)                                      | unit (state machine)  |
| `/sifre-sifirla`   | server render (unit), built server, browser      | browser (short password: `aria-invalid`, `aria-describedby`, focus; malformed link; synthetic `pagehide` / `pageshow`) | unit (state machine)  |
| `/sifremi-unuttum` | server render (unit), built server               | unit (failure map, messages)                                                                                           | unit (state machine)  |
| `/giris`           | server render (unit), built server               | unit (failure map, messages)                                                                                           | unit (fixed redirect) |
| `/hesap-silme`     | server render of both forms (unit), built server | unit (failure map, messages)                                                                                           | unit (state machine)  |

- "server render (unit)": one `h1` and `main`, labelled inputs, `autocomplete`, the polite live
  region, the show/hide button, no inline script (`tests/pages/render.test.tsx`).
- "built server": `next start` of the production build, all five pages, headers and one `h1`
  (`tests/pages/built-pages.test.ts`).
- "browser": headless Chrome or Edge over the DevTools protocol against the production build
  (`tests/pages/browser.test.ts`): token removal from URL, history, requests and storage; a second
  link in the same document (reset: exactly one request, with the new token; verification: also
  while the first request is still pending, which is cancelled); a fragment written through the
  router's history patch; the reset form error, focus and show/hide toggle. It fails instead of
  skipping under `CI=true` (ADR-0042).
- Leaving the page is covered with synthetic lifecycle events (`pagehide`, `pageshow` with
  `persisted`) dispatched on the live page. A real freeze in and restore from the back/forward cache
  is not exercised (the token pages are `no-store`, and headless Chrome does not cache them
  reliably). Unmount release, its timing and versioning, and cross-origin pass-through are covered
  by unit tests on a fake browser (`tests/pages/token-lifecycle.test.ts`), not in a real React tree.
- Contrast against the brand tokens, target sizes, focus outline and reduced motion are checked on
  the stylesheet and tokens (`tests/pages/redirects-and-a11y.test.ts`), not on rendered pages.

## Consequences

- RR-8 closes at the Phase 2 gate together with the Playwright flows of ADR-0027. Until an axe
  run exists, the accessibility part of that gate rests on the coverage above.
- The universal / app links for the same paths remain a Phase 3 deliverable.
- Handoff `decisions-to-web-001` lists the pages and tests.

## Rejected alternatives

- **Token in the query string.** Reaches access logs, `Referer` and browser history.
- **Store the token in `sessionStorage` to survive reloads.** Any script on the origin could read
  it; a reload simply asks the user to open the link again.
