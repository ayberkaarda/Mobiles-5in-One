# Askıda brand

Single source of truth for the Askıda identity (spec section 2): design tokens, logo files and bundled fonts. The Flutter app (`app/lib/design/theme.dart`) and the Tailwind config for the Blade web are built from `tokens.json`. Those files belong to the app and web owners; this folder only defines the contract.

Check everything with:

```sh
node askida/brand/scripts/validate-tokens.mjs
```

The script is Node only (no dependencies). It fails (exit 1) when a core colour drifts from the spec, a scheme colour is not declared in the palette, light and dark role names differ, any listed pair misses WCAG AA (4.5:1 text, 3:1 non-text) in either scheme, a documented "not for text" pair turns out to pass, a type style uses a weight that is not shipped, spacing leaves the 4-pt grid, a font file lacks `çğıİöşüÇĞÖŞÜ₺`, or a logo/PNG file is missing or malformed.

## Contents

| Path                                                  | What                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `tokens.json`                                         | palette, light + dark schemes, contrast pairs, type scale, spacing, radius, elevation, motion |
| `scripts/validate-tokens.mjs`                         | validator described above                                                                     |
| `fonts/fraunces/Fraunces-{SemiBold,Bold}.ttf`         | display face, weights 600 and 700, with `OFL.txt`                                             |
| `fonts/nunito-sans/NunitoSans-{Regular,SemiBold}.ttf` | body face, weights 400 and 600, with `OFL.txt`                                                |
| `logo/*.svg`                                          | mark, wordmarks, app icon, Android adaptive layers, favicon                                   |
| `logo/png/*-1024.png`                                 | 1024 px renders of the app icon and the adaptive layers (input for launcher-icon tools)       |

## Colour

The seven spec colours are the core palette (`derived: false`). Every other value in `color.palette` is marked `derived: true` and says what it is for. Scheme roles reference palette values only.

### Roles (same names in both schemes)

| Role                        | Light                              | Dark                  | Use                                            |
| --------------------------- | ---------------------------------- | --------------------- | ---------------------------------------------- |
| `background`                | `#FBF8F3` Un Beyazı                | `#1C1814` Hearth      | page                                           |
| `surface`                   | `#FFFDFA`                          | `#25201B`             | cards, sheets                                  |
| `surfaceRaised`             | `#FFFFFF`                          | `#2F2822`             | menus, dialogs                                 |
| `surfaceSunken`             | `#F3ECE1`                          | `#171310`             | inputs, wells                                  |
| `text`                      | `#2B2B2B` Kömür                    | `#F3EBE0`             | body text                                      |
| `textMuted`                 | `#6B5E52`                          | `#BFB2A3`             | secondary text (still AA on every surface)     |
| `border`                    | `#E4D8C8`                          | `#3A322A`             | decorative dividers only (no contrast promise) |
| `borderStrong`              | `#8C7B6B`                          | `#8A7A6B`             | input and control outlines (3:1)               |
| `primary` / `onPrimary`     | `#C8763A` Ekmek Kabuğu / `#1E1915` | same                  | primary button fill and its label              |
| `primaryText`               | `#9A5524`                          | `#E3A06A`             | links and brand-coloured text on surfaces      |
| `secondary` / `onSecondary` | `#4E6B3A` Zeytin / `#FFFFFF`       | same                  | secondary fills                                |
| `accent` / `onAccent`       | `#E9A23B` Gün Batımı / `#1E1915`   | same                  | highlights, badges, counters                   |
| `info`                      | `#2C6E91` Deniz                    | `#6FB0D4`             | informational text and icons                   |
| `danger` / `onDanger`       | `#B23A48` Nar / `#FFFFFF`          | same                  | destructive fills                              |
| `dangerText`                | `#B23A48`                          | `#F08A95`             | error messages                                 |
| `success`                   | `#4E6B3A`                          | `#9CBF7F`             | success text and icons                         |
| `warning`                   | `#8F5B12`                          | `#E9A23B`             | warning text and icons                         |
| `focusRing`                 | `#2C6E91`                          | `#E9A23B`             | 2 px focus outline                             |
| `overlay`                   | `#2B2B2B80`                        | `#0E0B09B3`           | modal scrim (8-digit hex, alpha last)          |
| `paper` / `onPaper`         | `#F2E4CC` / `#2B2B2B`              | `#EADBC2` / `#2B2B2B` | craft material: askı ticket, receipt card      |
| `wood` / `onWood`           | `#6B4329` / `#FBF8F3`              | `#5A3A24` / `#F3EBE0` | craft material: shop name plate                |

