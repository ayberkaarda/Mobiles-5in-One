# Çetele brand

Source of truth for the Çetele identity (spec section 2): colours, type, shape, motion, logo files and fonts. `tokens.json` feeds the Compose theme (`core/designsystem`, Material 3 colour scheme, typography, shapes) and, from Phase 5, the Thymeleaf CSS variables. Check everything with:

```sh
node cetele/brand/scripts/validate-tokens.mjs              # exit 0 = valid, exit 1 lists every failure
node cetele/brand/scripts/validate-tokens.mjs --self-test  # also proves a broken copy is rejected
```

Node 22, no dependencies.

## Concept

A tally stick on ledger paper. The mark is a large `Ç`: an open ring for the C, four vertical tally notches in its counter, and a fifth, diagonal notch below it that is the cedilla. The cedilla has the weight of the notches (it is the fifth one); the ring is heavier. Defter Lacivert ink on Kâğıt; Çentik Turuncu ("notch orange") marks the one action that matters on a screen and the cedilla in the mark and wordmark.

## Colour roles (same names in `light` and `dark`)

Core colours (`derived: false`) are the seven from the spec. Everything else is `derived: true` with a `use` note in `tokens.json`.

| Role                              | Light                           | Dark                                      | Use                                     |
| --------------------------------- | ------------------------------- | ----------------------------------------- | --------------------------------------- |
| `background`                      | Kâğıt Gölge `#F3EEE3`           | Gece `#0E1325`                            | Page behind cards and lists             |
| `surface`                         | **Kâğıt** `#FAF7F0`             | Gece Surface `#151B31`                    | Cards, rows, top bar                    |
| `surfaceRaised`                   | White `#FFFFFF`                 | Gece Raised `#1D2440`                     | Dialogs, sheets, menus                  |
| `surfaceSunken`                   | Kâğıt Sunken `#EAE3D4`          | Gece Sunken `#090D1B`                     | Text fields, the running-total band     |
| `text`                            | **Mürekkep** `#1A1A1A`          | **Kâğıt** `#FAF7F0`                       | All body copy                           |
| `textMuted`                       | Kurşun Koyu `#575D69`           | Gece Muted `#A7AEBF`                      | Secondary lines, timestamps             |
| `border` / `borderStrong`         | `#E0D8C7` / **Kurşun**          | `#2A3250` / **Kurşun**                    | Hairline / control outline              |
| `primary` / `onPrimary`           | **Defter Lacivert** / Kâğıt     | Lacivert Açık `#AFBBEB` / Defter Lacivert | Main buttons, selected nav              |
| `primaryText`                     | Defter Lacivert                 | Lacivert Açık                             | Links, emphasis                         |
| `secondary` / `onSecondary`       | `#E2E5EF` / Defter Lacivert     | `#262E4D` / Kâğıt                         | Quiet fill: chips, selected rows        |
| `accent` / `onAccent`             | **Çentik Turuncu** / Mürekkep   | **Çentik Turuncu** / Mürekkep             | The one CTA per screen ("Borç yaz" FAB) |
| `accentText`                      | Çentik Koyu `#A84716`           | Çentik Açık `#F4A06C`                     | Orange-family text                      |
| `debt` / `onDebt`                 | **Borç Kırmızısı** / White      | Borç Açık `#EB6F60` / Gece                | Debt actions and badges                 |
| `debtText` / `debtMark`           | `#A8301F` / Borç Kırmızısı      | Borç Açık / Borç Açık                     | Debt amounts / non-text indicator       |
| `payment` / `onPayment`           | Ödendi Koyu `#24704A` / White   | Ödendi Açık `#5CC08A` / Gece              | Payment actions and badges              |
| `paymentText` / `paymentMark`     | Ödendi Koyu / **Ödendi Yeşili** | Ödendi Açık / **Ödendi Yeşili**           | Payment amounts / non-text indicator    |
| `error` / `onError` / `errorText` | same values as `debt*`          | same values as `debt*`                    | Validation (there is one red)           |
| `focusRing`                       | Çentik Koyu                     | Çentik Turuncu                            | Focus outline                           |
| `overlay`                         | `#0E132599`                     | `#000000B3`                               | Scrim (`#RRGGBBAA`, alpha last)         |

### Contrast, honestly

Every pair in `contrast.pairs` (text, 4.5:1) and `contrast.nonTextPairs` (non-text, 3:1) is computed by the validator in both schemes; the lowest values are accentText on the light sunken surface (4.59) and Kurşun as a dark-mode outline on the raised surface (3.15). The combinations below fail and are recorded in `contrast.notValidForText` / `notValidForFill` so nobody uses them by accident:

