# SEO and GEO checklist (package 4D; ASO and store rows updated in package 6F)

Legend: done = implemented and covered by a test in this repository; needs URL = requires a public
host; open = decision or work outside this package.

## Done

| Item | Where | Check |
| ---- | ----- | ----- |
| Five guides under `/rehber/:slug`, each at least 600 words, answer-first opening, headings, internal links | `apps/web/src/content/guide-*.ts` | `content.spec.ts`, `content.page.spec.ts` (rendered text) |
| Guide index `/rehber` | `content/pages.ts` | `content.page.spec.ts` |
| `/sss` with 15 Q&A, the same list feeds the page and `FAQPage` JSON-LD | `content/faq.ts` | `content.page.spec.ts` (page equals JSON-LD) |
| `/veri` with `Dataset` JSON-LD, methodology, licence status, export address | `content/pages.ts`, `site/content-seo.ts` | `content.page.spec.ts` |
| `/veri-lisansi`, `/hakkinda`, `/gizlilik`, `/kvkk-aydinlatma` (draft, noindex), `/hesap-silme` (no form), `/iletisim` (noindex, channel not set up) | `content/pages.ts` | `content.spec.ts` honesty rules |
| `Article`, `BreadcrumbList`, `FAQPage`, `Dataset`, `Organization`, `WebApplication`, `MobileApplication` through the typed builders only | `site/content-seo.ts` | `content.page.spec.ts`; ESLint bans raw script creation |
| Title at most 60 and description at most 155 characters, unique per page | `content/pages.ts`, `content/guides.ts` | `content.spec.ts` (metadata) |
| `/llms.txt`, `/llms-full.txt` as `text/plain; charset=utf-8` from the shared facts | `content/llms.ts`, `content/llms-route.ts` | `llms-route.spec.ts`, `content.spec.ts` |
| `/sitemap-pages.xml` for the static pages (noindex pages left out, honest `lastmod`), listed first in the `/sitemap.xml` index | `content/llms-route.ts`, `server/machine-files.ts` | `llms-route.spec.ts`, `machine-files.spec.ts` |
| Non-canonical spellings (matrix parameters, encoded letters, `~`) are redirected once or refused before rendering, so they cannot be indexed as duplicates | `server/normalize.ts` | `normalize.spec.ts`, e2e `routing.spec.ts` |
| The line list of a city without published lines is `noindex`, like its hub | `pages/line-list.page.ts` | `page-builders.spec.ts`, e2e `pages-no-js.spec.ts` |
| One entity description, tagline and licence status everywhere | `content/facts.ts` | `content.spec.ts` (entity facts, home metadata) |
| No banned or placeholder words in any text | all of the above | `content.spec.ts` and the CI grep |
| ASO notes: both title forms, final keyword set, 6 screenshot captions (tr and en), Data Safety and App Privacy summary | `docs/seo/aso.md` (package 6F) | review against ADR-0022, ADR-0026, ADR-0050; `node ops/release/check-release-docs.mjs` (limits, screenshot paths) |
| Store copy tr and en, privacy-label mapping with its mismatch list | `docs/release/store-listing.tr.md`, `store-listing.en.md`, `privacy-labels.md` (ADR-0056) | same script; every mapping row traced to code or an ADR |

## Needs a public URL

| Item | Why it waits |
| ---- | ------------ |
| Google Search Console property, ownership check, sitemap submission (`/sitemap.xml`, `/sitemap-pages.xml`) | no public host yet |
| Rich Results Test for `Article`, `FAQPage`, `Dataset`, `BreadcrumbList` | needs a fetchable URL (or pasted markup) and a deployed build |
| schema.org validator over every page type | same |
| Bing Webmaster Tools, IndexNow | same |
| Lighthouse CI score (performance, SEO, accessibility at 90 or more) on a production build | the CI step and a stable host are not set up; not run in this package |
| hreflang check of the live pages, canonical origin check behind the real proxy | origin comes from `IV_WEB_CANONICAL_ORIGIN` |
| `llms.txt` fetch by real crawlers, `robots.txt` interplay | no public host |
| Smart App Banner (`IV_WEB_IOS_APP_ID`), app association files | no App Store id, no signing certificate |
| Store submission (`docs/release/store-listing.*.md`) | no developer accounts; open owner decisions: the store title (36 characters in the specification, cap 30; options a to c listed), sample-data screenshots at a 2.22 ratio to retake, support contact and web deletion path (`docs/release/legal-open-items.md`) |

## Open

| Item | State |
| ---- | ----- |
| Legal and store decisions in one list | `docs/release/legal-open-items.md` (L1 to L10, who decides each, where each is referenced). |
| `/kullanim-kosullari` | no draft exists in the repository; not written and not routed. Needs the legal text first. |
| Real contact channel for `/iletisim` and the KVKK application path | the channel is being set up; the pages say so and publish no address. |
| Legal review of `/kvkk-aydinlatma` (company registration data, legal bases, processors, countries) | draft only, `noindex` until approved. |
| Legal approval of the open-data licence (ADR-0003) | `Dataset.license` points at `/veri-lisansi` (a status page); change it to the licence URL only after approval. |
| Prerender of the guides | not done on purpose: a build-time prerender would bake a build-time origin into canonical URLs (ADR-0038 item 6). The pages are rendered per request and kept by the 10 minute page cache. Revisit with a fixed build origin. |
| Per-city export links on `/veri` | the page shows the address template; a link list needs the city list from the API (data client owned by another lane). |
| English pages and `hreflang en` | none yet. |
| PNG Open Graph image for content pages | none; the content pages carry no `og:image`. |
