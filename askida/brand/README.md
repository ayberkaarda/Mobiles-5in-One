# Askıda brand (identity v2)

Single source of truth for the Askıda identity: tokens, fonts, logo, graphic devices, icons and a brand board. The Flutter theme (`app/lib/design/theme.dart`) and the web Tailwind/CSS variables are built from `tokens.json` by their owners; this folder defines the contract. Nothing from the earlier craft direction remains.

```sh
node askida/brand/scripts/validate-tokens.mjs            # exit 0 = valid
node askida/brand/scripts/validate-tokens.mjs --self-test # also proves a broken copy fails
```

## Concept: rail, not hands

A shop rail with prepaid items on it: anyone takes one down, nobody watches. Three objects build the system: the **rail** (a 2 px horizontal line), the **tag** (a flat rounded rectangle with a punched hole: an item, a count or a code) and the **count** (how many tags hang today). Chrome is ink on limewash (light) or cream on ember-black (dark). The only colour is Ekmek Kabuğu on tags, so colour means "something is hanging here". No people, hands, hearts or giving gestures; the rail serves bread, soup, a notebook and a nappy pack equally.

## Colour roles (same names in both schemes)

| Role                        | Light                              | Dark                  | Use                                                                   |
| --------------------------- | ---------------------------------- | --------------------- | --------------------------------------------------------------------- |
| `background`                | `#F4F0E8` Kireç                    | `#171411` Köz         | page and screen ground                                                |
| `surface`                   | `#FBF8F3` Un Beyazı                | `#211D18`             | cards, rows, sheets                                                   |
| `surfaceRaised`             | `#FFFFFF`                          | `#2B2621`             | menus, dialogs, the code tag                                          |
| `surfaceSunken`             | `#EAE4D9`                          | `#100E0B`             | inputs, wells, counter band                                           |
| `text`                      | `#2B2B2B` Kömür                    | `#F3EEE6`             | body, headings, rails                                                 |
| `textMuted`                 | `#5F574E`                          | `#B3A99C`             | meta, captions, inactive segments                                     |
| `border`                    | `#E0D8CB`                          | `#352E27`             | hairlines, card edges (decorative)                                    |
| `borderStrong`              | `#827767`                          | `#8C8176`             | input and control outlines (3:1)                                      |
| `primary` / `onPrimary`     | `#2B2B2B` / `#FBF8F3`              | `#F3EEE6` / `#171411` | primary (ink) button, selected segment, QR ink                        |
| `primaryText`               | `#2B2B2B`                          | `#F3EEE6`             | links (always underlined), text buttons                               |
| `secondary` / `onSecondary` | `#E4DAC9` Kum / `#2B2B2B`          | `#352E27` / `#F3EEE6` | quiet fill: secondary button, chips, segment track                    |
| `accent` / `onAccent`       | `#C8763A` Ekmek Kabuğu / `#1C1814` | `#C8763A` / `#171411` | tags, count badge, app icon, rail counter; never text, never a button |
| `accentText`                | `#99521F`                          | `#E6A26C`             | the only brand-coloured text ("12 askıda")                            |
| `info`                      | `#25607F`                          | `#6FB0D4`             | informational text and icons                                          |
| `success`                   | `#4E6B3A` Zeytin                   | `#9CBF7F`             | "Kod onaylandı", verified check                                       |
| `warning`                   | `#875610`                          | `#E9A23B` Gün Batımı  | warning text; the `ÖRNEK` chip is `secondary` + `warning`             |
| `danger` / `onDanger`       | `#B23A48` Nar / `#FFFFFF`          | `#E36B78` / `#171411` | destructive fill                                                      |
| `dangerText`                | `#AD3444`                          | `#F0919B`             | error text                                                            |
| `focusRing`                 | `#25607F`                          | `#E9A23B`             | 2 px ring, 2 px offset                                                |
| `overlay`                   | `#2B2B2B99`                        | `#000000B3`           | scrim (8-digit hex, alpha last)                                       |

The seven spec colours stay in `color.palette` at their exact values (`derived: false`); every other value is `derived: true` with a `use` note. Deniz (`#2C6E91`) stays in the palette but light `info` uses Deniz Deep, because Deniz is 4.43:1 on the sunken surface.

### Contrast