Dark is a warm charcoal-brown (Hearth), not blue-black. The askı ticket keeps its cream `paper` in dark mode on purpose.

### Contrast notes

Measured by the validator (WCAG 2.x relative luminance). Lowest passing values: light text 4.78 (`info` on `surfaceSunken`), dark text 5.07 (`onPrimary` on `primary`), light non-text 3.25 (`primary` on `background`), dark non-text 3.51 (`borderStrong` on `surfaceRaised`).

Not valid for text (also listed in `color.notValidForText` and checked to really fail):

- White on Ekmek Kabuğu (3.44) and Kömür on Ekmek Kabuğu (4.12). Primary buttons use `onPrimary` (`#1E1915`, 5.07).
- Ekmek Kabuğu on Un Beyazı (3.25): logo, icons and large graphics only. Brand-coloured text uses `primaryText`.
- Gün Batımı on Un Beyazı (2.04): accent fills only on light. Warning text uses `warning`.
- Zeytin on the dark background (2.93): in dark mode Zeytin is a fill with `onSecondary` text, and success text uses `success`.

Textures (paper grain, wood) go only on headers, hero, ticket and plate components. Body text and forms stay on plain `background` / `surface`.

## Type

| Style        | Family      | Size / line | Weight                                                      |
| ------------ | ----------- | ----------- | ----------------------------------------------------------- |
| `display`    | Fraunces    | 40 / 48     | 700                                                         |
| `headline`   | Fraunces    | 32 / 40     | 700                                                         |
| `title1`     | Fraunces    | 26 / 32     | 600                                                         |
| `title2`     | Fraunces    | 22 / 28     | 600                                                         |
| `title3`     | Fraunces    | 18 / 24     | 600                                                         |
| `bodyLarge`  | Nunito Sans | 18 / 28     | 400                                                         |
| `body`       | Nunito Sans | 16 / 24     | 400                                                         |
| `bodyStrong` | Nunito Sans | 16 / 24     | 600                                                         |
| `label`      | Nunito Sans | 14 / 20     | 600                                                         |
| `footnote`   | Nunito Sans | 13 / 18     | 400                                                         |
| `caption`    | Nunito Sans | 12 / 16     | 600                                                         |
| `code`       | Nunito Sans | 28 / 36     | 600, letter spacing 3, tabular figures (one-time askı code) |

Rules: Fraunces only for headings and the wordmark, never for body copy, forms or numbers in tables. Only the four shipped weights exist; do not ask for 500 or synthetic bold. Sizes scale with the OS text size setting.

### Font files

Static instances made with the fontTools instancer from the variable fonts in the google/fonts repository (`ofl/fraunces` at commit `4024282d`, `ofl/nunitosans` at commit `8b0a1d0f`), each with its SIL Open Font License 1.1 (`OFL.txt`; neither licence declares a Reserved Font Name). Axis settings: Fraunces `opsz 24, SOFT 50, WONK 0`; Nunito Sans `wdth 100, opsz 12, YTLC 500`. Family names are `Fraunces` and `Nunito Sans`.

No web subsets (WOFF2) are shipped yet: the TTFs are used as they are. Nothing fetches fonts at runtime.

