# Web architecture

Scope: `kadro/apps/web` (`@kadro/web`), a Next.js 16 app that serves the marketing site, the
programmatic SEO pages, the staff panel, a few account pages and the REST API under `/api/v1`.
This page describes what is on `main`; the decisions behind it are ADR-0021, 0055, 0056, 0057,
0058, 0059, 0068 and 0080 in [`../adr/`](../adr/README.md).

Related pages: [pages.md](pages.md), [seo-and-geo.md](seo-and-geo.md),
[admin-panel.md](admin-panel.md), [running-and-testing.md](running-and-testing.md).

## Route groups

Route groups do not appear in URLs. Everything below is under `apps/web/app/`.

| Group         | Paths                                                                                                                                                        | Layout and render mode                                                                                               | Notes                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `(marketing)` | `/`, `/ozellikler`, `/blog`, `/blog/[slug]`, `/gizlilik`, `/kvkk-aydinlatma`, `/iletisim`, `/mac/[code]`                                                     | `(marketing)/layout.tsx` calls `connection()` and wraps pages in `MarketingShell`                                    | Shell: skip link, header, one `main`, footer (ADR-0056). `error.tsx` in the group. |
| `(seo)`       | `/saha/[slug]`, `/eksik-var/[il]/[ilce]`                                                                                                                     | `(seo)/layout.tsx`, same shell and metadata defaults                                                                 | Programmatic pages (ADR-0057).                                                     |
| `(admin)`     | `/admin`, `/admin/giris`, `/admin/dogrulama`, `/admin/totp-kurulum`, and the `(panel)` sections                                                              | `(admin)/admin/layout.tsx` calls `connection()`; `(panel)/layout.tsx` checks the staff session                       | See [admin-panel.md](admin-panel.md).                                              |
| `(app)`       | `/giris`, `/sifremi-unuttum`, `/sifre-sifirla`, `/e-posta-dogrula`, `/hesap-silme`                                                                           | `(app)/layout.tsx` calls `connection()`                                                                              | Email-link and account pages (ADR-0040); never indexed.                            |
| (no group)    | `/api/v1/**`, `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`, `/robots.txt`, `/sitemap.xml`, `not-found`, `error`, `global-error` | root layout sets no render mode; `not-found`, the sitemap, robots and the `.well-known` handlers call `connection()` | Static files in `public/`: `llms.txt`, `llms-full.txt`, `fonts/`.                  |

API route handlers live in `app/api/v1/**/route.ts`; business logic is in `lib/server/**`. The
staff panel does not query admin data itself: its server components call the same
`/api/v1/admin/**` route handlers in process (`lib/admin/server-api.ts`, ADR-0068).

## Nonce CSP and the surface table

Every HTML response carries a Content-Security-Policy with a per-request nonce
(`script-src 'self' 'nonce-...' 'strict-dynamic'`). A nonce differs per response, so no HTML page
may be prerendered or served from a shared cache. ADR-0055 measured a hash-based policy and
rejected it: Next.js 16 would store the nonce of one request in shared ISR HTML.

How it works:

- `proxy.ts` (the Next.js 16 name of the middleware convention) runs for every path except
  `/_next/static/`, `/_next/image` and `/favicon.ico`. It delegates to
  `lib/server/proxy-handler.ts`: new request id, canonical path classification, CSP, CORS for the
  API, security headers.
- `lib/server/security-headers.ts` holds `SURFACES`, the single table that the proxy and
  `scripts/security/headers-check.ts` both read. The first matching row wins; the last row (`app`)
  takes every other path. A new public route therefore falls on `app` until it is listed.