The validator measures 38 text pairs (every text role on all four surfaces, plus `on*` pairs and text on `secondary`) and 19 non-text pairs per scheme; all pass. Lowest values:

- Light text: `accentText` on `surfaceSunken` 4.63, `success` on `surfaceSunken` 4.76, `warning` on `surfaceSunken` 4.93.
- Light non-text: `accent` on `background` 3.02, on `surface` 3.25, on `surfaceRaised` 3.44.
- Dark text: `onAccent` on `accent` 5.34, `textMuted` on `secondary` 5.77, `onDanger` on `danger` 5.80.
- Dark non-text: `borderStrong` on `surfaceRaised` 3.94, `accent` on `surfaceRaised` 4.36, `borderStrong` on `surface` 4.40.

Documented failures (checked to really fail): `accent` as text on light `background` (3.02); Un Beyazı text on `accent` (3.25); `accent` fill on light `surfaceSunken` (2.72), so in light, accent tags never sit on the sunken surface. `secondary` is a quiet fill with no boundary role and no non-text pair.

## Type: Bricolage Grotesque

One family, two optical sizes, width pinned at 100: **Display** (opsz 96, weights 600 and 700) only at 22 and above; **Text** (opsz 14, weights 400 and 600) for everything smaller. Maximum weight 700, no italics. `tnum` + `lnum` only on `numeral`, `numeralXL` and `code`. Prices as `₺45,00`. Uppercase only as the literal code and `ÖRNEK`: no `text-transform: uppercase`, no `toUpperCase()` on Turkish strings; web root `lang="tr"`, Flutter locale `tr_TR`.

| Style        | App   | Web                  | Cut · weight                              |
| ------------ | ----- | -------------------- | ----------------------------------------- |
| `hero`       | —     | 64/68 (mobile 40/44) | Display 700, −0.01em                      |
| `display`    | 40/44 | 48/52                | Display 700, −0.01em                      |
| `headline`   | 32/36 | 36/40                | Display 700                               |
| `title1`     | 26/30 | 28/34                | Display 600                               |
| `title2`     | 22/28 | 22/28                | Display 600                               |
| `title3`     | 18/24 | 20/28                | Text 600                                  |
| `bodyLarge`  | 18/28 | 20/30                | Text 400                                  |
| `body`       | 16/24 | 16/24                | Text 400                                  |
| `bodyStrong` | 16/24 | 16/24                | Text 600                                  |
| `label`      | 14/20 | 14/20                | Text 600                                  |
| `footnote`   | 13/18 | 13/18                | Text 400                                  |
| `caption`    | 12/16 | 12/16                | Text 600, +0.01em                         |
| `numeral`    | 28/32 | 32/36                | Display 600, tnum lnum                    |
| `numeralXL`  | 56/56 | 96/96                | Display 700, tnum lnum, −0.02em           |
| `code`       | 32/40 | 32/40                | Text 600, tnum lnum, +0.12em, groups of 4 |

