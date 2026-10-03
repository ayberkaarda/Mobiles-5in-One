# Pages

Every page-level route of `apps/web`. All HTML renders per request with the nonce CSP
([architecture.md](architecture.md)). "Index" is what a crawler is told: `index` is the default,
`noindex` comes from metadata, from the `X-Robots-Tag` header of the surface, or both. JSON-LD
"none" means the page emits no structured data block. File paths are relative to
`kadro/apps/web/`.

## Public pages

| Route                                     | File                                                  | Data source                                                                                                                      | Index                                                                                                     | JSON-LD                                                                              |
| ----------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/`                                       | `app/(marketing)/page.tsx`                            | static copy in `components/marketing/content.ts`                                                                                 | index, in sitemap                                                                                         | `Organization`, `MobileApplication` (`SiteJsonLd`)                                   |
| `/ozellikler`                             | `app/(marketing)/ozellikler/page.tsx`                 | static copy                                                                                                                      | index, in sitemap                                                                                         | `Organization`, `MobileApplication`                                                  |
| `/blog`                                   | `app/(marketing)/blog/page.tsx`                       | `content/blog/*.mdx` through `lib/content/documents.ts`                                                                          | index, in sitemap                                                                                         | `BreadcrumbList`, `Blog`, `Organization`                                             |
| `/blog/[slug]`                            | `app/(marketing)/blog/[slug]/page.tsx`                | the matching `content/blog/<slug>.mdx`; an unknown slug is a 404                                                                 | index, in sitemap (`lastmod` from front matter); the 404 is `noindex`                                     | `BreadcrumbList`, `Article`, `Organization` (no `image`)                             |
| `/gizlilik`                               | `app/(marketing)/gizlilik/page.tsx`                   | `content/legal/gizlilik.mdx`                                                                                                     | index, in sitemap; visible sample notice                                                                  | none                                                                                 |
| `/kvkk-aydinlatma`                        | `app/(marketing)/kvkk-aydinlatma/page.tsx`            | `content/legal/kvkk-aydinlatma.mdx`                                                                                              | index, in sitemap; visible sample notice                                                                  | none                                                                                 |
| `/iletisim`                               | `app/(marketing)/iletisim/page.tsx`                   | static copy in `components/content/copy.ts`; invents no address                                                                  | index, in sitemap; visible sample notice                                                                  | none                                                                                 |
| `/saha/[slug]`                            | `app/(seo)/saha/[slug]/page.tsx`                      | `publicVenue(slug)`: cached anonymous read of a verified or sample venue                                                         | verified: index, in sitemap. Sample: `noindex, follow`, not in sitemap. Unknown or unverified: 404        | verified: `BreadcrumbList` + `SportsActivityLocation`; sample: `BreadcrumbList` only |
| `/eksik-var/[il]/[ilce]`                  | `app/(seo)/eksik-var/[il]/[ilce]/page.tsx`            | `districtListing(il, ilce)`: cached public open calls (at most 50) and up to 24 public venues; expired calls are dropped at read | at least one live call: index, in sitemap. None: `noindex, follow`, not in sitemap. Unknown district: 404 | `BreadcrumbList`                                                                     |
| `/mac/[code]`                             | `app/(marketing)/mac/[code]/page.tsx`                 | `previewInvite` through `lib/server/invites/landing.ts`; not cached                                                              | always `noindex, nofollow`, `no-referrer`, `no-store`; no canonical                                       | none                                                                                 |
| `/robots.txt`                             | `app/robots.ts`                                       | `WEB_ORIGIN`                                                                                                                     | n/a                                                                                                       | n/a                                                                                  |
| `/sitemap.xml`                            | `app/sitemap.ts`                                      | `WEB_ORIGIN`, `content/blog`, cached `sitemapRows()`                                                                             | n/a                                                                                                       | n/a                                                                                  |
| `/.well-known/apple-app-site-association` | `app/.well-known/apple-app-site-association/route.ts` | `APPLE_TEAM_ID`                                                                                                                  | JSON file; 404 when unset                                                                                 | n/a                                                                                  |
| `/.well-known/assetlinks.json`            | `app/.well-known/assetlinks.json/route.ts`            | `ANDROID_CERT_SHA256_FINGERPRINTS`                                                                                               | JSON file; 404 when unset                                                                                 | n/a                                                                                  |
| `/llms.txt`, `/llms-full.txt`             | `public/llms.txt`, `public/llms-full.txt`             | static files                                                                                                                     | plain text for answer-engine crawlers                                                                     | n/a                                                                                  |
| any other path                            | `app/not-found.tsx`                                   | none                                                                                                                             | `noindex, nofollow`, rendered inside the marketing shell                                                  | none                                                                                 |

Notes:

- The venue and district pages open with a 40 to 60 word answer-first paragraph that names Kadro.
  A sample venue also shows a visible notice (`SAMPLE_NOTICE` in `components/seo/format.ts`).
- The venue page shows phone and address only for verified venues and the rating average only from
  three reviews (ADR-0038, ADR-0057). The district page shows the public projection of
  `GET open-calls`: team name and a verified directory venue, with no person, RSVP list, fee or
  free-text address.
- The invite page answers the same 404 for a malformed, unknown, expired, revoked or exhausted
  code. Each lookup is charged to rate limit group I by client address; over the budget, the page
  shows a notice with status 200 and no team data (ADR-0058). With `APPLE_APP_STORE_ID` set, a
  usable invite also carries the `apple-itunes-app` Smart App Banner meta. Store entries link only
  to configured listings and otherwise show "Yakında".
- `sitemap.xml` lists `/`, `/ozellikler`, `/blog`, each article, the three legal and contact
  pages, indexable district pages and verified non-sample venues. It never lists `noindex` pages.
- `/robots.txt` allows `/` and disallows `/api/`, `/admin/`, `/mac/`, `/giris`, `/sifremi-unuttum`,
  `/sifre-sifirla`, `/e-posta-dogrula` and `/hesap-silme`, and names the sitemap of `WEB_ORIGIN`.
- `public/llms.txt` currently lists the paths `/sss`, `/sahalar` and `/eksik-var`. None of them has
  a page on `main`, so they answer 404. This is an open item, see
  [seo-and-geo.md](seo-and-geo.md).

## Account pages (`(app)`)

Never indexed (`robots: noindex, nofollow` in metadata, `X-Robots-Tag` from the surface, and
disallowed in `robots.txt`). They talk to the `/api/v1/auth/**` and `/api/v1/me` endpoints from
client code and carry no structured data. The two token pages read a token from the URL fragment
and send `no-referrer` (ADR-0040).

| Route              | File                                 | Surface           |
| ------------------ | ------------------------------------ | ----------------- |
| `/giris`           | `app/(app)/giris/page.tsx`           | `email-link-page` |
| `/sifremi-unuttum` | `app/(app)/sifremi-unuttum/page.tsx` | `email-link-page` |
| `/sifre-sifirla`   | `app/(app)/sifre-sifirla/page.tsx`   | `token-page`      |
| `/e-posta-dogrula` | `app/(app)/e-posta-dogrula/page.tsx` | `token-page`      |
| `/hesap-silme`     | `app/(app)/hesap-silme/page.tsx`     | `email-link-page` |

## Staff panel (`(admin)`)

Every admin page is `noindex, nofollow` (metadata and header), `no-referrer`, `no-store`, and
disallowed in `robots.txt`. None carries JSON-LD. Details in [admin-panel.md](admin-panel.md).

| Route                                 | File                                                              | Data source                                                               |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/admin`                              | `app/(admin)/admin/page.tsx`                                      | redirects to `/admin/sahalar`                                             |
| `/admin/giris`                        | `app/(admin)/admin/giris/page.tsx`                                | password sign-in form                                                     |
| `/admin/dogrulama`                    | `app/(admin)/admin/dogrulama/page.tsx`                            | `POST /api/v1/admin/step-up`                                              |
| `/admin/totp-kurulum`                 | `app/(admin)/admin/totp-kurulum/page.tsx`                         | `POST /api/v1/admin/totp/enroll` and `/confirm`                           |
| `/admin/sahalar`                      | `app/(admin)/admin/(panel)/sahalar/page.tsx`                      | `GET /api/v1/admin/venues` (in process); `PATCH /api/v1/admin/venues/:id` |
| `/admin/sahalar/ice-aktar`            | `app/(admin)/admin/(panel)/sahalar/ice-aktar/page.tsx`            | `POST /api/v1/admin/venues/import`                                        |
| `/admin/sahalar/ice-aktar/[importId]` | `app/(admin)/admin/(panel)/sahalar/ice-aktar/[importId]/page.tsx` | `GET /api/v1/admin/venues/import/:importId`                               |
| `/admin/kullanicilar`                 | `app/(admin)/admin/(panel)/kullanicilar/page.tsx`                 | `GET /api/v1/admin/users`; role and deactivate endpoints                  |
| `/admin/denetim`                      | `app/(admin)/admin/(panel)/denetim/page.tsx`                      | `GET /api/v1/admin/audit-logs`                                            |

## Error pages

`app/error.tsx` and `app/global-error.tsx` (root), `app/(marketing)/error.tsx` and
`app/(seo)/error.tsx` show a generic message and the digest only (security checklist item 13).
