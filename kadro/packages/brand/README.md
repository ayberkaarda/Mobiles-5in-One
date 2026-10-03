# @kadro/brand

Single source of the Kadro identity: colour roles for a light and a dark scheme, type, spacing,
radius, elevation and motion tokens, the files each app consumes (a CSS theme for the web, a
typed module for React Native), the Archivo font files and the logo SVGs. The design rationale is
in `docs/design/direction.md`; the decision record is ADR-0084.

## Contract: exports

| Export (package path)            | File                | Consumer                                                      |
| -------------------------------- | ------------------- | ------------------------------------------------------------- |
| `@kadro/brand/theme/tokens.json` | `theme/tokens.json` | Source of truth (v3). App tests compare against it.           |
| `@kadro/brand/theme.css`         | `theme/theme.css`   | `apps/web`: one stylesheet with every custom property.        |
| `@kadro/brand/tokens`            | `theme/tokens.ts`   | `apps/mobile`: typed `colors.light` / `colors.dark` and more. |
| `@kadro/brand/fonts/*`           | `fonts/archivo/**`  | Web subsets (WOFF2), native static instances (TTF), OFL.      |
| `@kadro/brand/logo/*`            | `logo/*.svg`        | Wordmark, mark, app icon.                                     |
| `@kadro/brand/tokens.json`       | `tokens.json`       | **v1, frozen.** Read by the apps until they migrate (below).  |

`theme/theme.css` and `theme/tokens.ts` are built from `theme/tokens.json` by
`scripts/build-tokens.mjs`. Edit the JSON, run `pnpm --filter @kadro/brand build` and commit all
three; `pnpm --filter @kadro/brand test` fails when a built file is stale. `apps/mobile` reads
brand files by relative path (ADR-0047); a relative import of the same file is equivalent to the
package path.

### `theme/theme.css`

Custom properties, all prefixed `--k-`:

- Colour roles `--k-color-<role>` (kebab case: `--k-color-surface-sunken`), overlays
  `--k-overlay-pressed`, `--k-overlay-scrim`, elevation `--k-elevation-0..2`: per scheme.
- Type: `--k-font-family`, `--k-font-stretch-{display,body,numeric}`, `--k-font-numeric`
  (`tabular-nums`) and per web variant `--k-type-<variant>-{size,line-height,weight,stretch,tracking}`
  (`caption footnote label body body-strong prose lead title3 title2 title1 display hero numeral
numeral-xl`); sizes switch to the mobile web scale under 640 px.
- `--k-space-<step>` (0-32 on the 4-pt grid), `--k-radius-{xs,sm,md,lg,full}`,
  `--k-motion-{press,state,enter,draw}` (0 ms under `prefers-reduced-motion`),
  `--k-ease-{standard,exit}`, `--k-motion-stagger`, `--k-layout-{max-width,gutter,page-gutter,nav-height}`,
  `--k-measure-prose`.

### `theme/tokens.ts`

`colors` (`Record<ColorScheme, ColorRoles>`), `fixedColorRoles`, `overlays`, `palette`,
`nativeFontFiles`, `typeScale` (native scale: `caption footnote label body bodyStrong title3
title2 title1 display numeral score bib numeralXL`, each with `fontFamily`, `fontSize`,
`lineHeight`, `fontWeight`, `letterSpacing` in points, `tabularNums`), `spacing`, `radius`,
`elevation` (native shadow per scheme), `motion`, `layout`, `pitchDiagram`, `state`, `theming`;
types `ColorScheme`, `ColorPreference`, `ColorRole`, `ColorRoles`, `OverlayRole`, `FontRole`,
`FontWeight`, `NativeFontName`, `TypeVariant`, `TextStyleToken`, `ShadowToken`. No CSS, no
runtime dependency.

## Colour roles

Both schemes define the same 29 roles. Values come from `color.palette` only (the validator
rejects a hex that is not in the palette).

