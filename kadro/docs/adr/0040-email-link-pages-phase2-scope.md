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
   history entry and any later bookmark or share. No other script runs before it; the pages load no
   analytics or third-party resources.
3. A malformed or missing token shows the "link invalid or expired" state without calling the API.
4. Verification posts automatically once; reset posts only when the user submits the new password.
   A 401 `token_invalid` shows the same "invalid or expired" state with a link to
   `/sifremi-unuttum`; the page never says whether the token existed.
5. After success the token variable is cleared; reset shows "all sessions were signed out"
   (ADR-0025) and a link to `/giris`.

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
- Playwright with axe checks each page in its initial, error and success state (Phase 2 gate,
  ADR-0027).

## Consequences

- RR-8 closes at the Phase 2 gate together with the Playwright flows of ADR-0027.
- The universal / app links for the same paths remain a Phase 3 deliverable.
- Handoff `decisions-to-web-001` lists the pages and tests.

## Rejected alternatives

- **Token in the query string.** Reaches access logs, `Referer` and browser history.
- **Store the token in `sessionStorage` to survive reloads.** Any script on the origin could read
  it; a reload simply asks the user to open the link again.
