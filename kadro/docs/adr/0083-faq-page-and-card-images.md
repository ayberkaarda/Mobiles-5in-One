# ADR-0083: FAQ page and Open Graph card images

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0021, ADR-0055 (surfaces, nonce CSP, JSON-LD helper), ADR-0056 (marketing shell),
  ADR-0057 (programmatic pages), ADR-0080 (blog and legal pages); product spec §7;
  `docs/seo/seo-geo-checklist.md` rows 11, 12, 18, 19

## Context

Product spec §7 lists `/sss` with `FAQPage` structured data and "OG/Twitter images via `next/og`
using brand tokens". ADR-0080 left both out: the surface table only reserved `/sss`, cards had the
`summary` type without an image, and the `Article` node had no `image`. Constraints carried over:
every HTML page renders per request with the nonce CSP (ADR-0055), structured data goes through the
one escaping helper, the site is a portfolio project (no store listing, no price), and no
dependency or lockfile change is allowed for this work.

## Decision

1. **`/sss`.** `app/(marketing)/sss/page.tsx` renders twelve Turkish questions and answers from
   `components/content/faq.ts`, opened by a 40 to 60 word answer-first paragraph and a visible
   `role="note"` notice: Kadro is a portfolio project, the app is not in the stores, no Kadro Pro
   price is set, the directory venues are sample rows and the legal pages are sample texts. The
   answers describe only what spec §3 and the ADRs build (teams, matches, waitlist, fee split
   without money transfer, open calls, venue reviews tied to a played match, reminders, MVP vote,
   free tier with one owned team, Pro features, deletion with the 7-day grace period of ADR-0032,
   personal data with a link to the sample legal texts). The spec asks for fifteen pairs; twelve
   are published because the remaining candidates would repeat an answer or describe something not
   built.
2. **`FAQPage`.** `faqStructuredData` in `lib/server/seo/site-structured-data.ts` builds
   `BreadcrumbList`, `FAQPage` and `Organization` from the same entries the page renders, in the
   same order, so page and data cannot drift. The block goes through `components/seo/json-ld.tsx`
   (nonce of the response, `<`, `>`, `&`, U+2028, U+2029 escaped, no `dangerouslySetInnerHTML`).
   Google limits FAQ rich results to a few site types, so the block serves answer engines more than
   search result features.
3. **Navigation, sitemap, llms.** The footer "Ürün" group links `/sss`; the sitemap lists it
   (monthly, 0.6); both llms files name it in their page lists. The surface table already had
   `/sss` under `marketing`; only its "reserved" comment changes.
4. **Card images as route handlers with fixed paths.** `app/og/kadro.png/route.tsx` serves the
   site card at `/og/kadro.png`; `app/og/blog/[slug]/route.tsx` serves one card per article at
   `/og/blog/<slug>`. The `opengraph-image` file convention was not used: inside a route group
   (`(marketing)`) Next.js appends a hash to the image path, and the venue and district pages of
   `(seo)` would need their own files. `pageMetadata` instead names an image for every public page
   (`image` input, the site card by default) with width 1200, height 630, type and alt text, and
   sets the Twitter card to `summary_large_image` with the same image. The article page passes its
   own card, and the `Article` node gets it as `image`.
5. **Rendering.** `components/marketing/og-image.tsx` uses `ImageResponse` from `next/og` (part of
   Next.js, no new dependency): night-match background, a pitch-green centre circle with the
   orange-ball spot, the light wordmark of `packages/brand/logo`, title and subtitle. Colours are
   the palette of `packages/brand/tokens.json` (a test compares them). Nothing is fetched at render
   time.
6. **Fonts.** The renderer cannot read variable fonts (both brand files fail with a parse error),
   and its built-in fallback has no Turkish letters. `apps/web/assets/og-fonts/` therefore holds
   static instances cut from the variable files of `packages/brand/fonts` (Sora 700, Inter 400 and
   600, Inter optical size 14), subset to Basic Latin, Latin-1 and Latin Extended-A plus dashes,
   quotes and the ellipsis, with the two OFL licence files next to them (neither font declares a
   Reserved Font Name). Command, run from `kadro/` with fontTools 4.66.1:

   ```sh
   python -m fontTools.varLib.instancer packages/brand/fonts/sora/Sora-VariableFont_wght.ttf wght=700 --update-name-table -o sora-700-full.ttf
   python -m fontTools.varLib.instancer packages/brand/fonts/inter/Inter-VariableFont.ttf wght=400 opsz=14 --update-name-table -o inter-400-full.ttf
   python -m fontTools.varLib.instancer packages/brand/fonts/inter/Inter-VariableFont.ttf wght=600 opsz=14 --update-name-table -o inter-600-full.ttf
   python -m fontTools.subset <file>-full.ttf --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013-2014,U+2018-201F,U+2026" --layout-features="kern,liga,calt" --output-file=apps/web/assets/og-fonts/<file>.ttf
   ```

   A test checks that the three files have no `fvar` or `gvar` table.

7. **Build-time rendering and caching.** Both routes are `force-static`; the article route lists
   its slugs with `generateStaticParams` and sets `dynamicParams = false`, so an unknown slug is a
   404 and no path is built from the request. `next build` writes the PNGs (about 60 KB each), and
   the files are read only then. The responses carry
   `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`: shared caches may keep
   a card for a day, but the paths have no build hash, so they are not `immutable`. The build test
   that forbids prerendered pages (ADR-0055) now allows exactly these PNG routes: they carry no
   script, so the per-request nonce has nothing to protect. The `/og/**` paths fall on the `app`
   surface (nonce CSP header, no `noindex`, caching left to the route); `security-headers.ts`
   needs no new row.

## Consequences

- Every public page has `og:image` (absolute, from `metadataBase`), its size, type and alt text,
  and `twitter:card` `summary_large_image`; built-server tests check the tags on the marketing,
  blog, legal and article pages and fetch every card (status 200, `image/png`, PNG header 1200 x
  630, size between 10 KB and 300 KB, public cache header).
- A new article gets its card at the next build. A change to the site title or tagline changes the
  card at the next build; caches may serve the old one for up to a day plus the stale window.
- Changing the brand fonts means cutting the instances again with the command above.
- Not proven locally: how social networks and messengers render the cards (needs a deployed URL and
  their validators), and Rich Results for `FAQPage`. The spec count of fifteen FAQ pairs is not met
  (twelve).
