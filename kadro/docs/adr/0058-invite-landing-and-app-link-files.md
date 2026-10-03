# ADR-0058: Invite landing page and verified app link files

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0011, ADR-0021, ADR-0034, ADR-0045, ADR-0055, ADR-0056; product spec §7
  (`/mac/[inviteCode]`, "App linking"); authorization matrix §3.3 footnote 28, §8 group I

## Context

Product spec §7 asks for an invite landing page `/mac/[inviteCode]` (`noindex`, Smart App Banner,
deep link into the app) and for `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json`. ADR-0034 fixes what an invite preview may disclose and that every
unusable code answers the same 404; ADR-0045 fixes the shared path set, the identifiers and the
configuration keys (`APPLE_TEAM_ID`, `APPLE_APP_STORE_ID`, `ANDROID_CERT_SHA256_FINGERPRINTS`).
ADR-0055 requires every HTML page to render per request with the nonce CSP.

## Decision

1. **Page and data.** `app/(marketing)/mac/[code]/page.tsx` renders inside the marketing shell
   (ADR-0056), whose layout already renders per request. `lib/server/invites/landing.ts` reads
   the invite through the preview service of `GET invites/:code` (`previewInvite`) with an
   anonymous request context, so the page discloses exactly what the endpoint does: team name,
   district (il and ilçe names) and member count. No member or captain name, no email, and no
   badge image (a media URL is another origin, and ADR-0034 allows no third-party resource on
   this page). Nothing is cached: an invite is a bearer secret that can be revoked at any time.
2. **Uniform 404 and probing.** A malformed code is a 404 without a query. An unknown, expired,
   revoked or exhausted code is the same 404 after the one indexed lookup of `previewInvite`. Each
   lookup is charged to rate limit group I by client address, the budget of the preview endpoint,
   so the page is no cheaper way to probe codes. React `cache` shares one lookup between
   `generateMetadata` and the page, so a request is charged once. A visitor over the budget gets a
   page with a "too many invite links opened" message and no team data; a page cannot answer 429,
   so the status is 200 (the page is `noindex` and `no-store`).
3. **Headers.** A new row `invite-page` (`/mac/**`) in the surface table of ADR-0055 gives the page
   and its 404 the nonce CSP, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`
   and `Cache-Control: no-store`, the same treatment as the token pages, because the path carries
   the secret. The page metadata repeats `robots: noindex, nofollow` and `referrer: no-referrer`.
   The title is "Takım daveti", with no team name and no canonical, so a browser history entry or
   a link preview shows nothing about the team. The `app` row no longer lists `/mac/**`.
4. **App and stores.** "Daveti uygulamada aç" links to `kadro://mac/<code>` (ADR-0045); opening
   it only navigates, joining needs a verified account and an explicit tap (ADR-0034, ADR-0045
   decision 7). Store entries link only to configured listings: App Store from
   `APPLE_APP_STORE_ID` (`https://apps.apple.com/tr/app/id<id>`), Google Play for the fixed
   application id once `ANDROID_CERT_SHA256_FINGERPRINTS` is set (Play App Signing fingerprints
   exist only after the app is set up in the Play Console). Otherwise the entry stays the
   "Yakında" label of ADR-0056. With `APPLE_APP_STORE_ID` the page of a usable invite carries the
   `apple-itunes-app` meta with `app-argument` set to the invite link; a 404 never does, so every
   404 renders the same document.
5. **Verified link files.** Route handlers at the exact paths
   `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`, rendered per
   request (`force-dynamic`, configuration is read at run time, never at build time), answer
   `200 application/json` with no redirect and `Cache-Control: public, max-age=3600`:
   - AASA: `applinks.details[0]` with `appIDs: ["<APPLE_TEAM_ID>.app.kadro.mobile"]` and one
     `components` entry per `APP_LINK_PATH_PATTERNS` path (`/mac/*`, `/saha/*`, `/eksik-var/*`,
     `/e-posta-dogrula`, `/sifre-sifirla`).
   - assetlinks: one `delegate_permission/common.handle_all_urls` statement for the package
     `app.kadro.mobile` with every configured fingerprint.
6. **Unset configuration means 404, not a minimal document.** Without `APPLE_TEAM_ID`, or with
   no fingerprint, the file answers `404 text/plain` with `no-store`. An empty value counts as
   unset (`@kadro/config` drops `KEY=`), and a placeholder such as `TEAMID` or a malformed
   fingerprint fails configuration validation at start-up, so no response can name a wrong or
   placeholder app. A minimal document (empty `details` or an empty statement list) was rejected:
   it would be a valid association with no app, which Apple's CDN caches and which hides the
   misconfiguration, while a 404 is visibly "not set up yet" (ADR-0045 decision 4).

## Consequences

- The invite link works on every surface named in ADR-0045: the web page without the app, the
  custom scheme from the page, and universal links / App Links once the owner sets the three keys
  and a real domain is served over https.
- `scripts/security/headers-check.ts` and the build tests probe the new surface through its
  probe path `/mac/headers-check-probe` (a malformed code, 404 without a database read).
- A link preview bot fetching an invite link spends one lookup of that address's group I budget.
- Tests: `tests/invites/app-links.test.ts` (documents, store entries, surface row) and
  `tests/invites/built-invite-landing.test.ts` (production build with and without configuration:
  summary, no private data, nonce on every script, headers, identical 404 bodies, JSON files
  without redirect, 404 without configuration, group I budget charged once per request).

## Rejected alternatives

- **Show the team name in the title or Open Graph tags.** Messaging apps would put it in the
  chat preview and browsers in the history; the page itself already shows it to the holder.
- **Cache the preview like the SEO data (ADR-0057).** A revoked invite would keep showing its
  team for up to the cache lifetime.
- **Treat a rate-limited lookup as 404.** A legitimate visitor would be told the invite is
  invalid; the message reveals nothing about the code.