- Flutter: declare `BricolageText` (Text-Regular 400, Text-SemiBold 600) and `BricolageDisplay` (Display-SemiBold 600, Display-Bold 700) in `pubspec.yaml`.
- Web: self-host `web/text-var.woff2` (`font-weight: 400 700`, preloaded) and the two Display files with `font-display: swap`; fallback `"BricolageText", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Measured: 53.6 KB above the fold, 115.9 KB for all three web files. No Google Fonts link, no second family.

## Shape, elevation, motion

- Radius: tags and chips 6, buttons and inputs 10, cards and rows 14, sheets and dialogs 20, avatars (merchant only) full.
- Stroke: rails 2 px `text`; icons 1.75 px at 24, round caps and joins; card edge 1 px `border`; tag holes are evenodd cutouts, never drawn circles.
- Elevation: flat. Only bottom sheets and dialogs get one shadow (`0 8px 24px`, ink 16 % light / black 50 % dark). No gradients, textures, glows, blur or translucency.
- Grid: 4 pt (`0 4 8 12 16 24 32 48 64 96`), screen gutter 16, row min height 56, touch target 48; web 12 columns, 1120 max, 24 gutters.
- Motion: `fast 120`, `base 200`, `enter 320`, `settle 480` ms; easing `(0.22, 1, 0.36, 1)` in and `(0.4, 0, 1, 1)` out; only transform and opacity. A new tag drops onto the rail; the code tag settles once with a ±3° swing about its hole. Reduced motion: durations 0, fades at most 120 ms.

## Logo

The mark is the rail tag on a 24 grid: rail y 4, x 3→21, stroke 2, round caps; tie (12, 4)→(12, 8); tag x 6→18, y 8→21, radius 3, hole r 1.5 at (12, 11.5) cut out (evenodd). The wordmark is `askıda` in Bricolage Display 600, lowercase, outlined. Horizontal lockup: mark, a gap of one tag width, wordmark, with the mark's height on the x-height and its foot on the baseline; vertical lockup: mark centred above. Clear space one tag width; minimum sizes: mark 20 px, wordmark 80 px wide, horizontal lockup 112 px, favicon 16 px. The mark is ink on UI surfaces (cream on dark); the tag fills `accent` only in the app icon and the rail counter. Never stretch, rotate or recolour outside the palette.

## Graphic devices

Only three: the **rail counter** (a rail with N accent tags, N capped at 12, then one `secondary` overflow tag; the app writes `+n` and the sentence "Bugün 14 çorba askıda" with the number in `numeralXL`), the **station rail** (Bırak → Askıda → Al, three tags on one rail; labels rendered by the app or page) and the **tag template** (blank tag; the only SVG allowed to carry `<text>`). Light and dark files have the scheme colours baked in. On light, the rail counter sits on `surface`, never on `surfaceSunken`. Counts are always of items, never of people; no targets, bars or percentages.

## Icons

UI icons follow Lucide (ISC) at 24 px, stroke 1.75, `currentColor`. This folder ships the kept UI icons plus the brand pictograms: `rail`, `tag`, `tag-plus` and the six item categories `ekmek corba yemek kirtasiye bebek diger`. Pictograms never show people. Bundle icons with the build; no CDN.

## Guardrails (enforced where a machine can)

1. Draw rails, tags and counts; never people, hands, hearts, faces, loaves alone or giving gestures (validator: file names and SVG ids containing hand, heart or person fail).
2. `accent` only on tags, the rail counter and the app icon; never a button, band, background or text (validator: accent absent from button, surface and text roles; `notValidForFill` pair checked).
3. One primary (ink or cream) button per screen; no outlined buttons, no second filled colour.
4. Uppercase only as the literal code and `ÖRNEK` (validator: no uppercase transform in shipped SVG/HTML/CSS).
5. Flat surfaces (validator: no gradients, filters, backdrop filters, patterns, masks, `feTurbulence`).
6. Count items, never people; never "muhtaç", "fakir", "yoksul", "yardıma muhtaç", "ihtiyaç sahibi".
7. Only the Bricolage Grotesque files listed here (validator: files, cmap incl. U+20BA, `tnum`/`lnum`, `TRK`, web size budget).
8. Hand-written, palette-only SVG: no `<image>`, external `href`, script, style, comment or metadata; icons `currentColor` at 1.75; tag holes evenodd (validator).

## Files

Every file in this folder; the validator fails if this table and the disk differ.

| Path                                                                | What                                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                         | this contract                                                                                                                            |
| `board/askida-board-dark.png`                                       | board render, dark, 1920x1080                                                                                                            |
| `board/askida-board-light.png`                                      | board render, light, 1920x1080                                                                                                           |
| `board/board.html`                                                  | brand board page (local files only; `#dark` for the dark scheme)                                                                         |
| `devices/askida-rail-counter-dark.svg`                              | rail counter, dark                                                                                                                       |
| `devices/askida-rail-counter-light.svg`                             | rail counter (12 accent tags + overflow tag), light                                                                                      |
| `devices/askida-station-rail-dark.svg`                              | station rail, dark                                                                                                                       |
| `devices/askida-station-rail-light.svg`                             | station rail Bırak → Askıda → Al, light                                                                                                  |
| `devices/askida-tag-dark.svg`                                       | blank tag template, dark                                                                                                                 |
| `devices/askida-tag-light.svg`                                      | blank tag template with `<text>` placeholders, light                                                                                     |
| `fonts/bricolage-grotesque/BricolageGrotesque-Display-Bold.ttf`     | Flutter `BricolageDisplay` 700 (opsz 96)                                                                                                 |
| `fonts/bricolage-grotesque/BricolageGrotesque-Display-SemiBold.ttf` | Flutter `BricolageDisplay` 600 (opsz 96)                                                                                                 |
| `fonts/bricolage-grotesque/BricolageGrotesque-Text-Regular.ttf`     | Flutter `BricolageText` 400 (opsz 14)                                                                                                    |
| `fonts/bricolage-grotesque/BricolageGrotesque-Text-SemiBold.ttf`    | Flutter `BricolageText` 600 (opsz 14)                                                                                                    |
| `fonts/bricolage-grotesque/BricolageGrotesque[opsz,wdth,wght].ttf`  | unmodified variable source                                                                                                               |
| `fonts/bricolage-grotesque/OFL.txt`                                 | SIL Open Font License 1.1                                                                                                                |
| `fonts/bricolage-grotesque/README.md`                               | font provenance (google/fonts commit) and instancing settings                                                                            |
| `fonts/bricolage-grotesque/web/display-600.woff2`                   | web Display 600, on demand                                                                                                               |
| `fonts/bricolage-grotesque/web/display-700.woff2`                   | web Display 700, on demand                                                                                                               |
| `fonts/bricolage-grotesque/web/text-var.woff2`                      | web Text cut, wght 400–700, preloaded                                                                                                    |
| `icons/bebek.svg`                                                   | category: bebek                                                                                                                          |
| `icons/bell.svg`                                                    | UI: notifications                                                                                                                        |
| `icons/close.svg`                                                   | UI: close                                                                                                                                |
| `icons/code.svg`                                                    | UI: code                                                                                                                                 |
| `icons/corba.svg`                                                   | category: çorba                                                                                                                          |
| `icons/diger.svg`                                                   | category: diğer                                                                                                                          |
| `icons/ekmek.svg`                                                   | category: ekmek                                                                                                                          |
| `icons/kirtasiye.svg`                                               | category: kırtasiye                                                                                                                      |
| `icons/location.svg`                                                | UI: location                                                                                                                             |
| `icons/qr.svg`                                                      | UI: QR                                                                                                                                   |
| `icons/rail.svg`                                                    | pictogram: rail                                                                                                                          |
| `icons/settings.svg`                                                | UI: settings                                                                                                                             |
| `icons/shop.svg`                                                    | UI: shop                                                                                                                                 |
| `icons/tag-plus.svg`                                                | pictogram: put a tag on the rail (replaces the old open-hand icon)                                                                       |
| `icons/tag.svg`                                                     | pictogram: tag                                                                                                                           |
| `icons/yemek.svg`                                                   | category: yemek                                                                                                                          |
| `logo/askida-adaptive-foreground.svg`                               | Android adaptive foreground, 108 dp canvas, inside the 66 dp circle; background `#C8763A`                                                |
| `logo/askida-adaptive-monochrome.svg`                               | Android 13 themed layer (alpha only)                                                                                                     |
| `logo/askida-app-icon.svg`                                          | store icon: Un Beyazı mark on full-bleed Ekmek Kabuğu                                                                                    |
| `logo/askida-favicon-32.svg`                                        | favicon 32 px: adds the rail                                                                                                             |
| `logo/askida-favicon.svg`                                           | favicon 16 px: accent tile, tag only, hole kept                                                                                          |
| `logo/askida-mark.svg`                                              | rail tag mark, ink (`text`); recolour to cream on dark                                                                                   |
| `logo/askida-wordmark-dark.svg`                                     | wordmark, cream, for dark surfaces                                                                                                       |
| `logo/askida-wordmark-light.svg`                                    | wordmark `askıda`, ink, for light surfaces                                                                                               |
| `logo/askida-wordmark-mono.svg`                                     | wordmark in `currentColor`                                                                                                               |
| `logo/png/askida-adaptive-foreground-1024.png`                      | 1024 px render of the adaptive foreground                                                                                                |
| `logo/png/askida-adaptive-monochrome-1024.png`                      | 1024 px render of the monochrome layer                                                                                                   |
| `logo/png/askida-app-icon-1024.png`                                 | 1024 px render of the app icon                                                                                                           |
| `scripts/validate-tokens.mjs`                                       | validator (Node only); `--self-test` plants defects in a temp copy and expects exit 1                                                    |
| `tokens.json`                                                       | v2 tokens: palette, light + dark roles, contrast pairs and documented failures, type, spacing, layout, radius, stroke, elevation, motion |
