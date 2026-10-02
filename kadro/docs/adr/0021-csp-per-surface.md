# ADR-0021: Content-Security-Policy per surface — nonce for the app, static policy for SEO pages

- Status: Accepted (to be verified in Phase 4)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 item 9, §7; threat model T-PLT-08, §6.2

## Context

Checklist item 9 asks for a nonce-based CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`). A
nonce must differ per response, so every page that carries it must render per request. Phase 1
achieves this with `await connection()` in the root layout, which makes the whole web app dynamic.
Phase 4 plans static and ISR rendering for marketing and programmatic SEO pages (venue and district
pages, open-call listings with ISR 5 min, blog) and Core Web Vitals budgets that rely on caching.
Both cannot hold for the same page.

## Decision

Two header policies, selected by path in the request proxy (`proxy.ts`), because route groups do
not appear in URLs:

1. **App surfaces — nonce CSP, dynamic render.** `/api/v1/**`, `/admin/**`, `/hesap-silme`,
   `/mac/[inviteCode]` and every other path not listed in 2. Policy as in item 9:
   `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `frame-ancestors 'none'`,
   `base-uri 'self'`. API JSON responses additionally get `default-src 'none'`. The
   `connection()` call moves from the root layout into the layouts of these surfaces.
2. **Marketing and SEO surfaces — static CSP, static or ISR render.** Pages under the
   `(marketing)` and `(seo)` route groups: `/`, `/ozellikler`, `/sahalar/**`, `/saha/**`,
   `/eksik-var/**`, `/blog/**`, `/hakkinda`, `/sss`, `/gizlilik`, `/kvkk-aydinlatma`, `/iletisim`.
   Policy: `script-src 'self'` plus `'sha256-…'` hashes of the inline scripts emitted at build
   time, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, never
   `'unsafe-inline'` or `'unsafe-eval'` for scripts. These pages have no forms that mutate state and
   read no session.

All other security headers (HSTS, nosniff, Referrer-Policy, Permissions-Policy) are identical on
both surfaces.

**Phase 4 verification:** `headers-check.ts` asserts the policy per path class, and the build
fails if a page in group 2 needs an inline script whose hash is not in its policy. If inline
scripts cannot be hashed deterministically for a page, that page moves to group 1 (dynamic render
with nonce); security is not traded for caching.

## Consequences

- Public pages keep ISR and Lighthouse budgets; authenticated and admin surfaces keep per-request
  nonces.
- The path list lives in one module shared by the proxy and `headers-check.ts`; a new public route
  defaults to group 1 until it is added to group 2.
- `apps/web/app/layout.tsx` changes in Phase 4 (owned by the web app); until then every page is
  dynamic, which is secure but uncached.