- Paths are matched after canonicalisation (percent-decoded once, case-folded, empty and dot
  segments removed). A path with an encoded `/` or `\`, a control character or an invalid escape
  gets `400` with the deny-all CSP, `no-store` and `noindex`.
- `next.config.ts` adds the static security headers (HSTS, `nosniff`, Referrer-Policy,
  Permissions-Policy, `X-Frame-Options`) to every route, including static assets the proxy skips,
  and `Cache-Control: no-store` on `/api/*`.
- The root layout does not call `connection()`. Each group layout (and `app/not-found.tsx`) does,
  so Next.js applies the nonce to its own scripts. `tests/built-server.test.ts` fails when the
  production build prerenders any route other than `/_global-error`, and checks that every script
  of every HTML surface probe carries the response nonce.

| Surface           | Paths                                                                                             | CSP      | `noindex` | Referrer-Policy                   | Cache-Control   |
| ----------------- | ------------------------------------------------------------------------------------------------- | -------- | --------- | --------------------------------- | --------------- |
| `api`             | `/api/**`                                                                                         | deny-all | no        | `strict-origin-when-cross-origin` | `no-store`      |
| `token-page`      | `/e-posta-dogrula`, `/sifre-sifirla`                                                              | nonce    | yes       | `no-referrer`                     | `no-store`      |
| `email-link-page` | `/sifremi-unuttum`, `/giris`, `/hesap-silme`                                                      | nonce    | yes       | `strict-origin-when-cross-origin` | Next.js default |
| `invite-page`     | `/mac/**`                                                                                         | nonce    | yes       | `no-referrer`                     | `no-store`      |
| `marketing`       | `/`, `/ozellikler`, `/hakkinda`, `/sss`, `/gizlilik`, `/kvkk-aydinlatma`, `/iletisim`, `/blog/**` | nonce    | no        | `strict-origin-when-cross-origin` | Next.js default |
| `seo`             | `/sahalar/**`, `/saha/**`, `/eksik-var/**`                                                        | nonce    | no        | `strict-origin-when-cross-origin` | Next.js default |
| `admin`           | `/admin/**`                                                                                       | nonce    | yes       | `no-referrer`                     | `no-store`      |
| `app` (catch-all) | every other path: 404 page, `/robots.txt`, `/sitemap.xml`, `llms*.txt`, `.well-known` files       | nonce    | no        | `strict-origin-when-cross-origin` | Next.js default |

"Next.js default" for dynamic HTML is `private, no-cache, no-store, max-age=0, must-revalidate`.

Rows that match no page today: `/hakkinda`, `/sss` and `/sahalar/**` are listed so the headers are
ready, but no page exists for them (ADR-0057 and ADR-0080 put them out of scope). They answer 404
with the root not-found page, which is `noindex`.

The CSP (`pageContentSecurityPolicy`) allows only same-origin resources: `img-src 'self' blob:
data:`, `font-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`.
Inline `style` attributes are allowed (`style-src-attr`); style elements need the nonce. Fonts are
self-hosted WOFF2 files in `public/fonts` (ADR-0059).

## Caching and revalidation

HTML is never cached; data may be. The five-minute freshness of the spec ("ISR 5 min") lives in
the data layer of the programmatic pages (ADR-0055, ADR-0057):

- `lib/server/seo/queries.ts`: anonymous, user-independent queries (venue by slug, district
  listing, sitemap rows). A path segment that is not a slug (`a-z0-9` words joined by single
  hyphens, at most 80 characters) is a 404 without a query.
- `lib/server/seo/data.ts`: each read is wrapped in `unstable_cache` with `revalidate: 300`. The
  key contains a 16-character SHA-256 digest of `DATABASE_URL` plus every argument, so an entry
  read from one database is never served for another (the cache is stored on disk next to the
  build). React `cache` shares one result between `generateMetadata` and the page.
- Tags: `seo:venue:<slug>`, `seo:district:<il>/<ilce>`, `seo:sitemap`.
- Freshness is stale-while-revalidate, so an entry can be older than five minutes after a quiet
  period. The hard bound is applied after the cache on every read: calls whose `expiresAt` or
  `startsAt` has passed are dropped (`liveCalls`, `liveDistricts`), so an expired call is never
  listed.
- Targeted invalidation: `lib/server/seo/invalidate.ts` (`revalidateCallPages`) calls
  `revalidateTag(tag, { expire: 0 })` for each district of the call plus the sitemap tag, after the
  write has committed. It is wired into open-call publish, patch and close, application accept
  (which can fill the call), and match patch or delete. A failure is logged and never raised.
  Expiry of a call by the worker job does not invalidate; the read-time filter covers it.
  (ADR-0057 describes the tags as unused; the invalidation was added afterwards.)
- Not cached: the invite landing (a revocable bearer secret), the staff panel, the account pages,
  the blog and legal pages (read from files), `/robots.txt`, `/sitemap.xml` (built per request;
  its database rows come from the data cache) and the app-link files (rendered per request,
  `Cache-Control: public, max-age=3600` on success).

## Content pipeline for blog and legal pages

Source: `apps/web/content/blog/*.mdx` (five articles) and `apps/web/content/legal/*.mdx`
(`gizlilik`, `kvkk-aydinlatma`). The extension is `.mdx`, but there is no MDX dependency
(ADR-0080).

1. `lib/content/documents.ts` reads `content/<collection>/*.mdx` once per process. The file name
   is the slug. Front matter lines are `key: <JSON value>` and are validated with a strict schema:
   `title` (at most 80), `description` (at most 155), `publishedAt`, optional `modifiedAt`, `tags`
   (slugs, at most 8) and `sample`. It computes the word count and the reading time (200 words per
   minute, at least one minute). A request slug is only looked up in the loaded list, never joined
   into a path.
2. `lib/content/markdown.ts` parses the body into plain data. Allowed: `##` and `###` headings,
   paragraphs, bullet and numbered lists, one-line quotes, tables, links, bold and code spans.
   Anything else (JSX, imports, expressions, raw HTML, `#` headings, `javascript:`, `http:` or
   protocol-relative links, malformed tables) throws.
3. `components/content/markdown-view.tsx` renders the data as React elements. No HTML string is
   built, so the source guards (`tests/pages/source-guards.test.ts`) that forbid
   `dangerouslySetInnerHTML`, `<script` and `next/script` under `app/` and `components/` stay
   unchanged, apart from the single JSON-LD data block.
4. `tests/content` loads every file, so a file outside the subset fails the test gate instead of
   rendering unreviewed.
5. `next.config.ts` `outputFileTracingIncludes` copies `content/` into the standalone output for
   `/blog`, `/blog/[slug]`, `/gizlilik`, `/kvkk-aydinlatma` and `/sitemap.xml`, because the files
   are read at run time.

Adding an article is one `.mdx` file in the subset: the route, the sitemap entry (with `lastmod`
from the front matter) and the structured data follow from the front matter.

## JSON-LD helper rules

All structured data goes through one component, `components/seo/json-ld.tsx` (ADR-0055
decision 6):

- Rendered as the React text child of `<script type="application/ld+json">`; never
  `dangerouslySetInnerHTML` (`react/no-danger` is an error, and the source guards allow exactly
  this one data block in this one file).
- `serializeJsonLd` is `JSON.stringify` with `<`, `>`, `&`, U+2028 and U+2029 replaced by `\uXXXX`
  escapes, so `</script>` or `<!--` in database text cannot change the markup.
- `JsonLd` is an async server component that reads the nonce from the `x-nonce` request header
  that the proxy forwards (`NONCE_HEADER`) and sets it on the element. Reading the header keeps
  the page dynamic.
- One block per page, with `@context` and an `@graph` of typed nodes. Builders:
  `lib/server/seo/site-structured-data.ts` (`Organization`, `MobileApplication`, `Blog`,
  `Article`, `BreadcrumbList`) and `lib/server/seo/structured-data.ts` (`BreadcrumbList`,
  `SportsActivityLocation`). URLs are absolute and built from `WEB_ORIGIN`.
- Claim only what exists: no logo, rating, store URL or Pro price on the site-level nodes; a venue
  `aggregateRating` only when the page shows an average (at least three reviews); a sample venue
  gets the breadcrumb only. Per-page content is listed in [pages.md](pages.md).

## Other building blocks

- Metadata: `components/marketing/metadata.ts`. The layout sets `metadataBase`, the title template
  `%s · Kadro` and Open Graph and Twitter defaults, but no canonical. Each page calls
  `pageMetadata` for its canonical, `hreflang` (`tr-TR`, `x-default`) and its own Open Graph
  fields. Tests hold titles to 60 and descriptions to 155 characters.
- Navigation: `components/marketing/site.ts` lists the header and footer links. A test walks
  `app/` and fails when a link has no page (`typedRoutes` is on).
- Fonts: four `@font-face` rules in `components/marketing/fonts.css` (Inter and Sora, latin and
  latin-ext, `font-display: swap`) and preload links for the two latin faces.
- App links: `lib/server/app-links.ts` builds the AASA and assetlinks documents from
  `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256_FINGERPRINTS` and `APPLE_APP_STORE_ID` (ADR-0045,
  ADR-0058). Unset configuration answers 404, never a placeholder document.
