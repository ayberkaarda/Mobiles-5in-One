# ADR-0059: Visual redesign: the route board and the strip diagram

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Scope: `libs/ui`, `apps/mobile`, `apps/web` (public pages; the admin and deletion panels only
  restyled), `brand/` (additions), screenshots and the README card. No API change.

## Context

The owner disliked both looks. The app was list-centric and flat; without a hosted basemap every
map area read as an empty beige box with a failure caption; the line-code placard was timid. The
web home was clean but generic (hero, card, steps), and line, stop and guide pages were plain
document pages with no shared frame. Section 2 of the specification fixes the palette, the type
families and the tone; section 7 fixes the SEO and GEO structure that must survive.

## Decision

1. **Concept: the route board and destination sign of a dolmuş.** One sign family in both apps:
   the yellow line-code placard with the turquoise minibüs stripe and two rivets; the lacivert
   route board with krem lettering and the stripe along its foot; the destination sign (code,
   mode, start and end stops in sign lettering, each row turning in once like a flip display); the
   fare as a yellow ticket stub with a perforation; the stop pole; hazard tape only for the
   sample-data label; Fren Kırmızısı only for "stop request" moments (ride recording, hailing).
2. **A transit diagram instead of the empty basemap.** `route-strip.ts` lays out a line or an
   itinerary on one straight rail: one dot per stop (yellow terminals, capsules for transfers,
   squares for chosen places), names slanted at 38 degrees, stop numbers, line placards and
   "n durak" / "n m" labels under rides and dotted walks. Coordinates, paths, the view box and the
   label transforms come from numbers through the safe SVG helpers; names are text bindings only
   (no innerHTML, no bypassSecurityTrust). The strip is one image with a text alternative; the
   page also lists the stops as an ordered list (`iv-stop-sequence`, the vertical form of the
   same diagram, links on the web and buttons in the app). The web line page renders the same
   component on the server, so it works without JavaScript. The MapLibre map stays as an optional
   view: "Harita" on the app line page, "Haritada göster" on the stop page and after a planner
   result, the existing button on the web.
3. **Tokens.** `libs/ui/src/styles/_semantic.scss` holds the semantic tokens as Sass mixins
   (`scale`, `light`, `dark`). The app applies `dark` under `.ion-palette-dark` (manual or system
   choice, unchanged ThemeService); the web applies it under `prefers-color-scheme: dark`. Dark is
   the night bus: a deep lacivert street, near-black boards, the sign yellow slightly lit, lit
   windows in the street scene. The admin area stays light in every scheme (`color-scheme:
   light`), only its bar gained the stripe.
4. **Illustration.** One street scene from flat shapes (blocks, a minaret, a stop pole with a
   hailing passenger, a yellow dolmuş with "İNECEK VAR" on its board), coloured by tokens,
   source in `brand/illustrations/street.svg`. It drives in once on the web home unless reduced
   motion is set; elsewhere it is still.
5. **Typography.** The app keeps self-hosted DM Sans 700 and Inter. The web self-hosts DM Sans 700
   (latin and latin-ext) for display lettering and uses the system stack for body text: mobile
   Lighthouse performance stayed at 100 (the rule was "keep the font only at 98 or more").
6. **Budgets.** Sign styles that only components need travel with them (`sign-styles.ts`), the
   form rules (`forms.css`) load with the lazy pages that use them, and the unused Ionic padding
   utilities were dropped, so the app's initial bundle stays under the 720 kB warning.
7. **Behaviour is unchanged.** Routes, stores, offline packs, accessible names used by the e2e
   specs, KeepCodes and XSS-safe rendering stay. Selectors changed only where markup changed:
   the app line page opens the map behind "Harita" (mobile e2e clicks it), planner and line unit
   tests read the strip and the ticket, and a content test now also accepts in-page anchors and
   checks that each one resolves.
8. **Fixes found on the way.** The stop number inside the stop link polluted the link name
   ("Moda2"); it now sits beside the link. On the Android device the tab placard covered the icon
   (now the icon itself is the placard), the status bar icons were dark on lacivert (Capacitor
   `SystemBars.style = DARK`), a `.chosen` class clashed with the chosen-stop input, and adjacent
   itinerary placards overlapped (the pitch now leaves room for the widest placard).

## Before and after (viewed screen by screen)

