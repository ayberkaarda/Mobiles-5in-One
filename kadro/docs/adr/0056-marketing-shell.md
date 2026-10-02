# ADR-0056: Marketing shell — one server-rendered frame, brand tokens as custom properties, links only to existing pages

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0021, ADR-0055 (nonce CSP on every HTML surface), ADR-0040; product spec §2, §7

## Context

Phase 4 adds the public site under the `(marketing)` route group: home page, `/ozellikler`, later
the FAQ, about, contact, legal and blog pages, plus the `(seo)` listings. They need a common frame
(header, navigation, footer), metadata defaults and the brand identity, and they must keep the
per-request nonce CSP of ADR-0055: no inline script, and style elements only with the nonce.
`apps/web` does not list `@kadro/brand` as a dependency and has no CSS framework; the dependency
set is frozen for this change.

## Decision

1. **Frame.** `components/marketing/marketing-shell.tsx` renders, in this order: a skip link to
   `#icerik`, a `header` with the wordmark link home and `nav` "Ana menü", one `main id="icerik"`
   (focusable with `tabIndex=-1` so the skip link moves focus), and a `footer` with `nav`
   "Alt menü", the tagline and the line "Kadro bir portfolyo projesidir.". It is a server
   component; the only client code marks the current page with `aria-current="page"`.
   `app/(marketing)/layout.tsx` wraps every marketing page in it and calls `connection()` in the
   layout and in `generateMetadata` (ADR-0055 decision 5). The root `app/not-found.tsx` uses the
   same frame so a visitor who followed a broken link keeps the navigation; it stays on the `app`
   surface with `noindex`. `app/(marketing)/error.tsx` shows the generic message and the digest
   only (checklist item 13) inside the frame.
2. **Styling within the CSP.** Styles are a CSS module (bundled stylesheet, `style-src 'self'`).
   Colors are the light theme of `packages/brand/tokens.json`, mirrored in
   `components/marketing/theme.ts` and set as `--m-*` custom properties on the frame's `style`
   attribute, which the policy allows through `style-src-attr` (React escapes attribute values).
   The stylesheet uses no literal colors. A test compares every value with the token file and
   checks 4.5:1 for each text pair and 3:1 for focus rings. The decorative pitch lines of the hero
   are CSS pseudo-elements, not images.
3. **Fonts.** Sora (display) and Inter (body) are loaded with `next/font/local` from
   `packages/brand/fonts` by relative path, `font-display: swap`, no preload. `next/font` copies
   the files into the build output (`font-src 'self'`), writes the `@font-face` rules into the
   bundled stylesheet and derives size-adjusted fallbacks. The relative path is used because
   `@kadro/brand` is not a web dependency; once it is, the import can name the package. Inter is an
   877 KB variable TrueType file; subsetting it to WOFF2 is left to the Lighthouse measurement of
   Phase 4.
4. **Metadata.** The layout sets `metadataBase` from the validated `WEB_ORIGIN`, the title
   template `%s · Kadro`, the default title "Kadro: Halı Saha & Eksik Oyuncu", and Open Graph
   (`website`, `tr_TR`, site name) and Twitter (`summary`) defaults; it sets no canonical, because
   a canonical inherited from the layout would point every page at `/`. Each page calls
   `pageMetadata({ title, description, path })` for its canonical URL, `hreflang` `tr-TR` and
   `x-default` (no English pages exist yet, so no `en` alternate is published) and its Open Graph
   fields. Tests hold rendered titles to 60 and descriptions to 155 characters (spec §7). Open
   Graph images through `next/og` are not part of this decision: an image route must not become a
   prerendered route (ADR-0055 build test) and is decided with the structured-data work.
5. **Links only to pages that exist.** Navigation targets are typed routes (`typedRoutes`), and a
   test walks `app/` and fails if a header or footer link has no page. Pages delivered later (legal
   pages, FAQ, about, contact, blog, venue and open-call listings) add their navigation entries
   with the page. The download section lists the App Store and Google Play as "Yakında" text, not
   links: no listing exists, and store URLs will come from configuration (App Store id, Android
   application id), never from a hand-written URL.
6. **Copy.** Product copy is Turkish, follows the tone of spec §2 and states only the MVP scope of
   spec §3: no user counts, ratings, prices or availability claims. Each page opens with a 40 to
   60 word answer-first paragraph that defines Kadro (spec §7, GEO); a test counts the words. The
   features page says that Kadro Pro prices are set in the stores and that no money moves between
   players inside the app.
7. **Accessibility.** Landmarks and skip link as in 1; one `h1` per page and headings without
   skipped levels; sections labelled by their headings; every interactive target at least 44 px
   high; a visible 3 px focus ring on every link and button (dark on light areas, light on the
   green hero); reduced motion honoured; layout from 320 px wide without horizontal scrolling. The
   server-render tests check the structure; axe and Lighthouse checks in the browser follow with
   the Phase 4 quality gate.

## Consequences

- Every marketing page inherits a nonce-compatible frame; adding a page means one `page.tsx`, a
  `pageMetadata` call and, when it should appear in navigation, one entry in
  `components/marketing/site.ts`.
- The home page moved from `app/page.tsx` to `app/(marketing)/page.tsx`; the render-mode test now
  checks the marketing layout instead of the page.
- Brand colors exist in two mirrors (`lib/client/theme.ts` for the email-link pages and
  `components/marketing/theme.ts`), both tested against `tokens.json`. Importing the token file
  directly needs `@kadro/brand` as a web dependency.
- Only the light theme is implemented.