| Role            | Light     | Dark      | Use                                                                |
| --------------- | --------- | --------- | ------------------------------------------------------------------ |
| `background`    | `#F5F6F1` | `#0C1611` | Page and screen ground (chalk / night).                            |
| `surface`       | `#FFFFFF` | `#142019` | Cards, list groups, sheets.                                        |
| `surfaceSunken` | `#EBEEE6` | `#08100C` | Wells: download band, input background, quiet sections.            |
| `surfaceRaised` | `#FFFFFF` | `#1B2A21` | Floating layer. Light lifts it with `level2`; dark with this step. |
| `fillMuted`     | `#E1E6DC` | `#24352B` | Chips at rest, locked controls, skeleton blocks.                   |
| `border`        | `#D3D9D0` | `#2A3A30` | Hairlines (decorative, no contrast requirement).                   |
| `borderStrong`  | `#6F7D75` | `#6A7A71` | Input and control outlines (3:1).                                  |
| `text`          | `#0F1A14` | `#F5F6F1` | Body and headings.                                                 |
| `textMuted`     | `#4E5E55` | `#A6B3AA` | Meta lines, captions, inactive tabs.                               |
| `inverse`       | `#0F1A14` | `#F5F6F1` | Selected chip, toast.                                              |
| `onInverse`     | `#F5F6F1` | `#0C1611` | Text on `inverse`.                                                 |
| `primary`       | `#1B7F4B` | `#3DBF78` | Primary button fill, "geliyorum" state.                            |
| `onPrimary`     | `#FFFFFF` | `#0F1A14` | Label on `primary`.                                                |
| `primaryText`   | `#17704A` | `#3DBF78` | Green as text: active tab (light), verified badge.                 |
| `link`          | `#17704A` | `#3DBF78` | Links.                                                             |
| `focusRing`     | `#17704A` | `#F5F6F1` | 2 px focus ring with 2 px offset.                                  |
| `accent`        | `#E35A14` | `#FF6B1A` | The one orange action per viewport.                                |
| `onAccent`      | `#0F1A14` | `#0F1A14` | Label on `accent`.                                                 |
| `accentText`    | `#0F1A14` | `#FF7A33` | Orange as text exists on dark only; on light it resolves to ink.   |
| `warning`       | `#F2C230` | `#F2C230` | "Belki" state and the `ÖRNEK` tag (a fill, never text).            |
| `onWarning`     | `#0F1A14` | `#0F1A14` | Label on `warning`.                                                |
| `danger`        | `#D7263D` | `#FF5C6E` | "Gelmiyorum" state, destructive button fill.                       |
| `onDanger`      | `#FFFFFF` | `#0F1A14` | Label on `danger`.                                                 |
| `dangerText`    | `#C41E34` | `#FF5C6E` | Error text under a field.                                          |
| `pitch`         | `#0E5B36` | `#0E5B36` | Turf of the pitch diagram (fixed: same in both schemes).           |
| `pitchLine`     | `#F5F6F1` | `#F5F6F1` | Chalk lines, empty-slot dashes (fixed).                            |
| `onPitch`       | `#FFFFFF` | `#FFFFFF` | Labels on the turf (fixed).                                        |
| `pitchMarker`   | `#F5F6F1` | `#F5F6F1` | Player marker disc (fixed).                                        |
| `onPitchMarker` | `#0F1A14` | `#0F1A14` | Kit number on the marker (fixed).                                  |

The dark scheme is designed, not inverted: the primary and danger fills become the bright tints
with ink labels (the deep green fill reaches only 2.99:1 against raised night surfaces), the
focus ring turns chalk, and depth comes from the `surfaceRaised` step instead of shadows.
Overlays (`color.overlay`): `pressed` (8 % ink on light, 10 % chalk on dark) and `scrim`.

**Always dark:** the pitch roles are fixed. The diagram is night turf with chalk lines in both
schemes. On light it reads as an object on chalk (turf against `background` 7.53:1); on dark its
edge is the chalk touchline (16.98:1 against `background`), because turf against night is only
2.26:1. Nothing else is forced dark.

## Contrast

`scripts/validate-tokens.mjs` checks every pair in `contrast.pairs` at 4.5:1 and every pair in
`contrast.nonTextPairs` at 3:1 in **both** schemes (`scheme: "both"` expands to light and dark),
and fails when a role that carries meaning is not covered in either scheme. Lowest values today:
text 4.87 (light `onAccent` on `accent`) and 5.01 (dark `dangerText` on `surfaceRaised`);
non-text 3.12 (light `accent` on `surfaceSunken`) and 3.31 (dark `borderStrong` on
`surfaceRaised`). State fills (`warning`, `danger` in a segmented control) always carry their
label; the control outline is `borderStrong`.

