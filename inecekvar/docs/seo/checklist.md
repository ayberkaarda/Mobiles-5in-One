# SEO and GEO checklist (package 4D)

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
| `/sitemap-pages.xml` for the static pages (noindex pages left out, honest `lastmod`) | `content/llms-route.ts` | `llms-route.spec.ts` |
| One entity description, tagline and licence status everywhere | `content/facts.ts` | `content.spec.ts` (entity facts, home metadata) |
| No banned or placeholder words in any text | all of the above | `content.spec.ts` and the CI grep |
| Aso notes, Data Safety and App Privacy answers | `docs/seo/aso.md` | review against ADR-0022, ADR-0026 |

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
| Store listings and screenshots (`aso.md`) | no developer accounts; the title exceeds the 30 character store cap |

## Open

| Item | State |
| ---- | ----- |
| `/kullanim-kosullari` | no draft exists in the repository; not written and not routed. Needs the legal text first. |
| Real contact channel for `/iletisim` and the KVKK application path | the channel is being set up; the pages say so and publish no address. |
| Legal review of `/kvkk-aydinlatma` (company registration data, legal bases, processors, countries) | draft only, `noindex` until approved. |
| Legal approval of the open-data licence (ADR-0003) | `Dataset.license` points at `/veri-lisansi` (a status page); change it to the licence URL only after approval. |
| Prerender of the guides | not done on purpose: a build-time prerender would bake a build-time origin into canonical URLs (ADR-0038 item 6). The pages are rendered per request and kept by the 10 minute page cache. Revisit with a fixed build origin. |
| Content pages in the sitemap index | `/sitemap.xml` is built from the API city list; the static pages sit in `/sitemap-pages.xml`, which the index does not list yet (needs a change in `server/machine-files.ts`). |
| Per-city export links on `/veri` | the page shows the address template; a link list needs the city list from the API (data client owned by another lane). |
| English pages and `hreflang en` | none yet. |
| PNG Open Graph image for content pages | none; the content pages carry no `og:image`. |
