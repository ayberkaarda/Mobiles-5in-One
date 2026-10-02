# @kadro/brand

Single source of truth for the Kadro identity: design tokens, logo SVGs and font files. Consumed by `apps/mobile` (StyleSheet/NativeWind theme, `expo-font`) and `apps/web` (Tailwind config, self-hosted fonts).

## Contents

- `tokens.json` - palette, light/dark semantic themes, typography scale, 4-pt spacing, radii (8/12/20), and the list of text/background pairs that must meet WCAG AA (4.5:1).
- `logo/` - `kadro-wordmark.svg` (dark text), `kadro-wordmark-light.svg` (for dark surfaces), `kadro-wordmark-mono.svg`, `kadro-mark.svg` (centre circle only), `kadro-app-icon.svg` (full-bleed, for stores), `kadro-app-icon-rounded.svg`, `kadro-icon-foreground.svg` (transparent, Android adaptive icon foreground; use `#1B7F4B` as the background colour).
  The wordmark is `KADRO` set in Sora 700 and converted to outlines; the `O` is a pitch centre circle with an Orange Ball centre spot.
- `fonts/sora`, `fonts/inter` - variable TrueType fonts from the Google Fonts repository, each with its SIL OFL 1.1 licence (`OFL.txt`).

## Colour rules

Verified by `pnpm test`: every listed pair is at least 4.5:1. Not valid for text: white on Orange Ball (2.85:1; use Night Match text on accent), and Pitch Green, Neutral or Red Card on Night Match (below 4.5:1; use Chalk White or `neutralOnDark`). `neutralOnDark` (`#A8B5AD`) and the dark `surface` (`#16251D`) are derived tints, not part of the core palette.

## Scripts

`pnpm build | lint | typecheck | test` all run `scripts/validate-tokens.mjs`: palette matches the identity spec, hex values are valid, contrast pairs pass, spacing is on the 4-pt grid, and every logo/font asset exists.

## Usage

```js
import tokens from '@kadro/brand/tokens.json' with { type: 'json' };
```

Fonts: register `fonts/sora/Sora-VariableFont_wght.ttf` and `fonts/inter/Inter-VariableFont.ttf` with `expo-font` on mobile, and via `@font-face` (`font-display: swap`, weight ranges `100 800` and `100 900`) on web.
