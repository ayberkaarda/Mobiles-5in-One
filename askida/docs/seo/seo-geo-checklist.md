# SEO and GEO checklist (spec section 7)

One row per item of spec section 7 (`04-askida-flutter.md`), as delivered in Phase 5. Status:
**done** (built and covered by a test), **partial** (built with a stated limit) or
**not exercised** (needs a public domain, store accounts or real data that a portfolio build
does not have; wording of ADR-0006). Tests live under `askida/server/tests/Feature/Web`.
ASO (`docs/seo/aso.md`) belongs to Phase 6 and is not listed here.

## Information architecture

| Item | Status | Evidence / reason |
| --- | --- | --- |
| `/`, `/nasil-calisir`, `/esnaf`, `/bagisci`, `/askidan-al` | done | `Pages/PagesTest`, `HtmlBudgetTest`; no people imagery (no `<img>` on the pages, `GuardrailsTest`) |
| `/dukkanlar/{il}`, `/dukkanlar/{il}/{ilce}` | done | `Directory/DistrictPageTest`; Turkish slugs (`Unit/Web/TurkishSlugTest`) |
| `/dukkan/{slug}` only for `listed_on_web` shops, with available counts, hours, map, "Askıya bırak" deep link | done | `Directory/ShopPageTest`, `Directory/UnlistingTest`; map is an inline SVG frame without tiles |
| `/etki` and `/etki/{il}` with methodology note | partial | `Impact/ImpactPagesTest`; figures come from the daily `impact_snapshots` (dated, last 30 days), not hourly counters; real figures not exercised: no live data, sample figures labelled `[ÖRNEK]` |
| `/rehber/{slug}`: the five guides | done | `Content/GuidesTest` (each at least 600 words, H2 questions) |
| `/sss`, `/hakkinda`, `/iletisim` | done | `Pages/PagesTest`; about and contact carry the sample notice |
| `/gizlilik`, `/kvkk-aydinlatma` | partial | `Content/LegalPagesTest`; labelled sample texts, legal review not done |
| `/hesap-silme` | done | existing page, unchanged; `noindex`, never in the page cache (`ResponseCacheTest`) |
| `/pay/*` and `/admin/*` `noindex` and disallowed | done | `Seo/RobotsTest`; never in the sitemap (`Seo/SitemapTest`) |

## Technical SEO

| Item | Status | Evidence / reason |
| --- | --- | --- |
| Title at most 60, description at most 155 characters | done | `Seo/MetaLengthTest` (every public page, unique per page; `PageMeta` refuses longer values) |
| `hreflang` `tr-TR` + `en` + `x-default` | done | `Seo/HreflangTest`; `en` only on `/en` and `/en/how-it-works` (and reciprocally on their Turkish pages), every other page `tr-TR` + `x-default`; canonical is the page itself on `WEB_ORIGIN` |
| Sitemap: shops, districts, guides, impact | done | `Seo/SitemapTest`, `Seo/SitemapConsistencyTest` (every listed URL answers 200 indexable and canonical; impact entries equal the published province pages; guide `lastmod` from the front matter). Built on request and kept in the page cache for an hour instead of a scheduled file; dropped at once on a shop change |
| Per-shop OG images (brand frame + shop name, no personal data) | done | `Seo/OgImageTest`; default image `public/og/default.png` |
| JSON-LD `Organization` | done | `Seo/JsonLdTest` (every page) |
| JSON-LD `MobileApplication` (iOS + Android, `LifestyleApplication`) | done | `Seo/JsonLdTest`; `installUrl` only when store URLs are configured; with a real store listing: not exercised: no store accounts |
| JSON-LD `LocalBusiness` subtype by shop type | done | `Seo/JsonLdTest` (Bakery, Restaurant, CafeOrCoffeeShop, GroceryStore, Store) with address, geo, hours, phone |
| JSON-LD `BreadcrumbList` | done | `Seo/JsonLdTest` (every page except `/` and `/en`, the two home pages) |
| JSON-LD `FAQPage` on `/sss` | done | `Seo/JsonLdTest`, `Pages/PagesTest` (15 pairs, the rendered strings) |
| JSON-LD `Article` on guides | done | `Seo/JsonLdTest` (dates from front matter, `wordCount`) |
| JSON-LD `Dataset` on `/etki` with licence note | done | `Seo/JsonLdTest`: licence only as a sentence in `description`, no `license` property while the licence is a proposal |
| JSON-LD validated on a public URL (Rich Results Test) | not exercised | no public domain; structure validated by `Seo/JsonLdTest` |
| Response cache 5 min for public pages | done | `ResponseCacheTest`, `PageCacheTest`; in-house middleware `cacheResponse` instead of `spatie/laravel-responsecache` (the package needs PHP 8.4, the stack is PHP 8.3) |
| Lighthouse CI budgets at least 90 | partial | `askida/server/lighthouserc.cjs`; local run on the Docker stack with the sample shops: all four categories at least 0.90 on the five pages (section below); the CI job `lighthouse` (informational, outside the gate) is not exercised until the branch is pushed |
| App linking files for `app.askida.mobile` (`/dukkan/*`, `/d/*`) | partial | `Seo/WellKnownTest`; verification by Apple and Google: not exercised: no Apple team, no signing certificate |
| Smart App Banner meta | partial | rendered only when `WEB_IOS_APP_ID` is set (tested both ways); with a real App Store id: not exercised: no store listing |
| Flutter deep-link routing in go_router | not exercised here | app side, outside the Phase 5 web scope |
| Search Console submission | not exercised | no public domain |