| Scheme | Combination                                                                      | Ratio              | Instead use                                                                 |
| ------ | -------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------- |
| light  | Çentik Turuncu text on Kâğıt                                                     | 2.87               | `accentText`                                                                |
| light  | Kâğıt or white label on Çentik Turuncu                                           | 2.87 / 3.08        | `onAccent` (Mürekkep, 5.66)                                                 |
| light  | Çentik Turuncu as the only indicator on `background`, `surface`, `surfaceSunken` | 2.66 / 2.87 / 2.41 | the CTA is identified by its label; on `surfaceRaised` it passes 3:1 (3.08) |
| light  | Ödendi Yeşili text on Kâğıt                                                      | 3.97               | `paymentText` (Ödendi Koyu)                                                 |
| light  | White label on Ödendi Yeşili                                                     | 4.25               | `payment` fill (Ödendi Koyu, 6.01)                                          |
| light  | Borç Kırmızısı text on the sunken surface                                        | 4.26               | `debtText`                                                                  |
| light  | Kurşun text on the page background                                               | 4.18               | `textMuted` (Kurşun Koyu)                                                   |
| dark   | Ödendi Yeşili text on the dark surface                                           | 4.01               | `paymentText` (Ödendi Açık)                                                 |
| dark   | Kâğıt label on Çentik Turuncu                                                    | 2.87               | `onAccent` (Mürekkep)                                                       |

`secondary` and `border` are quiet fills by design and never the only boundary of a control (`contrast.excludedFromNonText`).

## Type

| Family  | Weights       | Files                                             | Android `res/font`                                            |
| ------- | ------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Manrope | 700           | `fonts/manrope/Manrope-Bold.ttf`                  | `manrope_bold.ttf`                                            |
| Inter   | 400, 500, 600 | `fonts/inter/Inter-{Regular,Medium,SemiBold}.ttf` | `inter_regular.ttf`, `inter_medium.ttf`, `inter_semibold.ttf` |

Scale (`typography.scale`, app sizes in sp, web in px): `display` 32/40, `headline` 26/32, `title` 20/28 (Manrope 700, never below 20); `titleSmall` 18/24, `bodyLarge` 18/28, `body` 16/24, `bodyStrong` 16/24, `label` 16/24, `caption` 14/20 (Inter); `amount` 18/24 Inter 600 and `amountLarge` 36/44 Manrope 700, both with `tnum` so columns of kuruş line up. Body never below 16 sp, nothing below 14 sp (spec section 8). Each style names its Material 3 slot in `m3`. Amounts are written `₺1.250,00` with `Locale("tr", "TR")`; casing (i/İ, ı/I) is left to the platform with the Turkish locale, never done by hand.

## Shape, spacing, elevation, motion

4-pt spacing (`spacing`), 48 dp touch targets, 64 dp rows, 16 dp gutters (`layout`). Radius: chip 8, button and input 12, card 16, sheet and dialog 24; `shape` gives the Material 3 scale (8/12/16/24/28). Flat ledger paper: surface steps plus a 1 dp border; only sheets, dialogs and the FAB cast a shadow (`elevation`). Motion uses the Material 3 standard and emphasized curves, 100-450 ms, transform and opacity only; with animations off every duration is 0.

## Using the tokens on Android

The Compose theme reads the hex values from `tokens.json`. Suggested Material 3 mapping (the extended roles go into an app-level `CeteleColors` composition local):

| Material 3                                        | Token role                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `background`, `onBackground`                      | `background`, `text`                                                       |
| `surface`, `onSurface`, `onSurfaceVariant`        | `surface`, `text`, `textMuted`                                             |
| `surfaceContainerHigh`, `surfaceContainerHighest` | `surfaceRaised`                                                            |
| `surfaceVariant`, `surfaceContainerLowest`        | `surfaceSunken`                                                            |
| `primary`, `onPrimary`                            | `primary`, `onPrimary`                                                     |
| `secondaryContainer`, `onSecondaryContainer`      | `secondary`, `onSecondary`                                                 |
| `tertiary`, `onTertiary`                          | `accent`, `onAccent`                                                       |
| `error`, `onError`                                | `error`, `onError`                                                         |
| `outline`, `outlineVariant`                       | `borderStrong`, `border`                                                   |
| `scrim`                                           | `overlay`                                                                  |
| extended                                          | `debt*`, `payment*`, `accentText`, `primaryText`, `errorText`, `focusRing` |

Adaptive launcher icon: `cetele-adaptive-background.svg` (Defter Lacivert layer), `cetele-adaptive-foreground.svg` (Kâğıt mark, all ink within 32 dp of the centre, inside the 66 dp safe circle) and `cetele-adaptive-monochrome.svg` (themed icons; Android uses only its alpha) convert to vector drawables for `mipmap-anydpi-v26/ic_launcher.xml`. `cetele-app-icon.svg` / `-1024.png` is the full-bleed square for the store listing (the store applies its own mask).

## Logo

