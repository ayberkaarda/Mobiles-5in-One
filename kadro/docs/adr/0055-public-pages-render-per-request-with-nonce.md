# ADR-0055: Public pages render per request with the nonce CSP; data is cached, HTML is not

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0021 (CSP per surface), ADR-0040; product spec §6 items 9 and 16, §7; threat model
  T-PLT-08, §6.2

## Context

Product spec §7 asks for ISR (5 min) on the public open-call listings and static or ISR rendering
for the other marketing and SEO pages. Checklist item 9 asks for a nonce-based CSP
(`script-src 'self' 'nonce-…' 'strict-dynamic'`). A nonce differs per response, so a prerendered
or ISR page cannot carry it. ADR-0021 proposed a second policy for `(marketing)` and `(seo)` pages:
`script-src 'self'` plus `'sha256-…'` hashes of the inline scripts emitted at build time, with the
rule that a page whose inline scripts cannot be hashed deterministically falls back to the nonce
surface. This ADR records the measurement that rule asked for.

## Measurement (Next.js 16.3.8 production build, `next build` + `next start`)

A trial build removed `await connection()` from the root layout and added two throwaway pages
under `(marketing)`: one without data and one with `revalidate` and a timestamp in its output
(`revalidate = 300`, then `revalidate = 5` to observe a regeneration). The trial files were
deleted afterwards and are not part of the history.

| Observation                                   | Result                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route table without the root `connection()`   | `/`, `/_not-found`, the data-free page: `○` static; the ISR page: `○` with revalidate 5m / expire 1y                                                                                                          |
| Inline scripts per prerendered page           | 2: a fixed bootstrap (`(self.__next_f=self.__next_f\|\|[]).push([0])`, 43 bytes, same hash in every build) and the RSC flight payload (4.8 to 6.4 KB)                                                         |
| External scripts per page                     | 8 `<script src="/_next/static/chunks/…">`, no nonce, no `integrity`                                                                                                                                           |
| Inline styles                                 | 0 on the trial pages; 1 `<style>` element on the default 404 page                                                                                                                                             |
| Flight payload hash across two clean builds   | differs on every page (the payload embeds the build id, e.g. `BHrU_zP8odHZ8IO77_M2C` vs `1bjeEszSTj-hl0YzzCl1W`); the bootstrap hash is stable                                                                |
| Flight payload of the ISR page                | contains the rendered data (the timestamp); three responses across one regeneration had three different payload hashes (`G2/h1/…`, `Uwm9A6J7…`, `sMg/M5+L…`)                                                  |
| Headers served for the static pages           | `Cache-Control: s-maxage=31536000` (ISR: `s-maxage=5, stale-while-revalidate=…`), `x-nextjs-cache: HIT`, and the proxy's nonce CSP although the HTML has 0 nonce attributes, so every script would be blocked |
| ISR regeneration under the nonce proxy        | the revalidated HTML carried 11 `nonce="…"` attributes: Next.js wrote the nonce of the request that triggered the regeneration into the cached page, which is then served to every later visitor              |
| Size of a hash-only `script-src` for one page | 125 bytes (two hashes); no header-size problem                                                                                                                                                                |

## Decision

1. **No hash-based CSP.** Every HTML surface keeps the nonce CSP of checklist item 9 and renders per
   request, including the `marketing` and `seo` surfaces of ADR-0021 group 2. Reasons, from the
   measurement:
   - ISR pages cannot be hashed at all: the flight payload carries the data, so its hash changes on
     every regeneration, after the proxy has already sent its policy.
   - Data-free static pages could be hashed only per build (the build id is in the payload) through
     a post-build manifest that the proxy reads at run time, plus `script-src 'self'` without
     `'strict-dynamic'` for the eight chunk scripts and a separate style policy. That is a second
     CSP mechanism to maintain for pages whose rendering cost is negligible.
   - Combining a cached page with a nonce is unsafe in Next.js 16: the regeneration stores one
     request's nonce in shared HTML. A page must therefore never be prerendered while the proxy
     sends a nonce CSP for it.
2. **Data is cached, HTML is not.** The spec's "ISR 5 min" is met at the data layer: public listing
   and venue queries are wrapped in `unstable_cache` with `revalidate: 300` and tags for targeted
   invalidation (for example when an open call expires). `use cache` needs the `cacheComponents`
   option, which changes the rendering model of the whole app and is not enabled; revisit it in a
   separate decision. The HTML response stays `private, no-store` (Next.js default for dynamic
   pages), so no CDN or shared cache stores a nonce.
3. **One surface table.** `SURFACES` in `apps/web/lib/server/security-headers.ts` lists every
   surface with its paths, a probe path, CSP variant (`nonce` or `deny-all`), `noindex`,
   `Referrer-Policy` and `Cache-Control`: `api`, `token-page`, `email-link-page`, `marketing`,
   `seo` and the catch-all `app`. The proxy and `scripts/security/headers-check.ts` read the same
   table; the check requests the probe path of every surface and fails a nonce surface whose
   response is shared-cacheable (`public` or `s-maxage`).
4. **Render mode lives with the surface.** The root layout no longer calls `connection()`.
   `(app)/layout.tsx`, `app/page.tsx` and `app/not-found.tsx` call it; future `(marketing)` and
   `(seo)` layouts call it as well. `tests/built-server.test.ts` fails when the production build
   prerenders any route other than Next.js' own `/_global-error`, and checks that every script of
   every HTML surface probe carries the response nonce.
5. **JSON-LD.** `components/seo/json-ld.tsx` renders structured data as the React text child of a
   `<script type="application/ld+json">` data block with the request nonce (read from the `x-nonce`
   request header the proxy forwards). The serializer escapes `<`, `>`, `&`, U+2028 and U+2029, so
   `</script>` and `<!--` in data cannot change the markup. `dangerouslySetInnerHTML` stays
   forbidden; the page source guards allow exactly this one data block in this one file.

## Consequences

- Product spec §7 "ISR 5 min" is read as "data at most 5 min old"; listing pages pay one render per
  request (no database round trip within the cache window). Lighthouse budgets (Phase 4) are
  measured against dynamic HTML.
- ADR-0021 group 2 keeps its path list and indexing rules but not its static CSP; ADR-0021 is
  marked as amended by this ADR.
- A page added to `(marketing)` or `(seo)` without a per-request call fails the build test before
  it can ship with blocked scripts.
- Revisit if Next.js gains build-time hashes for its inline scripts (for example an SRI or CSP hash
  manifest) or if a page set appears that is both data-free and performance-critical.
