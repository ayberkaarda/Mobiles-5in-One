# ADR-0030: Mobile app shell and design system

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 3, package 3A

## Context

Section 10 phase 3 starts with the design system and the Ionic app shell. Section 2 fixes the
palette, DM Sans and Inter (self-hosted) and the tone of voice; section 4 fixes Transloco with
Turkish as the default and English as the second language. ADR-0001 decision 13 left the font
files to a later package. ADR-0005 requires executed evidence and a list of what was not
exercised.

## Decision

1. **Visual language.** The shell borrows from the dolmuş itself: lacivert chrome (toolbar and
   tab bar in both modes) with the 4 px turquoise minibüs stripe under the toolbar; line codes
   sit on a yellow window placard with a turquoise lower edge; fares are lacivert price tags with
   tabular digits; cards are white on krem with a hard 3 px offset shadow instead of a blur.
   Yellow is used only as a surface (placards, primary button, active tab), never as text on
   krem. The empty, error and offline states share one illustration: a stop sign on a pole
   (upright yellow, knocked over in red, greyed out offline).
2. **Tokens.** `libs/ui/src/styles/tokens.css` stays derived from `brand/tokens.json`.
   `theme.css` adds semantic tokens (`--iv-bg`, `--iv-surface`, `--iv-ink`, `--iv-ink-muted`,
   `--iv-line`, `--iv-chrome`, `--iv-accent`, `--iv-stripe`, radii, spacing) and the Ionic
   component variables. Muted text uses `#4F5866`, a darker Yol Grisi, because `#6C757D` on krem
   is just under 4.5:1. `shell.css` holds the toolbar, tab bar indicator, page rhythm, panel and
   button rules.
3. **Dark mode.** The `ion-palette-dark` class on `<html>`, set by `ThemeService` from the stored
   choice (`system`, `light`, `dark`; default `system`, following `prefers-color-scheme`
   live). Ionic's `dark.class.css` supplies the step colours; `theme.css` then restores the brand
   colours that palette replaces. `<meta name="theme-color">` follows the mode.
4. **Fonts.** `@fontsource/dm-sans` 5.3.0 (700) and `@fontsource/inter` 5.3.0 (400, 500, 600),
   latin and latin-ext subsets only (latin-ext carries ç ğ ı İ ö ş ü), imported through
   `libs/ui/src/styles/_fonts.scss`. The build copies the files into `media/`; no third-party
   font host is contacted. The service worker prefetches the woff2 files.
5. **Components in `libs/ui`.** `iv-line-card`, `iv-mode-chip`, `iv-fare-chip` and `iv-state`
   are standalone, OnPush, signal-input components with no copy of their own: every visible
   or spoken string is an input, so the library stays language-neutral.
6. **i18n.** `@jsverse/transloco` 8.4.0. `apps/mobile/src/app/i18n/tr.ts` is the source of the
   key set; `en.ts` is typed as `Translation` (the same keys, any strings), so a missing or extra
   English key fails compilation. `TranslationKey` is the union of dotted key paths; the `t` pipe
   (a typed subclass of `TranslocoPipe`) and `LanguageService.t()` accept only those keys, so
   with strict templates an unknown key is a build error. Turkish ships in the main bundle,
   English is a lazy chunk. The language is stored locally and mirrored to `<html lang>`.
7. **Routes.** Turkish slugs under one lazy tab shell: `/ara`, `/planla`, `/favoriler`,
   `/katki`, `/ayarlar`; `''` redirects to `/ara`; any other path lazy-loads a not-found page
   that uses the error state.
8. **Local preferences.** Theme, language and guest favourites live in `localStorage` behind
   guarded accessors (non-sensitive values only, ADR-0004); a missing or throwing store falls
   back to defaults.
9. **Sample content.** Until the pack and search clients exist, the search and favourites tabs
   render the labelled sample of `api/app/seed/sample_city.py` (`ORN-1` to `ORN-3`,
   `[ÖRNEK] Test Şehri`) with a note that it is development data. No real line data is shown.

## Evidence

Run on 2026-10-12 on the owner's Windows 11 machine, branch `feat/inecekvar-p3`:

| # | Command | Result |
| - | ------- | ------ |
| 1 | `pnpm add --save-exact @jsverse/transloco@8.4.0 @fontsource/dm-sans@5.3.0 @fontsource/inter@5.3.0` | 6 packages added, lockfile updated |
| 2 | `pnpm nx run-many -t lint test build -p mobile ui --skip-nx-cache` | exit 0; lint clean; ui 12 tests, mobile 31 tests; production build with one budget warning (row 4) |
| 3 | `pnpm exec prettier --check` on the changed paths | clean |
| 4 | Production bundle | initial 619.5 kB raw, 156.4 kB transfer (phase 0: 440 kB raw); over the 500 kB warning budget, under the 1 MB error budget |
| 5 | Screenshots: production build served on 127.0.0.1, headless Chrome 155 at 360 × 800, device scale 2, light and dark colour scheme | 16 PNGs in `docs/screenshots/phase3/` (5 tabs, not-found, the plan no-city state and the search empty state, each light and dark); no console errors |

The screenshots were reviewed and iterated twice: the search placeholder was truncated at
360 px, the hours on line cards broke at the hyphen, line names drifted with placard width,
"300 m" split across lines, the fare icon read as a rouble sign, and the plan destination ring,
the state sign outline and the button press shadow disappeared in dark mode. All were fixed
before the final set.

Not exercised:

- `not exercised: native Android and iOS rendering` (only Chrome headless; safe-area insets are
  zero there, so the `--ion-safe-area-*` paddings were not visually checked).
- `not exercised: iOS mode styling` (Chrome renders Ionic's `md` mode; the `ios` tab bar and
  toolbar were not screenshotted).
- `not exercised: the service worker` (screenshots blocked service workers; the new `fonts`
  prefetch group was not observed in a running worker).
- `not exercised: an axe contrast run` (ratios were computed with `contrastRatio` from
  `brand/scripts/build-tokens.mjs`: muted `#4F5866` is 6.79:1 on krem and 6.11:1 on the sunk
  surface, `#6C757D` is 4.43:1 on krem, dark-mode muted `#B9BFCB` is 8.45:1 on the card
  surface; axe in Playwright is a later QA package).
- `not exercised: English screenshots` (English is covered by unit tests only).

## Consequences

- The initial bundle is over the warning budget. The next package should look at what the
  Ionic standalone barrel and Transloco pull into the main chunk before raising the budget.
- The line card's open event is not routed yet; the line page arrives with the search and map
  package. The contribution actions are informational until the auth UI exists.
- New user-facing strings go into `tr.ts` first; the compiler then forces the English entry.
