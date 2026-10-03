# SEO and GEO

What the web app does for search engines and for answer-engine crawlers, how the portfolio
(sample) labeling works, and what can only be checked once a real domain exists. The fact sheet
that the marketing copy, `llms.txt`, structured data and the future about page must agree with is
[`../seo/geo-facts.md`](../seo/geo-facts.md); this page does not repeat it.

Related: [pages.md](pages.md) (per-page indexability and JSON-LD),
[architecture.md](architecture.md) (JSON-LD helper, caching).

## Sitemap

`apps/web/app/sitemap.ts` serves `/sitemap.xml`. It is built per request (it calls `connection()`
and reads `WEB_ORIGIN`); its database rows come from the five-minute data cache
(`sitemapRows()` in `lib/server/seo/data.ts`, tag `seo:sitemap`).

One block per page group:

| Group             | Entries                                                                         | Change frequency, priority |
| ----------------- | ------------------------------------------------------------------------------- | -------------------------- |
| Marketing         | `/`, `/ozellikler`                                                              | weekly 1, monthly 0.8      |
| Blog              | `/blog`, one entry per article with `lastmod` from `modifiedAt`                 | weekly 0.7, monthly 0.6    |
| Legal and contact | `/gizlilik`, `/kvkk-aydinlatma`, `/iletisim`                                    | yearly 0.3                 |
| Districts         | `/eksik-var/<il>/<ilce>` for districts with at least one live open call         | hourly 0.7                 |
| Venues            | `/saha/<slug>` for verified, non-sample venues, `lastmod` from the venue update | weekly 0.6                 |

`noindex` pages (sample venues, districts without a live call) are never listed. A district drops
out of the sitemap at the time its latest call expires or its match starts, whatever the cached
row says (`liveDistricts`). It is one file; chunking with `generateSitemaps` is left until the row
count approaches 50 000 URLs (each query is capped at 20 000 rows, ADR-0057).

## Robots

`apps/web/app/robots.ts` serves `/robots.txt`, built per request from `WEB_ORIGIN`:

- allow `/`;
- disallow `/api/`, `/admin/`, `/mac/`, `/giris`, `/sifremi-unuttum`, `/sifre-sifirla`,
  `/e-posta-dogrula`, `/hesap-silme`;
- `Sitemap: <WEB_ORIGIN>/sitemap.xml`.

These paths also answer with `X-Robots-Tag: noindex, nofollow` and a `noindex` meta tag, so a
crawler that ignores `robots.txt` still gets the signal. The file falls on the `app` surface of
the surface table, so it carries the nonce CSP like every other response.

## Canonical, hreflang and metadata

`pageMetadata` (`components/marketing/metadata.ts`) gives every public page a canonical URL
relative to `metadataBase` (`WEB_ORIGIN`), `hreflang` `tr-TR` and `x-default` pointing at the same
path (no English pages exist, so no `en` alternate is published), and Open Graph and Twitter card
fields (`summary`, no image: there is no Open Graph image route). The layouts set no canonical,
because an inherited canonical would point every page at `/`. Titles are at most 60 characters
after the `%s · Kadro` template and descriptions at most 155; tests check this. The invite page
sets no canonical on purpose.

## llms files

`apps/web/public/llms.txt` and `apps/web/public/llms-full.txt` are static files (served at
`/llms.txt` and `/llms-full.txt`). Both are written in Turkish with one English sentence, state the
product, its audience and its MVP features, and contain the sentence "Kadro bir portfolyo
projesidir." as the fact sheet requires. They invent no user counts, ratings or prices; Kadro Pro
is described as a paid tier whose prices the stores set.

The "Sayfalar" lists of both llms files name only routes that exist (`/ozellikler`, `/blog`,
`/saha/{slug}`, `/eksik-var/{il}/{ilce}`, `/iletisim`, `/gizlilik`, `/kvkk-aydinlatma`). The
surface table still reserves `/sss` and `/sahalar/**`, but they are not listed. Nothing in the code
or tests checks the llms files against the route list.

## Programmatic pages

- `/saha/[slug]` and `/eksik-var/[il]/[ilce]` (ADR-0057). No `generateStaticParams`: they render
  per request from cached public reads.
- Thin or not-real pages are not offered to search engines: sample venues and districts with no
  live call get `noindex, follow` and stay out of the sitemap. Unknown or unverified venues and
  unknown districts answer 404 through the not-found page, which is `noindex`.
- Each page opens with a 40 to 60 word answer-first paragraph that names Kadro (the GEO rule of
  spec section 7; a test counts the words on the marketing pages).
- Internal links: a district page links its venues and the venues of calls, a venue page links its
  district. No navigation entry exists for them; crawlers reach them through the sitemap.
- Cache freshness and invalidation: see [architecture.md](architecture.md).
- Not built (ADR-0057): `/sahalar/[il]` directory pages, a map on the venue page, Open Graph
  images, an `en` alternate.

## Structured data

`Organization` and `MobileApplication` on `/` and `/ozellikler`; `Blog` on the blog index;
`Article` on articles; `BreadcrumbList` on every page that has data; `SportsActivityLocation` on
verified venues. The exact nodes and the escaping rules are in [pages.md](pages.md) and
[architecture.md](architecture.md). Rules from the fact sheet that the builders follow: no
`legalName`, tax id, address, phone or e-mail for the organization, no founding year, no logo, no
download URL, no Pro price.

