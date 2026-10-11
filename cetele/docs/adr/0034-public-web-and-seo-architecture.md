# ADR-0034: Public web and SEO architecture

- Status: Accepted
- Date: 2026-10-11
- Deciders: Ayberk (owner)

## Context

Spec section 7 asks for a public Turkish website on the server: marketing pages, four trade
landings, five guides, the FAQ, legal pages, a sitemap and robots file, JSON-LD, `hreflang`, Open
Graph, `llms.txt`, the Android app link file and Lighthouse budgets of at least 90. The texts are
written by separate content writers as Markdown files under
`server/src/main/resources/content/{pages,trades,guides,legal}/<slug>.md` with a fixed front matter
(`slug`, `title` up to 60 characters, `description` up to 155, `updated`, `lead`, `keywords`,
`breadcrumb`, and `faq` on `pages/sss.md`). The server already serves two kinds of HTML under the
strict CSP of [ADR-0010](0010-security-headers-csp-and-https.md): the statement page
([ADR-0015](0015-statement-links-and-public-page.md), `noindex`) and the admin console
([ADR-0033](0033-admin-console-and-audit-log.md), `noindex`). The site must not weaken either, must
not change the API contract, and must state only true facts about a portfolio project
([ADR-0004](0004-portfolio-delivery-scope.md)): no price, no company, no store listing.

## Decision

### One route registry

`web.site.SiteRoutes` is the only list of public pages: `/`, `/ozellikler`, `/fiyatlandirma`,
`/esnaf-icin/{bakkal,manav,kasap,berber}`, `/rehber`, `/rehber/{five guide slugs}`, `/sss`,
`/hakkinda`, `/gizlilik`, `/kvkk-aydinlatma`, `/hesap-silme` and `/iletisim`. Each entry names its
kind, its label and its content file. The controller, the sitemap, `llms.txt`, `llms-full.txt`, the
navigation, the breadcrumbs and the startup check all read it. An unknown slug under
`/esnaf-icin/` or `/rehber/` renders the 404 page (`noindex`, `no-store`, no canonical, no
structured data). Only the guide index has no content file; its title, description and lead are
fixed in the registry.

### Content loading

- `cetele.site.content-location` (default `classpath:content/`) is the folder of the Markdown
  files. At startup `SiteContent` reads the file of every registry route, parses the front matter
  with SnakeYAML's safe constructor (no type tag can create an object), and checks the slug, the
  title and description limits, the `updated` date, a non-empty lead and body, and a non-empty `faq`
  list on `/sss`. Any problem stops the application with one message listing every missing or
  invalid file, so a broken page cannot be deployed. Line endings and a byte order mark are
  normalised.
- Markdown is rendered with CommonMark (`org.commonmark`, GFM tables). Raw HTML in a file is
  escaped, never passed through. Link and image targets other than site paths, anchors, `https:`,
  `http:` and `mailto:` are emptied. Headings are kept between `h2` and `h6`, so the page title is the
  only `h1`. CommonMark's URL sanitiser is not used because it marks every link `nofollow`.
- The test profile reads `classpath:content-fixtures/` (short `[ÖRNEK]` fixtures in
  `src/test/resources`), so the web tests do not depend on the copy. `SiteContentFilesTest` also
  loads the real `content/` folder and fails on a missing file or a limit breach.

### Templates without unescaped output or inline code

One Thymeleaf template, `templates/site/page.html`, renders every page: skip link, header with the
inline brand mark, breadcrumb navigation, one `h1`, the lead, the Markdown body, the FAQ list, link
cards and a footer with all pages and the portfolio note. `lang="tr"`, no inline `style`, no event
handler, no script. `TemplateScanTest` bans `th:utext` and `<script` in every template, so a small
dialect (`SiteDialect`) adds two attributes:

- `site:html` prints a `SafeHtml` value; only the Markdown renderer creates that type;
- `site:jsonld` replaces its element with `<script type="application/ld+json">` holding a `JsonLd`
  value; the serialiser writes `<`, `>`, `&`, U+2028 and U+2029 as `\u` escapes, so the text cannot
  close the element.