## Scheme switching

Preferences are `system` (default), `light` and `dark` (`theming` in the token file).

**Web.** `theme.css` puts the light values on `:root` and `[data-theme='light']`, the dark values
on `[data-theme='dark']`, and repeats the dark values inside `@media (prefers-color-scheme: dark)`
for `:root:not([data-theme])` and `[data-theme='system']`. Each block sets `color-scheme`, so
form controls and scrollbars follow. The root layout reads the `kadro-theme` cookie on the server
(every HTML surface already renders per request for the CSP nonce, ADR-0055) and renders
`<html data-theme="light|dark|system">`; without a cookie it renders `system`. The first paint is
right in every case and no inline script is involved. The toggle (Sistem / Açık / Koyu) is a form
posting to a same-origin route handler that sets the cookie (`Path=/`, `SameSite=Lax`, `Secure`,
365 days) and redirects back; a bundled client component may switch `data-theme` at once before
the round trip. `<meta name="color-scheme" content="light dark">` and one `theme-color` per
scheme (`theming.web.themeColor`, with `media`) complete it. Any element may carry `data-theme`
to force a scheme for its subtree.

**Mobile.** `theme/tokens.ts` exports `colors.light` and `colors.dark`. The provider resolves the
preference stored under `theming.storageKey` (AsyncStorage) against `useColorScheme()`: `system`
follows the device, `light` and `dark` pin the scheme. Ayarlar offers the three choices with
`theming.labels` (Sistem, Açık, Koyu). The pitch roles do not change with the scheme.

## Type

One family, Archivo (SIL OFL 1.1), at two widths: `wdth 75` for display and numerals (weight
700-800) and `wdth 100` for body (400-600). Numerals use tabular figures.

- **Web:** copy `fonts/archivo/web/*.woff2` into `apps/web/public/fonts/` and declare one
  `@font-face` per subset with `font-family: 'Archivo'`, `font-weight: 400 800`,
  `font-stretch: 75% 100%`, `font-display: swap` and the `unicodeRange` of
  `typography.fontFiles.web.subsets`; preload only the latin file. The latin file also carries
  Ğ ğ İ Ş ş and ₺, so a Turkish page needs one file (55 KB); both together are 106 KB. Select the
  width with `font-stretch: var(--k-type-<variant>-stretch)`, not `font-variation-settings`.
- **Native:** load the five static instances with `expo-font`, keyed by the names of
  `nativeFontFiles` (`Archivo-Regular`, `Archivo-Medium`, `Archivo-SemiBold`,
  `ArchivoCondensed-Bold`, `ArchivoCondensed-ExtraBold`). Each `typeScale` entry names its instance
  in `fontFamily`; pass that family without `fontWeight`, or Android may synthesise a bold. Add
  `fontVariant: ['tabular-nums']` when `tabularNums` is true.
- **Card images (`next/og`):** use the static TTF instances; the renderer cannot read variable
  fonts.

`fonts/archivo/Archivo-Variable.ttf` is the unmodified upstream file (`Archivo[wdth,wght].ttf`,
version 2.001, google/fonts). Every other Archivo file is cut from it with fontTools
(`varLib.instancer`, `subset`): the web subsets keep the axes `wdth 75-100` and `wght 400-800`
and the layout features `ccmp locl liga kern mark mkmk case tnum pnum zero rvrn` (the default
figures are lining, so `lnum` has nothing to do); the static instances are pinned to the listed
`wdth`/`wght`, subset to latin and latin-ext, with the PostScript name set to the file name.
Archivo has no Reserved Font Name, so the cut files keep the name.

## Logo

`kadro-wordmark.svg` (ink, for light grounds), `kadro-wordmark-light.svg` (chalk, for dark
grounds) and `kadro-wordmark-mono.svg`: `KADR` in Archivo `wdth 75` weight 800 as outlines,
kerned as the font sets them, and the `O` as the pitch centre circle (stroke equal to the stem,
optical overshoot of the font's `O`) with the orange ball spot. View box 3152 × 861 (3.66:1); a fixed image box must keep that ratio (`next/og` stretches an image to its
box), for example 234 × 64.
`kadro-mark.svg`, `kadro-app-icon.svg`, `kadro-app-icon-rounded.svg` and
`kadro-icon-foreground.svg` are unchanged (Android adaptive icon background `#1B7F4B`).