| File                        | Use                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `cetele-mark.svg`           | Mark on light surfaces: Defter Lacivert ring and notches, Çentik Turuncu cedilla. Minimum 32 px tall; smaller, use the favicon      |
| `cetele-wordmark-light.svg` | "Çetele" in Manrope 700 as outlined paths, Defter Lacivert with a Çentik Turuncu cedilla, for light surfaces                        |
| `cetele-wordmark-dark.svg`  | Same outlines in Kâğıt with the orange cedilla, for dark surfaces                                                                   |
| `cetele-wordmark-mono.svg`  | Same outlines in `currentColor` (single-colour print, embossing)                                                                    |
| `cetele-app-icon.svg`       | Store icon: Kâğıt strokes on Defter Lacivert (spec section 2)                                                                       |
| `cetele-adaptive-*.svg`     | Android adaptive icon layers on the 108 dp grid                                                                                     |
| `cetele-favicon.svg`        | A separate drawing on a 20-unit grid: 1-unit notches and gaps on whole pixel columns so the four notches stay apart at 20 and 40 px |

Clear space around the mark and wordmark: at least the ring's stroke width on every side. Do not recolour the notches individually, add effects, outlines or shadows, or set the name in a typeface other than the wordmark outlines.

Readability was checked by rendering every file through headless Chrome at 1024 px and reducing to 48 and 20 px: at 48 px the four notches, the ring and the cedilla are distinct on the app icon, the adaptive icon (circle mask) and the mark; at 20 px the large drawing merges the notches into one tone, which is why the 20-grid favicon exists (at a native 20 px its notches resolve).

The 1024 px renders in `logo/png/` were made with headless Chrome and re-encoded with Pillow so they carry only the IHDR, IDAT and IEND chunks (no text, time, colour-profile or physical-size chunks).

## Fonts: source and licence

Both families are SIL Open Font License 1.1 with no Reserved Font Name (`fonts/*/OFL.txt`, copied unmodified). google/fonts ships only variable files for both, so static instances were made with fontTools 4.66.1 `varLib.instancer` (`updateFontNames`), then checked by the validator (static, OS/2 weight, name-table family, Turkish glyphs and ₺, `tnum`, SHA-256 against `tokens.json`).

| Family  | google/fonts source (commit)                                                                | Source SHA-256                                                     | Instances                       |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| Manrope | `ofl/manrope/Manrope[wght].ttf` at `b31870aff700ab7a1d74fa0c6887d95beb9e0037` (2026-09-14)  | `3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6` | wght 700                        |
| Inter   | `ofl/inter/Inter[opsz,wght].ttf` at `0b58fb370093f9a9f4ff785d94405710b79de67c` (2026-03-03) | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` | opsz 14 with wght 400, 500, 600 |

Inter declares no `TRK` language system in GSUB (Manrope does). Nothing in the brand depends on Turkish-specific glyph substitutions; Turkish casing comes from the locale, and the validator records `trk` per file so a font swap that changes this is noticed.

## Files

| File                                           | What                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `README.md`                                    | This guide                                                       |
| `tokens.json`                                  | Colour, contrast, type, spacing, shape, elevation, motion tokens |
| `scripts/validate-tokens.mjs`                  | Validator (node only, exit 1 on any failure, `--self-test`)      |
| `fonts/manrope/Manrope-Bold.ttf`               | Manrope 700 static                                               |
| `fonts/manrope/OFL.txt`                        | Manrope licence                                                  |
| `fonts/inter/Inter-Regular.ttf`                | Inter 400 static (opsz 14)                                       |
| `fonts/inter/Inter-Medium.ttf`                 | Inter 500 static (opsz 14)                                       |
| `fonts/inter/Inter-SemiBold.ttf`               | Inter 600 static (opsz 14)                                       |
| `fonts/inter/OFL.txt`                          | Inter licence                                                    |
| `logo/cetele-mark.svg`                         | Mark, light surfaces                                             |
| `logo/cetele-wordmark-light.svg`               | Wordmark, light surfaces                                         |
| `logo/cetele-wordmark-dark.svg`                | Wordmark, dark surfaces                                          |
| `logo/cetele-wordmark-mono.svg`                | Wordmark, `currentColor`                                         |
| `logo/cetele-app-icon.svg`                     | Store icon, full bleed                                           |
| `logo/cetele-adaptive-foreground.svg`          | Adaptive icon foreground (108 dp)                                |
| `logo/cetele-adaptive-background.svg`          | Adaptive icon background (108 dp)                                |
| `logo/cetele-adaptive-monochrome.svg`          | Adaptive icon monochrome (108 dp)                                |
| `logo/cetele-favicon.svg`                      | Favicon, 20 grid                                                 |
| `logo/png/cetele-mark-1024.png`                | Mark render                                                      |
| `logo/png/cetele-app-icon-1024.png`            | Store icon render                                                |
| `logo/png/cetele-adaptive-foreground-1024.png` | Foreground layer render                                          |
| `logo/png/cetele-adaptive-background-1024.png` | Background layer render                                          |
| `logo/png/cetele-adaptive-monochrome-1024.png` | Monochrome layer render                                          |
