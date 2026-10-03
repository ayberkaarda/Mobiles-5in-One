# ADR-0084: Design direction, dual colour schemes and the v3 brand tokens

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), Ayberk (owner) for the dual-scheme decision
- Related: ADR-0047 (mobile client architecture), ADR-0055 (nonce CSP on every HTML surface),
  ADR-0056 (marketing shell; its font and palette parts are superseded here), ADR-0059 (web
  quality gates), ADR-0083 (card images); product spec §2; `docs/design/direction.md`

## Context

The first identity (spec §2, ADR-0056) used Sora and Inter, Pitch Green as a wall colour and one
light theme on the web; the app followed the system appearance with a dark palette that had
contrast gaps. `docs/design/direction.md` replaces that look with "the squad sheet under
floodlights": kit numerals, chalk on turf as a data diagram, the night surface. Its first draft
made the web light only and the app dark first. The owner then decided that **both the web and
the app ship a light and a dark scheme**, follow the system setting by default and offer a
manual choice (Sistem / Açık / Koyu), with every contrast pair held in both schemes. The apps
read `packages/brand/tokens.json` and the Sora and Inter files by path today, and their tests
compare values with that file, so the new tokens cannot simply overwrite it while other work
packages still have to move the readers.

## Decision

1. **One token source, v3, with two designed schemes.** `packages/brand/theme/tokens.json` holds
   the palette, 29 semantic colour roles for `light` and `dark`, overlays, the type system,
   spacing (4-pt grid), radius (4/8/12/20/full), elevation, motion, state mappings and the
   theming contract. Every role value must be a palette entry. The dark scheme is designed, not
   inverted: bright green and red fills with ink labels, a chalk focus ring, a raised surface step
   instead of shadows. The deeper light accent `#E35A14` replaces `#E85D16` so the button clears
   3:1 on the sunken band as well as on chalk.
2. **Fixed roles.** `pitch`, `pitchLine`, `onPitch`, `pitchMarker`, `onPitchMarker` have one value
   in both schemes: the pitch diagram is always night turf with chalk. Its edge on dark is the
   chalk touchline (turf on night is 2.26:1, so the turf edge carries no meaning there).
3. **Contrast is a build gate in both schemes.** `validate-tokens.mjs` checks every listed text
   pair at 4.5:1 and every non-text pair at 3:1 in light and in dark, and fails if a meaningful
   role is not covered in either scheme. At the time of writing: 33 text and 23 non-text pairs
   per scheme; lowest text 4.87 (light) and 5.01 (dark), lowest non-text 3.12 and 3.31.
4. **Built consumer files, committed.** `scripts/build-tokens.mjs` writes `theme/theme.css`
   (custom properties `--k-*`; light on `:root` and `[data-theme='light']`, dark on
   `[data-theme='dark']` and inside `prefers-color-scheme: dark` for `:root:not([data-theme])` and
   `[data-theme='system']`) and `theme/tokens.ts` (typed `colors.light` / `colors.dark`, the
   native type scale on static font instances, no CSS). Both are formatted with the repository
   Prettier and committed; the package test fails when they are stale. Package exports:
   `./theme/tokens.json`, `./theme.css`, `./tokens`, `./fonts/*`, `./logo/*`.
5. **Scheme switching without inline script.** Web: the server reads the `kadro-theme` cookie and
   renders `<html data-theme>`; without a cookie the value is `system` and CSS follows the media
   query. Every HTML surface already renders per request for the CSP nonce (ADR-0055), so the
   first paint is right, there is no flash and the CSP gains no source. The toggle posts to a
   same-origin handler that sets the cookie and redirects back. Mobile: the provider resolves a
   locally stored preference (AsyncStorage) against the device appearance.
6. **Typeface: Archivo (supersedes the font part of ADR-0056).** One family at two widths,
   `wdth 75` for display and numerals (700-800) and `wdth 100` for body (400-600), SIL Open Font
   License 1.1 with no Reserved Font Name; the licence text ships in `fonts/archivo/OFL.txt`. The
   package keeps the unmodified upstream variable file (google/fonts, version 2.001) and files
   cut from it with fontTools: two WOFF2 subsets for the web limited to `wdth 75-100` and
   `wght 400-800` (latin 55 KB including the Turkish letters and ₺, latin-ext 51 KB) and five
   static TrueType instances for React Native and the card renderer (`Archivo-Regular`,
   `-Medium`, `-SemiBold`, `ArchivoCondensed-Bold`, `-ExtraBold`; named Condensed after the
   font's own STAT table, because Archivo Narrow is a separate family). The validator reads the
   font tables and requires U+011E U+011F U+0130 U+0131 U+015E U+015F U+00C7 U+00E7 U+00D6 U+00F6
   U+00DC U+00FC U+20BA, `tnum` and `locl` in every file that needs them.
7. **Palette (supersedes the palette part of ADR-0056).** Night `#0C1611`, chalk `#F5F6F1` and ink
   `#0F1A14` replace `#0E1A14` / `#F4F6F0`; the identity hues `#1B7F4B`, `#FF6B1A`, `#F2C230`,
   `#D7263D` stay, so the mark and the app icon are unchanged. Green is never a background.
8. **Wordmark.** `KADR` in Archivo `wdth 75` weight 800 as outlines, kerned as the font sets
   them, and the `O` as the pitch centre circle with the orange ball spot; view box 3152 × 861.
9. **Compatibility.** The v1 `tokens.json` and `fonts/sora`, `fonts/inter` stay unchanged and
   checked until the web shell, the mobile theme and the card renderer have moved; the package
   README lists every v1 name in use. The brand owner removes them afterwards.

## Consequences

- The web and the app gain a dark and a light scheme with the same role names; app code and
  stylesheets refer to roles, never to hex values.
- Readers to migrate (README table): web `MARKETING_THEME` and `marketingThemeVariables()`,
  `lib/client/theme.ts` `THEME` and `themeVariables()`, the root layout colours, `fonts.css`,
  the two web tests that read v1, `og-image.tsx` `OG_PALETTE` and its 304 × 64 wordmark box
  (234 × 64 for the new view box); mobile `src/theme/tokens.ts`, `fonts.ts`, `theme.ts`,
  `navigation.ts` and `tests/theme.test.tsx`.
- The card renderer draws the light wordmark into a fixed 304 × 64 box, and `next/og` fills an
  image box without keeping the aspect ratio, so until `og-image.tsx` uses 234 × 64 the new
  wordmark appears 30 % too wide on the cards. That one-line change has to land with this
  package version.
- Adding a role means a value in both schemes, a palette entry and its contrast pairs; the build
  fails otherwise.
- The package now has a typecheck (`tsc` over `theme/tokens.ts`) and ESLint in its scripts, using
  the workspace TypeScript and ESLint; no dependency or lockfile change.
