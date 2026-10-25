# Patika brand

Identity decisions (name, tagline, palette, display face, tone, logo idea) come from section 2 of `03-patika-swift-ios.md`. This file records how they are drawn and used.

## Logo

A paw print whose toe pads keep going: after the fourth toe, six dots shrink and climb up and to the right, so the paw turns into a footpath. Drawn on a 120 unit grid.

| File | Use |
| --- | --- |
| `logo/patika-mark.svg` | Mark in Turuncu Tekir, on light surfaces |
| `logo/patika-mark-kaldirim.svg` | Mark in Kaldırım Taşı, single color print |
| `logo/patika-mark-mono.svg` | Mark in `currentColor` |
| `logo/patika-lockup.svg` | Mark and wordmark on light surfaces |
| `logo/patika-lockup-kar.svg` | Mark and wordmark on Kaldırım Taşı |
| `logo/patika-lockup-mono.svg` | Lockup in `currentColor` |

The wordmark is Nunito ExtraBold, lowercase, converted to outlines. The dot of the `i` is a Turuncu Tekir circle, the last stone of the path. Keep clear space around the lockup equal to the height of the `a`. Do not stretch, rotate, outline or recolor the mark outside the token palette.

## App icon

Kar Beyazı mark on a flat Turuncu Tekir field, no gradient or shadow.

- `app-icon/patika-icon.svg`: full 1024 icon (store listing, web).
- `app-icon/patika-icon-background.svg` and `app-icon/patika-icon-foreground.svg`: Android adaptive icon layers. The foreground is drawn full bleed; the app project sets `ForegroundScale="0.6"` to keep it inside the safe zone.
- `app-icon/patika-splash.svg`: splash mark, shown on a Turuncu Tekir background.
- `app-icon/favicon.svg`: web favicon.
- `app-icon/png/`: rendered PNG sizes 48 to 512 (512 is the Play Store icon).

## Tokens

`tokens.json` is the only place colors, type sizes, spacing, radii and motion are defined. After editing it, run from the `patika` folder:

```
dotnet run brand/tools/build-tokens.cs
```

It rewrites `src/Patika.Web/wwwroot/css/tokens.css` (CSS custom properties) and `app/Patika.App/Resources/Styles/Tokens.xaml` (MAUI resources). Do not edit either output by hand.

The spec palette is kept exactly. Darker and lighter companions (`-deep`, `-soft`) were added because Turuncu Tekir, Nane Yeşili and Sis fail WCAG AA as text on Kar Beyazı (2.4:1, 1.9:1, 3.4:1). Rule: the spec colors fill shapes; the `-deep` versions carry text. Body-size links use `boncuk-deep`; small muted text on Kaldırım uses `sis-light`.

## Type

- Display: **Nunito** 700 and 800, for headlines, names, counts and buttons.
- Body: **Nunito Sans** 400, 600 and 700, on both the web and Android. The spec named SF Pro for iOS; the client is now .NET MAUI on Android, where SF Pro cannot be shipped. Nunito Sans is open (SIL OFL 1.1), covers Turkish fully and shares Nunito's proportions without its rounded terminals, so body text stays calm next to the rounder headlines.
- Counts, times and distances use tabular numerals.

Both families are bundled, never loaded from a third party: `src/Patika.Web/wwwroot/fonts/` (woff2, latin and latin-ext subsets) and `app/Patika.App/Resources/Fonts/` (static TTF). Each folder carries the OFL license text.

## Voice

Warm, plural, never guilt-tripping: "Bugün beslendi mi?", "Bir kap su bırak", "Acil yardım gerekiyor". Sample content in any screen is marked `[ÖRNEK]`.
