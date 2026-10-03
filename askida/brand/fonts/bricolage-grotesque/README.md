# Bricolage Grotesque

Source: `ofl/bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf` and `OFL.txt` from github.com/google/fonts at commit `6ce172f74aa355ea43eb964fa4a91570a4d3064d` (the last commit touching that folder when downloaded). SIL Open Font License 1.1, no Reserved Font Name. The variable file is kept unmodified.

Static instances (fontTools `varLib.instancer`, width pinned at 100):

| File                                      | Family (name table, `pubspec.yaml`) | Axes                        |
| ----------------------------------------- | ----------------------------------- | --------------------------- |
| `BricolageGrotesque-Text-Regular.ttf`     | `BricolageText` 400                 | opsz 14, wdth 100, wght 400 |
| `BricolageGrotesque-Text-SemiBold.ttf`    | `BricolageText` 600                 | opsz 14, wdth 100, wght 600 |
| `BricolageGrotesque-Display-SemiBold.ttf` | `BricolageDisplay` 600              | opsz 96, wdth 100, wght 600 |
| `BricolageGrotesque-Display-Bold.ttf`     | `BricolageDisplay` 700              | opsz 96, wdth 100, wght 700 |

Web files in `web/` (fontTools subsetter, WOFF2 with brotli, all layout features kept, subset to the Google Fonts latin and latin-ext ranges plus U+20BA):

| File                | Axes                                       | Use                                            |
| ------------------- | ------------------------------------------ | ---------------------------------------------- |
| `text-var.woff2`    | opsz 14, wdth 100, wght 400–700 (variable) | preloaded, the only file needed above the fold |
| `display-600.woff2` | opsz 96, wdth 100, wght 600                | loaded on demand, `font-display: swap`         |
| `display-700.woff2` | opsz 96, wdth 100, wght 700                | loaded on demand, `font-display: swap`         |

Every file keeps `Ç Ğ İ Ö Ş Ü ç ğ ı ö ş ü ₺`, the `tnum` and `lnum` features and the `TRK` language system (checked by `scripts/validate-tokens.mjs`).