## Scripts

- `build`: writes `theme/theme.css` and `theme/tokens.ts`, then runs the validator.
- `test`: fails on stale built files, then validates: palette identity hues; both schemes with the
  same roles, all from the palette; fixed roles equal; every contrast pair in both schemes;
  spacing on the 4-pt grid; radius 4/8/12/20; each type entry backed by a static instance of the
  right width and weight; every font readable with the Turkish glyphs (U+011E U+011F U+0130
  U+0131 U+015E U+015F U+00C7 U+00E7 U+00D6 U+00F6 U+00DC U+00FC U+20BA), `tnum` and `locl`, the
  expected axes, static instances without `fvar`, the 110 KB web budget; logos well formed, with
  no external content and palette colours only. The frozen v1 file is checked as before.
- `typecheck`: `tsc` over `theme/tokens.ts`. `lint`: ESLint.

## v1 compatibility (temporary)

`tokens.json` (v1 palette, Sora and Inter families) and `fonts/sora/`, `fonts/inter/` stay
unchanged so the apps keep building. Readers that move to v3:

| Reader                                                                                          | v1 names in use                                                                                                                                                                                 | v3 replacement                                                                        |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/web/components/marketing/theme.ts`                                                        | `MARKETING_THEME` (light `background surface text textMuted primary onPrimary accent onAccent link`), `MARKETING_TEXT_PAIRS`, `MARKETING_NON_TEXT_PAIRS`, `marketingThemeVariables()` (`--m-*`) | `theme.css` `--k-color-*` in both schemes                                             |
| `apps/web/lib/client/theme.ts`                                                                  | `THEME`, `TEXT_PAIRS`, `NON_TEXT_PAIRS`, `themeVariables()` (`--k-<role>`)                                                                                                                      | `theme.css` `--k-color-*`                                                             |
| `apps/web/app/layout.tsx`                                                                       | literal `#F4F6F0`, `#0E1A14`; `themeColor` `#1B7F4B`                                                                                                                                            | `data-theme` from the cookie; `theming.web.themeColor`                                |
| `apps/web/components/marketing/fonts.css`, `fonts.ts`                                           | Sora and Inter WOFF2 in `public/fonts`                                                                                                                                                          | Archivo subsets                                                                       |
| `apps/web/tests/marketing/marketing.test.ts`, `apps/web/tests/pages/redirects-and-a11y.test.ts` | `tokens.json` `color.theme.light.*`, `contrast.minimumRatio`                                                                                                                                    | `theme/tokens.json`, both schemes                                                     |
| `apps/web/components/marketing/og-image.tsx`, `apps/web/tests/seo/faq-og.test.ts`               | `OG_PALETTE` from v1 `color.palette` (`nightMatch chalkWhite pitchGreen orangeBall neutralOnDark`); wordmark box 304 × 64 sized for the old 4.75:1 view box; Sora and Inter instances           | v3 palette; 234 × 64 for the new wordmark; Archivo static instances                   |
| `apps/mobile/src/theme/tokens.ts`                                                               | `color.theme`, `typography.fontFamily`, `typography.scale`, `spacing`, `radius`                                                                                                                 | `colors`, `typeScale`, `spacing`, `radius` of `theme/tokens.ts`                       |
| `apps/mobile/src/theme/fonts.ts`                                                                | `fonts/inter/Inter-VariableFont.ttf`, `fonts/sora/Sora-VariableFont_wght.ttf`                                                                                                                   | `nativeFontFiles`                                                                     |
| `apps/mobile/src/theme/theme.ts`, `navigation.ts`                                               | derived `border`, `pressed`, `skeleton`, `errorText`; active tab `primary` / `text`                                                                                                             | roles `border`, `fillMuted`, `dangerText`, `overlays.pressed`; `primaryText` / `text` |
| `apps/mobile/tests/theme.test.tsx`                                                              | `tokens.json` `color.theme.*`, `spacing`; families `Inter`, `Sora`                                                                                                                              | `theme/tokens.ts`                                                                     |

When no reader is left, the brand owner deletes `tokens.json`, `fonts/sora/`, `fonts/inter/` and
the v1 section of `validate-tokens.mjs`.