Any other value type fails the render. A JSON-LD block is a data block: browsers never execute it,
so the CSP does not apply to it.

### Page metadata

- `<title>` and `description` come from the front matter (60 and 155 character limits checked at
  startup and by the tests). The visible `h1` is the title without the ` | Çetele` suffix.
- Canonical, `hreflang="tr-TR"` and `hreflang="x-default"` (the site has one language, so both name
  the same URL), `og:url`, sitemap entries and `llms.txt` links use `cetele.site.base-url`, default
  `https://cetele.app` (an origin without a trailing slash; checked at startup).
- Open Graph and Twitter `summary_large_image` use `/assets/site/og-cetele.png` (1200 x 630, the
  brand mark and wordmark from `brand/logo`). Pages carry
  `robots: index, follow, max-image-preview:large`; guides add `article:modified_time`.

### Structured data

Each page has one JSON-LD `@graph`:

| Page                                         | Types                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| every page                                   | `Organization`, `WebSite`                                                          |
| `/`, `/ozellikler`, `/fiyatlandirma`, trades | `MobileApplication` (Android, `BusinessApplication`)                               |
| every page                                   | `WebPage` (`FAQPage` on `/sss`, `CollectionPage` on `/rehber`) with `dateModified` |
| guides                                       | `Article`, `datePublished` and `dateModified` from the file's `updated`            |
| every page below the home page               | `BreadcrumbList` (home, the guide index for guides, the page)                      |

`MobileApplication.offers` is one `Offer`: `Free`, price `0`, `TRY`. Pro has no fixed price in this
project, so it gets no `Offer`; its limits and "fiyatlar Google Play'de gösterilir" are in the
description. The `FAQPage` questions are the `faq:` list of `pages/sss.md`, which the page also shows.
No rating, review, award, user count or legal name is published.

### Machine-readable files

- `/sitemap.xml`: one `<url>` per registry route, `lastmod` from `updated` (the guide index takes
  the newest guide).
- `/robots.txt`: `Allow: /`, `Disallow: /admin`, `Disallow: /s/`, `Disallow: /v1/` and the
  `Sitemap` line. The statement page and the console keep their `noindex` meta and header.
- `/llms.txt` (llmstxt.org layout): the home page lead as the definition, status, audience,
  features, plans and a linked index of every page with its description. `/llms-full.txt` adds every
  page in Markdown with absolute links and the FAQ. The plan numbers are read from `PlanLimits`, so
  the published limits are the enforced ones.
- `/.well-known/assetlinks.json` for `app.cetele.android`: emitted only when
  `cetele.site.android-cert-fingerprints` holds at least one SHA-256 fingerprint (32 upper-case hex
  pairs joined by colons; anything else stops the application). Without one the path answers 404;
  no fingerprint is ever invented. The statement uses
  `relation_extensions.dynamic_app_link_components` to limit verified links to `/s/*` and
  `/invite/*` and exclude the rest (Android 15 and later); older versions rely on the app's intent
  filter paths.

### Security chain

`SiteSecurityConfig` adds a `SecurityFilterChain` at order 30 whose matcher is the registry paths,
the two slug families, the files above and `/assets/site/**`. The statement page, `/admin/**` and
`/v1/**` are not matched and keep their chains.

- No authentication, stateless, a request-scoped security context, no CSRF token (nothing changes
  state), no request cache: no session and no cookie is ever created.
- Only GET and HEAD reach a handler; any other method gets 405 with `Allow: GET, HEAD`.
- A per-client-address token bucket, 120 requests per minute (`cetele.site.requests-per-minute`),
  in the style of [ADR-0009](0009-rate-limiting-and-client-ip.md): Bucket4j on Caffeine, interval
  refill, the trusted client address, 429 with `Retry-After`.
