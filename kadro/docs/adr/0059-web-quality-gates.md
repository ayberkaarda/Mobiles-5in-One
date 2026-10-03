# ADR-0059: Web quality gates — self-hosted WOFF2 fonts, JSON-LD and accessibility suites, Lighthouse CI as an informational job

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0042, ADR-0055, ADR-0056, ADR-0057; product spec §7, §8, Phase 4 gate

## Context

The Phase 4 gate asks for Lighthouse >= 90 on five sample pages, valid JSON-LD and accessibility
checks. ADR-0056 left two things open: the brand fonts were 877 KB TrueType files loaded from
`packages/brand`, and axe and Lighthouse had not been run. The dependency set is frozen:
`axe-core` and `lighthouse` are not dependencies, and none is added here.

## Decision

1. **Fonts.** The marketing and SEO shell uses the subset WOFF2 variable files in
   `apps/web/public/fonts` (Inter, Sora; latin and latin-ext; OFL texts next to them). `fonts.css`
   declares four `@font-face` rules with `font-display: swap` and a `unicode-range` per subset, so
   a face is downloaded only when its characters are used; Turkish letters (ğ, ı, İ, ş) live in
   latin-ext. URLs are same-origin (`font-src 'self'`), no CDN, no inline style. The shell emits
   `<link rel="preload" as="font" crossorigin>` for the two latin faces. `next/font/local` was not
   used: it cannot attach a `unicode-range` to a file, and two faces of one family without ranges
   would shadow each other. No visual change: the CSS variables `--m-font-display` and
   `--m-font-body` keep their names and the stack falls back to `system-ui`.
2. **JSON-LD tests** (`tests/quality/web-quality.test.ts`, production build, real database): on
   every page that carries structured data (venue, district) the block parses as JSON, has
   `@context`, a `@graph` of typed nodes, a `BreadcrumbList` with positions and absolute URLs, and
   for venues a `SportsActivityLocation` with name, url, address and geo and no `aggregateRating`
   below three reviews. A hostile venue name appears only as `<` escapes in the markup, while
   the parsed value is intact. Every `<script>` of the page, the data block included, carries the
   nonce of the response CSP. The home and features pages carry no structured data yet (spec §7
   lists `Organization` and `MobileApplication`; not built in this change).
3. **Accessibility.** `axe-core` is not available, so `tests/quality/page-audit.ts` is a
   documented in-page audit over the existing DevTools-protocol approach (headless Chrome or Edge,
   no new dependency): document title, `lang`, one `h1`, heading order, landmarks, skip-link target,
   image/link/button names, form labels, duplicate ids, id references, focusable `aria-hidden`,
   24 px targets and text contrast (4.5:1, 3:1 large). A negative-control test feeds it a broken
   page and requires the matching rules to fire. It is a subset of axe, not a substitute: rules that
   need the browser accessibility tree are not covered, and a real axe run stays an open item.
4. **Lighthouse CI.** `apps/web/lighthouserc.cjs` audits each URL three times and asserts the
   median: performance, accessibility, SEO and best practices >= 0.9, CLS <= 0.1 (error), LCP <=
   2.5 s (warning). `pnpm lighthouse` (opt-in, `KADRO_LIGHTHOUSE=1`) seeds a disposable database,
   starts `next start` and runs `npx @lhci/cli@0.15.1 autorun`; nothing enters the dependencies.
   The pages are home, features, one venue and one district page; the blog index joins when the
   blog pages are merged.
5. **CI.** The `lighthouse` job in `kadro-ci.yml` is separate, additive and informational: it is
   not in the `needs` of `Kadro CI gate` and is not a required check, so runner noise cannot block
   a merge. Action SHAs are those already pinned in the file.

## Measured (local, Windows, Chrome, default mobile profile, median of 3)

Performance 94-95, accessibility 100, SEO 100, best practices 96 on all four pages, CLS 0, TBT
12-23 ms. LCP is 3.0-3.1 s, above the 2.5 s budget. It stays at about 3.0 s when the brand fonts are
replaced by `system-ui`, so the fonts are not the cause (the render delay sits after the first
paint in the simulated slow-4G profile); preloading the latin-ext faces did not change it either.
LCP is therefore a warning and an open item, not a pass.

## Consequences

- Fonts are four WOFF2 files (about 186 KB for all faces, 84 KB for latin only) instead of the
  877 KB Inter TrueType file of ADR-0056 plus the Sora file.
- The accessibility result is "no violation of the audited rules", never "axe clean".
- Rich Results Test, real-domain checks and a hosted Lighthouse run need a deployed site and remain
  manual.