| Screen or page | Before | After |
| --- | --- | --- |
| App Ara | form plus a plain list | "Nereye inecek var?" board with the search inside, city chip, hazard-tape sample label, three shortcut tiles, offline-pack card with the street scene, lines as route boards |
| App first run | stop-sign empty state | street scene, "Önce şehrini seç" and the offline-pack hint |
| App line | white header, empty beige map box | destination sign, Şema/Harita switch, strip diagram, fare ticket, vertical stop diagram |
| App Planla | form and a beige map below | board heading, the two ends joined by one rail, result as a board plus the itinerary strip, steps, map on request |
| App stop | heading over a lone dot on beige | stop-pole board, route boards of the lines, map on request |
| App Favoriler, packs, recorder | plain headings and cards | board headings; packs storage meter as a stretch of road; live recording board with a pulsing stop-request dot |
| App Katkı | yellow card | board hero with a lit trail of stops and a red "Yolculuğunu kaydet" stop-request button |
| App tab bar | thin top indicator | the current icon lit as a placard |
| Web home | hero, card, steps | huge name, tagline as a hanging destination sign, street scene with a full-width road, city route boards, steps as stops on the route rail, offline and "İNECEK VAR" teasers, road footer |
| Web city hub | plain lists | board with the count and the sample tape, the street scene, popular lines as route boards, recently updated list |
| Web line | document page with a projected sketch | destination sign with the h1, answer-first summary, strip diagram, ticket and facts in a sticky side column, actions, map button, stop diagram |
| Web stop, route, line list | plain lists | stop-pole board, from/to board, route-board grids |
| Web guides | plain article | heading band, sticky table of contents, stop-dot section heads, pull-quote notes, numbered guide cards on the index |
| Web 404 | text | knocked-over stop sign and a yellow home button (still the first tab stop) |

## Evidence (real output)

- Workspace gate from `inecekvar/`: `pnpm nx run-many -t lint test build --skip-nx-cache` exit 0,
  `Successfully ran targets lint, test, build for 5 projects and 1 task they depend on`; tests
  domain 4, data-access 110, ui 55, web 801, mobile 475.
- `pnpm nx run web:bundle-check`: `Public web bundle clean: 60 files, 6 markers.`
- Web e2e on the real stack (compose project `ivdes`, 127.0.0.1:58851-58857, fresh database):
  `65 passed (1.4m)`. Mobile e2e on the same stack with the worker: `PWA CSP check passed`,
  `11 passed (2.7m)`.
- Mobile production bundle: initial `717.66 kB` raw, `181.6 kB` transfer (warning 720 kB; the
  phase 3 gate measured 717.36 kB). Web production initial `415.81 kB` (budget 500 kB).
- Lighthouse 13.5.0, the ADR-0042 command, production build behind a local TLS proxy with
  gzip/brotli on 127.0.0.1:58874 (a Node stand-in for the Caddy container), mobile:
  `/` 100/100/100/100 (FCP 1.5 s, LCP 1.5 s, TBT 60 ms, CLS 0.018);
  `/ornek-test-sehri/hat/ornek-hat-1` 100/100/100/66, SEO 100 with `is-crawlable` skipped (the
  sample city is noindex by design, ADR-0042); `/rehber/dolmus-ve-minibus-hatti-nasil-okunur`
  100/100/100/100. Desktop: 100/100/100/100, 99/100/100/66, 99/100/100/100.
- WCAG contrast of the token pairs (computed): light ink on krem 15.09, muted on krem 6.79, muted
  on the deep band 6.03, board lettering 15.09, sign yellow on the board 8.79, placard ink 8.79,
  white on Fren Kırmızısı 4.96, success 5.20, danger 5.52; dark ink 17.59, muted 9.87 (8.84 on
  surfaces), lit sign 12.56, navy on the dark signal 5.28. All at or above AA.
- Screenshots: `docs/screenshots/phase3` (app, light and dark, partly rewritten by the e2e
  specs), `docs/screenshots/phase4` (admin), `docs/screenshots/web` (home, line, guide, dark
  home), `docs/screenshots/readme` (three Android screens from the `Pixel_8` emulator) and the
  repository card `docs/readme/inecekvar.png`.

## Not exercised

- iOS and Safari; Firefox. Android was checked on the `Pixel_8` emulator only.
- Lighthouse in the dark scheme and through the real Caddy and CDN; the contrast numbers for dark
  are computed, not measured by axe.
- The Android capture used a debug build with temporary, uncommitted changes (local API base,
  cleartext for localhost, mixed content allowed); they were reverted afterwards.
- A city with real data and more than eight stops on device: long strips scroll by design but were
  only checked in unit tests and the browser.
- Screen reader passes (TalkBack, VoiceOver, NVDA) beyond the accessible names the tests read.