- The header baseline of ADR-0010 (`SecurityHeadersConfig`: HSTS on secure requests, `nosniff`,
  `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`, `Permissions-Policy`) and the HTTPS
  redirect outside `local` and `test`.
- A fixed CSP without a nonce: `default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self'
data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. The pages
  load one stylesheet and no script, so a nonce protects nothing here, and a per-request nonce in
  the HTML would make every response different and defeat the ETag.
- Caching: pages `public, max-age=300`, the four files `public, max-age=3600`, assets
  `public, max-age=604800`, the 404 page, 405 and 429 `no-store`. `ShallowEtagHeaderFilter` adds an
  ETag and answers `If-None-Match` with 304.
- The controller is `@Hidden` and outside `/v1`, so the OpenAPI document does not change.

### Performance budget

No JavaScript. One stylesheet (about 6 KiB) with the light and dark schemes of `brand/tokens.json`.
Fonts are self-hosted WOFF2 files cut from the brand TTF files to Latin, Latin-1, the Turkish
letters, typographic punctuation and the lira sign (Inter 400 and 600, Manrope 700; 69 KiB together)
with `font-display: swap`; the heading and body fonts are preloaded. Budgets are in
[`docs/seo/lighthouse-budgets.json`](../seo/lighthouse-budgets.json) (a Lighthouse CI configuration:
performance, accessibility, SEO and best practices at least 0.9; total weight, font, stylesheet,
image and script budgets; LCP, CLS and TBT limits).

### Configuration

| Key                                     | Environment                                    | Default               |
| --------------------------------------- | ---------------------------------------------- | --------------------- |
| `cetele.site.base-url`                  | `CETELE_SITE_BASE_URL`                         | `https://cetele.app`  |
| `cetele.site.content-location`          | `CETELE_SITE_CONTENT_LOCATION`                 | `classpath:content/`  |
| `cetele.site.android-cert-fingerprints` | `CETELE_ANDROID_CERT_SHA256` (comma separated) | empty: assetlinks 404 |
| `cetele.site.requests-per-minute`       | none                                           | `120`                 |

## Consequences

- Evidence: `SiteWebTest` (every registry route 200 with one `h1`, `lang="tr"`, canonical,
  `hreflang`, Open Graph, Twitter and robots meta; title and description limits; no inline style,
  handler or script other than the JSON-LD block; the security headers; unknown slugs 404; JSON-LD
  parses with the expected types per page, the single free offer, the FAQ equal to the file and
  guide dates equal to `updated`; sitemap equal to the registry; robots rules; `llms` plan numbers
  equal to `PlanLimits`; assetlinks 404 when unset; statement and console still `noindex`; no
  session or cookie; ETag and 304; HEAD; 405; 429), `SiteFilesTest` (assetlinks content when set,
  fingerprint and base URL validation, absolute links in `llms-full.txt`), `SiteContentFilesTest`
  (fixtures and the real content files against the limits, fail-fast message, registry against the
  specification), `ContentParserTest` (front matter, CRLF and BOM, YAML tags refused, escaping,
  unsafe links, heading levels). Command: `./gradlew check openApiContractCheck` in `cetele/server`.
- Lighthouse 12 (default mobile settings) scored 100 in performance, accessibility, best practices
  and SEO on `/`, `/ozellikler`, `/fiyatlandirma`, `/sss`, one guide and one trade page with the real
  content, total transfer about 89 KiB on the home page. That run served the HTML rendered by the
  application from a local static server, not the Spring server, and is not part of CI:
  `not exercised: Lighthouse CI job` until the CI owner adds it with the budgets file.
- Not exercised: a real domain, Google's Rich Results Test and Search Console, and Android's
  verification of `assetlinks.json` against a real signing certificate ([ADR-0004](0004-portfolio-delivery-scope.md)
  G7, G5).
- `PublicSurfaceTest` no longer uses `/` as its example of a path denied by default, because `/` is
  now the public home page; it uses an unlisted path.
- A new page is a registry entry plus a content file; the sitemap, `llms` files, navigation and
  startup check follow without further code.