## How sample and portfolio labeling works

Kadro is a portfolio project: it has no real data controller, contact channel or production
environment, and its demonstration data must never read as real. The mechanisms in code:

| Where                   | Mechanism                                                                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Venues                  | Seeded venues have `is_sample = true` and a `[ÖRNEK]` name prefix (`packages/db/src/schema/venues.ts`, check `venues_sample_name_prefix`). Real venues arrive only through the admin CSV import.                                              |
| Venue page              | A sample venue shows `SAMPLE_NOTICE` ("Bu kayıt örnek veridir; gerçek bir halı saha değildir."), is `noindex, follow`, is left out of the sitemap, and gets a `BreadcrumbList` only (no place node).                                          |
| Legal and contact pages | Front matter `sample: true` on the legal texts. `/gizlilik`, `/kvkk-aydinlatma` and `/iletisim` show a visible `role="note"` sample notice above the text. They stay indexable (the review checklist asks for the notice, not for `noindex`). |
| Footer and navigation   | The footer says "Kadro bir portfolyo projesidir."; the legal links are labelled "(örnek)".                                                                                                                                                    |
| llms files              | Both contain "Kadro bir portfolyo projesidir."                                                                                                                                                                                                |
| Structured data         | No claim that needs a real operator: no organization address, contact, legal name or founding year.                                                                                                                                           |

Open item: the footer line is `© Kadro Teknoloji. Kadro bir portfolyo projesidir.`
(`LEGAL_NAME` in `components/marketing/site.ts`). The fact sheet says that no company name is
published, so this constant should be reviewed.

The legal texts quote repository paths in code spans; that is part of their review trail and is
replaced at a real launch (ADR-0080, `../legal/review-checklist.md`).

## What needs a real domain

None of the following can be proven from a local run. They are open, manual items.

| Check                                  | Why it needs a domain                                                                                                                                                                         | Status  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Rich Results Test                      | Google's tool fetches a public https URL (or takes pasted HTML); the structured data shape is covered by local tests only (`tests/seo/json-ld.test.ts`, `tests/quality/web-quality.test.ts`). | not run |
| Search Console sitemap submission      | Needs a verified property for the production origin.                                                                                                                                          | not run |
| Apple app-site-association via CDN     | iOS fetches the file through Apple's CDN, which caches it. The file needs `APPLE_TEAM_ID`, a real https host and no redirect; it cannot be validated on `localhost` (ADR-0045, ADR-0058).     | not run |
| Android `assetlinks.json` verification | Needs the Play App Signing fingerprints in `ANDROID_CERT_SHA256_FINGERPRINTS`, which exist only after the app is set up in the Play Console, and a real https host.                           | not run |
| Hosted Lighthouse or PageSpeed run     | The local numbers below use the simulated mobile profile on a developer machine; field data needs a deployed site.                                                                            | not run |
| Axe-core run                           | `axe-core` is not a dependency; the suite uses an in-page audit subset (ADR-0059), so the result is "no violation of the audited rules", not "axe clean".                                     | not run |

With the three app-link settings unset, the two `.well-known` files answer 404 (never a
placeholder document) and the store entries stay "Yakında" labels.

## Lighthouse numbers and the LCP gap

Measured during the web quality work (ADR-0059): local Windows machine, Chrome, Lighthouse CI
default mobile profile (simulated slow 4G), median of three runs, production build:

| Page                     | Performance | Accessibility | SEO | Best practices | LCP     | CLS | TBT   |
| ------------------------ | ----------- | ------------- | --- | -------------- | ------- | --- | ----- |
| `/`                      | 94          | 100           | 100 | 96             | 3011 ms | 0   | 14 ms |
| `/ozellikler`            | 95          | 100           | 100 | 96             | 2860 ms | -   | -     |
| `/saha/<slug>`           | 95          | 100           | 100 | 96             | 2860 ms | -   | -     |
| `/eksik-var/<il>/<ilce>` | 94          | 100           | 100 | 96             | 3015 ms | -   | -     |

ADR-0059 gives the ranges over the four pages: performance 94 to 95, accessibility 100, SEO 100,
best practices 96, CLS 0, TBT 12 to 23 ms, LCP 3.0 to 3.1 s. A dash means that the per-page value
was not recorded (only the ranges are).

- The category gate (every category at least 0.9) passes. The CLS gate (at most 0.1) passes.
- The LCP budget of 2.5 s is not met: about 2.9 to 3.1 s. It is configured as a warning in
  `apps/web/lighthouserc.cjs`, so it is reported and does not block. The gap is an open item, not
  a pass.
- Cause not found: LCP stays at about 3.0 s with the brand fonts replaced by `system-ui`, and with
  the latin-ext faces preloaded too, so fonts are not the cause. The delay sits after the first
  paint under the simulated slow-4G profile.
- The blog index is in the Lighthouse URL list but has not been measured; the four rows above
  predate the blog pages.
- The `lighthouse` job in `.github/workflows/kadro-ci.yml` is informational: it is not in the
  `needs` of the `Kadro CI gate` job and is not a required check. It has not been seen running in
  CI; only the local equivalent was run.

How to run it: see [running-and-testing.md](running-and-testing.md).