## GEO

| Item | Status | Evidence / reason |
| --- | --- | --- |
| `/llms.txt` and `/llms-full.txt` | done | `Content/LlmsTest` (size, ten links, facts, `text/plain; charset=utf-8`) |
| 40-60 word answer paragraph on every page | done | `Seo/AnswerParagraphTest` (directly under the single H1, unique per page) |
| `/sss` with 15 Turkish pairs mirrored in JSON-LD | done | `Pages/PagesTest`, `Seo/JsonLdTest` |
| Consistent facts across `/hakkinda`, `llms.txt`, JSON-LD | done | `Pages/PagesTest`, `Content/LlmsTest` (shared `Facts`, commission re-rendered at 750 bps) |
| `/etki` numbers dated and quotable | partial | dated window and methodology on the page, CSV at `/etki.csv`; real figures: not exercised: no live data |
| Guides with H2 questions and short answers | done | `Content/GuidesTest` |
| Honest `dateModified` | done | front matter only (`Content/GuidesTest`, `Seo/JsonLdTest`, `Seo/SitemapConsistencyTest`); static pages carry no invented date |

## Lighthouse (local run)

Command, from a scratch directory so no report lands in the repository:

```sh
B=http://localhost:58516
LHCI_URLS="$B/,$B/nasil-calisir,$B/dukkanlar/istanbul,$B/dukkan/ornek-moda-firini,$B/etki" \
  npx @lhci/cli@0.15.1 autorun --config=<repo>/askida/server/lighthouserc.cjs
```

The stack is `askida/docker-compose.yml` (nginx + PHP-FPM, page cache on), migrated and seeded
with `ALLOW_SAMPLE_SHOPS=true`. Medians of three runs per page:

| Page | Performance | Accessibility | Best practices | SEO | LCP | CLS |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | 0.94 | 1.00 | 1.00 | 0.92 | 1 519 ms | 0.0002 |
| `/nasil-calisir` | 0.90 | 1.00 | 1.00 | 0.92 | 1 666 ms | 0.0000 |
| `/dukkanlar/istanbul` | 0.95 | 1.00 | 1.00 | 0.92 | 1 530 ms | 0.0000 |
| `/dukkan/ornek-moda-firini` | 0.96 | 1.00 | 1.00 | 0.92 | 1 519 ms | 0.0003 |
| `/etki` | 0.96 | 1.00 | 1.00 | 0.92 | 1 517 ms | 0.0002 |

Lighthouse 12.6.1 through `@lhci/cli` 0.15.1, mobile emulation with simulated throttling,
2026-10-05; every assertion of `lighthouserc.cjs` passed (exit 0). Two audits stay below 0.9
on every page, both caused by the local stack, not by the pages: the root document takes 3 to
9 s on the Windows bind mount (PHP checks every source file on each request), which lowers the
speed index, and the `robots-txt` audit reports "unable to download" because Lighthouse gives
that fetch 2 s (`/robots.txt` itself answers 200 with valid rules, `Seo/RobotsTest`). On a
host without the bind mount both are expected to pass; not exercised: no deployed host.