- Flutter: declare both families in `pubspec.yaml` under `flutter: fonts:` with `weight: 600/700` (Fraunces) and `400/600` (Nunito Sans), pointing at these files (copy or reference them from the app owner's asset folder).
- Web: self-host with `@font-face` (`font-display: swap`) one rule per file; no Google Fonts link.

## Spacing, radius, elevation, motion

- Spacing: 4-pt grid (`0 4 8 12 16 20 24 32 40 48 64`). Radius: `xs 4`, `sm 8`, `md 12`, `lg 16`, `xl 24`, `full`.
- Elevation: light uses warm brown shadows (`#4A2E1A` with alpha); dark mostly uses `surfaceRaised`, shadows are secondary.
- Motion: `fast 120`, `base 200`, `slow 320`, `emphasized 480` ms; easing `standard (0.2, 0, 0, 1)`. With reduced motion, no movement, fades at most 120 ms.

## Consuming the tokens

- Flutter (`app/lib/design/theme.dart`, app owner): map each scheme to a `ColorScheme` (`primary`, `onPrimary`, `secondary`, `onSecondary`, `error` = `danger`, `onError` = `onDanger`, `surface`, `onSurface` = `text`, `outline` = `borderStrong`, `outlineVariant` = `border`, `scrim` = `overlay`) and expose the remaining roles (`primaryText`, `textMuted`, `paper`, `wood`, `info`, `success`, `warning`, `dangerText`, `accent`) through a `ThemeExtension`. Build `TextTheme` from `typography.scale`. Light is the default; dark follows the system setting with a manual override.
- Tailwind (web owner): read `tokens.json` in `tailwind.config` and map `color.scheme.light` / `color.scheme.dark` to CSS custom properties (for example `--color-primary-text`), then point Tailwind colours at the variables so dark mode is a variable swap. `spacing`, `radius` and `typography.scale` map to `theme.extend`.
- Hex values with 8 digits (`overlay`, elevation colours) carry alpha last (`#RRGGBBAA`). Flutter's `Color` wants alpha first, so convert.

## Logo

Concept: a monoline loaf hanging on a cord from a hook; the hook grows out of the tail of the final "a" in the wordmark. The wordmark is "askıda" in Fraunces (600, `opsz 48, SOFT 100`) converted to outlines; the hook and loaf are drawn strokes with round caps. No raster tracing, no external references, no text elements.

| File                                     | Use                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `askida-mark.svg`                        | symbol alone, Ekmek Kabuğu on transparent (works on light and dark backgrounds)                                                                  |
| `askida-wordmark-light.svg`              | for light backgrounds: Kömür letters, Ekmek Kabuğu loaf                                                                                          |
| `askida-wordmark-dark.svg`               | for dark backgrounds: cream letters, Ekmek Kabuğu loaf                                                                                           |
| `askida-wordmark-mono.svg`               | one colour via `currentColor` (inline SVG, or tint it in Flutter)                                                                                |
| `askida-app-icon.svg` + `png/…-1024.png` | store icon: Un Beyazı mark on full-bleed Ekmek Kabuğu; stores apply their own corner mask                                                        |
| `askida-adaptive-foreground.svg` + png   | Android adaptive foreground (108 dp canvas, content inside the 66 dp safe circle); background colour `#C8763A` (`assets.adaptiveIconBackground`) |
| `askida-adaptive-monochrome.svg` + png   | Android 13+ themed icon layer (alpha only)                                                                                                       |
| `askida-favicon.svg`                     | browser tab; simplified mark (no loaf scores, heavier stroke) on a rounded Ekmek Kabuğu tile                                                     |

Usage rules: keep clear space of at least the loaf height around the mark and wordmark; minimum sizes 24 px for the mark, 96 px wide for the wordmark, 16 px for the favicon. Do not recolour outside the palette, stretch, rotate, add effects, or separate the hook from the "a" in the wordmark. Mark on dark backgrounds stays Ekmek Kabuğu (5.13:1 on `#1C1814`).

## Icons

Use one monoline icon family with rounded caps and joins on a 24 px grid with a 2 px stroke (`stroke.icon`); Lucide (ISC licence) fits this and is the chosen set. Bundle the glyphs with the app and web build; no runtime icon fetching.

## Guardrails (design direction)

Western is used as material and typography only: wood plates, paper tickets, hook hardware, serif headings, hill silhouettes. Never weapons, bullets, wanted posters, sheriff stars, bounty or duel metaphors, and no star ratings anywhere near recipients. Tone stays warm and dignified, never charity-poster sentiment: copy says "Askıya bırak", "Askıdan al".
