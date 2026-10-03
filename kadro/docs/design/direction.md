# Kadro design direction

Scope: the marketing site (`apps/web`, marketing and SEO route groups), the mobile app
(`apps/mobile`), the brand package and the Open Graph cards. The admin panel and e-mail templates
only pick up token changes. Routes, navigation labels, copy of the legal pages, API, CSP,
`testID`s and i18n keys do not change. Turkish copy stays Turkish; sample labels (`[ÖRNEK]`,
"Kadro bir portfolyo projesidir.") stay. Token values live in `tokens.json` next to this file.

## 1. Audit: why the current result reads as a generic template

Measured on `docs/screenshots/web/web-01-home.png` (k-means over the pixels, 1440 px wide):
Pitch Green covers 36.5 % of the fold, the chalk background 60.4 %, the orange accent 0.4 %.
The brand colour is used as wallpaper and the accent as a dot. For comparison FotMob's home is
92 % near-white with under 1 % accent, and a two-colour award site (FC Porto Memorial) is 62 / 34.

| Area       | What is there                                                                                                                    | Why it reads as a template                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero       | Flat green band, uppercase eyebrow, two-line title, 5-line paragraph, orange + ghost button, a faint centre circle on the right. | The "coloured band + centred-ish copy + decorative circle" is the default SaaS hero. The circle is a watermark, not content. Lead is 56 words. |
| Card grids | Home: 3 numbered step cards, then 3 feature cards. Features: 10 equal cards. Venue: 3 cards. Invite: 2 cards.                    | Equal white cards with 20 px radius and a hairline are the default structure of every section. Nothing is laid out by its content.             |
| Type scale | Sora 44/32/20 display, Inter 16/18 body. Every title is the same weight and the same width.                                      | Sora + Inter is a common starter pair; nothing in the type says football. No numerals anywhere although the product is counts, times and fees. |
| Colour     | Green as background, green buttons, green links, green footer wordmark; orange only on one CTA.                                  | One hue carries four jobs. The dark "Gece Maçı" surface exists only on the OG card.                                                            |
| Imagery    | None. The OG card draws the centre circle again.                                                                                 | A product about a squad on a pitch shows no squad and no pitch beyond a decorative circle.                                                     |
| Icons      | Numbered green discs on the home page, hand-drawn tab icons in the app, none on the site.                                        | Numbered discs are the "1-2-3" cliché. The tab icons are a one-off set that cannot grow.                                                       |
| Spacing    | 64 px sections, 20 px gaps, 24 px card padding everywhere.                                                                       | Uniform rhythm: the page has no loud and no quiet section.                                                                                     |
| Microcopy  | "Nasıl çalışır? Üç adımda maçın hazır.", "Maç gününe kadar her şey", list bullets "Konum: Kadıköy".                              | Generic section titles; facts rendered as `label: value` bullets instead of designed data.                                                     |
| Mobile web | Nav wraps to three rows; hero paragraph is 10 lines.                                                                             | Copy length, not viewport, is the problem.                                                                                                     |
| Mobile app | Cards with hairline, buttons with 12 px radius, system-like lists. Lineup is a list of names.                                    | The one screen that could only be Kadro (lineup) looks like a settings list.                                                                   |

What already works and stays: the answer-first paragraphs and SEO structure, the 44 px targets,
visible focus, custom-property theming under the nonce CSP (`--m-*` today, `--k-*` from the brand
theme after W2), the hairline-only header,
the sample-label discipline, the short imperative tone of the spec ("Kadroyu kur").

## 2. Concept: the squad sheet under floodlights

The one idea: **Kadro is the squad sheet pinned to the wall of a floodlit halı saha at 21:00.**
Every surface is built from the three objects of that scene, and nothing else:

1. **Kit numbers.** Every player has a number; every count (13/14, 2 eksik, 200 ₺) is set in
   condensed, heavy numerals, the way numbers sit on a shirt back. The empty slot in a lineup is
   an outlined number with no body in it: that outline is the "eksik" and it is the brand's most
   recognisable graphic.
2. **Chalk on turf.** Pitch geometry (touchline, halfway line, centre circle, penalty box) is
   drawn as chalk lines on deep turf, always as a working diagram with real data on it (sides,
   positions, bench), never as a background pattern or a watermark.
3. **The night surface.** Both the web and the app ship a light and a dark scheme, follow the
   system setting by default and let the user pin one (§4.11). The emphasis differs: the app is
   designed dark first (match night), the web is chalk-light first with the dark pitch as an
   object inside it. The pitch diagram is night turf in both schemes. Green is the pitch and the
   "geliyorum" state, not a wall colour. Orange is the ball and the one thing that needs an
   answer right now.

Why it fits: the product's data is exactly this (a roster, positions on a pitch, counts, a fee
split, a missing-player call). The squad sheet makes the data the design. It is specific to
amateur halı saha culture (hand-written sheets, 21:00 kick-offs, "bir eksik var" messages in the
group chat) and no competitor owns it: Turkish products in this space (TaktiGO, Altıpas, Maç Var
listings) use soft green washes, tactic boards in device cards and three-icon rows.

Rejected directions, so nobody re-opens them:

- **Broadcast / live-score look** (Sofascore, FotMob density, ratings badges): we have no live
  data and no ads; the density would be empty.
- **Hype sports brand** (black, acid green, italic condensed caps, glow): the ownership rule in
  the spec says "never toxic-competitive", and this is the most copied look in sports apps.
- **Warm craft / editorial serif**: wrong subject; a halı saha is concrete, nets and floodlights.
- **Tactic board as hero** (TaktiGO): it is their hero, and it says "coach", not "organiser".
- **Any 3D props, stock photos, synthetic imagery or video**: nothing of that kind enters the
  repository.

## 3. References and what we take from them

One line each. Principles only; no layout, asset or logo is copied, and no trademarked material
enters the repository.

| Reference                                                                                                                                    | What we take                                                                                                                 | What we do not copy                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Sofascore, redesigned lineup <https://www.sofascore.com/news/sofascores-redesigned-lineup-feature-take-match-analysis-to-the-next-level/>    | One data item per player marker; a chip row above the pitch switches the layer instead of stacking badges on the marker.     | Ratings, market values, club logos.                          |
| FotMob home <https://www.fotmob.com/> (measured: 92 % white, accent under 1 %)                                                               | Match rows as a tight scoreboard: name, time or score in tabular numerals, nothing decorative.                               | Ad slots, three-column portal layout.                        |
| FC Porto Memorial, Awwwards SOTD <https://www.awwwards.com/sites/fc-porto-memorial> (measured: two colours, 62 / 34)                         | Two-colour restraint; one big numeral as content.                                                                            | Scroll-hijack "tunnel" (its usability score was the lowest). |
| AFC Ajax identity by Smörgåsbord <https://www.itsnicethat.com/articles/smorgasbord-studio-ajax-brand-identity-graphic-design-project-080925> | Refusing the "bold italicised sans" sports trend; a type system "built for movement" from one family.                        | The custom typeface, the crest.                              |
| Nike website typography, Fonts In Use <https://fontsinuse.com/uses/14239/nike-website-2016>                                                  | Condensed bold display against a neutral UI face; we do it with one variable family at two widths.                           | Futura / Trade Gothic (not open licence).                    |
| Fonts In Use, football tag <https://fontsinuse.com/tags/2599/football-soccer>                                                                | Condensed grotesques and bespoke numerals recur in club identities; numerals are an identity carrier.                        | Any specific club typeface.                                  |
| Fontfabric, kit typography <https://www.fontfabric.com/blog/the-best-fonts-for-football-kits-design/>                                        | Numerals must read "at a sprint": compact, bold, open counters; the 2018 hollow-centre-line failure is the warning.          | Stencil or inline numerals.                                  |
| Strava developer brand guidelines <https://developers.strava.com/guidelines/>                                                                | One accent reserved for a short list of roles, written down.                                                                 | The orange itself.                                           |
| Spond home <https://www.spond.com/> (viewed 2026-10-03)                                                                                      | The event row with a date block and RSVP counts is the category convention; our card must lead with the squad count instead. | Gradient hero, 3D sports props, "trusted by 12 million".     |
| TaktiGO <https://taktigo.com/>                                                                                                               | Local baseline: pitch lines as page background, two-tone headline, three icon cards. This is the look to move away from.     | Everything above.                                            |
| Awwwards sports category <https://www.awwwards.com/websites/sports/>                                                                         | The hero visual is data (a lineup) rather than photography.                                                                  | Photo-led heroes.                                            |
| Typewolf on Google Fonts <https://www.typewolf.com/google-fonts>                                                                             | Archivo Narrow is a respected open condensed grotesque.                                                                      | n/a                                                          |
| Archivo on Fontsource <https://api.fontsource.org/v1/fonts/archivo> and the file in `google/fonts` (`ofl/archivo/Archivo[wdth,wght].ttf`)    | OFL 1.1, subsets latin + latin-ext, variable `wdth` 62-125 and `wght` 100-900, `tnum` present (inspected locally, see §4.2). | n/a                                                          |

## 4. Visual system

### 4.1 Colour

Hues stay in the family of the spec (green, orange, yellow card, red card, night, chalk) so the
app icon and the mark stay recognisable; the neutrals are rebuilt in steps and the **use** of
colour changes. **Owner decision (2026-10-03): the web and the app both ship a light and a dark
scheme**, each designed on its own, not as an inversion of the other. Both schemes define the
same 29 semantic roles; the canonical values are `packages/brand/theme/tokens.json` (v3.0.0,
mirrored in `tokens.json` next to this file), every value is a palette entry, and every pair below
is checked in both schemes by `packages/brand/scripts/validate-tokens.mjs` (WCAG 2 contrast: text
4.5:1, non-text 3:1).

| Role            | Light     | Dark      | Job                                                                                                     |
| --------------- | --------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `background`    | `#F5F6F1` | `#0C1611` | page and screen ground: chalk / night                                                                   |
| `surface`       | `#FFFFFF` | `#142019` | cards, list groups, sheets                                                                              |
| `surfaceSunken` | `#EBEEE6` | `#08100C` | wells: download band, input ground, quiet sections                                                      |
| `surfaceRaised` | `#FFFFFF` | `#1B2A21` | floating layer (light lifts with `level2`, dark with this step)                                         |
| `fillMuted`     | `#E1E6DC` | `#24352B` | chips at rest, locked controls, skeletons; carries only `text` and `textMuted`                          |
| `border`        | `#D3D9D0` | `#2A3A30` | hairlines (decorative)                                                                                  |
| `borderStrong`  | `#6F7D75` | `#6A7A71` | input and control outlines                                                                              |
| `text`          | `#0F1A14` | `#F5F6F1` | body and headings                                                                                       |
| `textMuted`     | `#4E5E55` | `#A6B3AA` | meta, captions, inactive tabs                                                                           |
| `inverse`       | `#0F1A14` | `#F5F6F1` | selected chip, toast; `onInverse` `#F5F6F1` / `#0C1611`                                                 |
| `primary`       | `#1B7F4B` | `#3DBF78` | primary button, "geliyorum"; `onPrimary` `#FFFFFF` / `#0F1A14`                                          |
| `primaryText`   | `#17704A` | `#3DBF78` | green as text; `link` has the same values                                                               |
| `focusRing`     | `#17704A` | `#F5F6F1` | 2 px ring, 2 px offset                                                                                  |
| `accent`        | `#E35A14` | `#FF6B1A` | the one orange action; `onAccent` `#0F1A14` in both                                                     |
| `accentText`    | `#0F1A14` | `#FF7A33` | orange text exists on dark only; on light the role is ink                                               |
| `warning`       | `#F2C230` | `#F2C230` | "belki", `ÖRNEK` tag; a fill only; `onWarning` `#0F1A14`                                                |
| `danger`        | `#D7263D` | `#FF5C6E` | "gelmiyorum", destructive; `onDanger` `#FFFFFF` / `#0F1A14`                                             |
| `dangerText`    | `#C41E34` | `#FF5C6E` | error text                                                                                              |
| `pitch` group   | fixed     | fixed     | `pitch #0E5B36`, `pitchLine #F5F6F1`, `onPitch #FFFFFF`, `pitchMarker #F5F6F1`, `onPitchMarker #0F1A14` |

How the two schemes differ by design:

- **Light** keeps the deep green `#1B7F4B` with white labels and a deeper orange `#E35A14` for
  the accent fill, so the button clears 3:1 on chalk and on the sunken band (3.37 / 3.12) while
  ink on it stays at 4.87. Hierarchy is three surface steps plus `level2` for floating things.
- **Dark** switches the primary and danger fills to the bright tints `#3DBF78` and `#FF5C6E` with
  ink labels (7.57 and 5.95). The deep green fill sits at 2.99:1 against a raised night surface,
  and a green bright enough to clear it cannot keep a white label at 4.5:1, so the dark fills
  carry ink; under floodlights the bright fill is also the clearer signal. The focus ring is chalk; depth comes from the `surfaceRaised` step, not shadows; the
  sunken step goes darker than the ground (`#08100C`).
- **Fixed (always dark):** the pitch roles are identical in both schemes; see §4.11.

Measured pairs (selected; the full list is `contrast.pairs` / `contrast.nonTextPairs`):

| Pair                                                       | Light                      | Dark                                |
| ---------------------------------------------------------- | -------------------------- | ----------------------------------- |
| text on background / surface / raised                      | 16.41 / 17.82 / 17.82      | 16.98 / 15.46 / 13.81               |
| textMuted on background / sunken / fillMuted               | 6.33 / 5.86 / 5.42         | 8.48 / 8.86 / 5.96                  |
| primaryText on background / sunken / raised                | 5.60 / 5.19 / 6.08         | 7.84 / 8.19 / 6.37                  |
| dangerText on background / sunken / raised                 | 5.40 / 5.00 / 5.86         | 6.16 / 6.43 / 5.01                  |
| accentText on background / raised                          | 16.41 / 17.82 (ink)        | 7.10 / 5.78                         |
| onPrimary / onAccent / onDanger / onWarning on their fill  | 5.02 / 4.87 / 4.96 / 10.64 | 7.57 / 6.26 / 5.95 / 10.64          |
| borderStrong on background / raised (3:1)                  | 3.97 / 4.32                | 4.07 / 3.31                         |
| primary fill on background / raised (3:1)                  | 4.62 / 5.02                | 7.84 / 6.37                         |
| accent fill on background / sunken (3:1)                   | 3.37 / 3.12                | 6.47 / 6.76                         |
| pitchLine / onPitch on pitch; onPitchMarker on pitchMarker | 7.53 / 8.18; 16.41         | same                                |
| pitch edge (3:1)                                           | turf on background 7.53    | chalk touchline on background 16.98 |

Lowest values: text 4.87 (light) and 5.01 (dark); non-text 3.12 (light) and 3.31 (dark).

Usage rules (the part that changes the look):

- Green is never a section or screen background. It appears as the pitch fill of a diagram, the
  primary button, links, and the "geliyorum" state. The header and footer wordmark are `text`.
- Orange appears at most once per viewport: the primary CTA on the web, and in the app only the
  ball spot of the mark, the "Eksik Var" marker and the "Başvur" button on a call. Never as a
  highlight colour for icons or chips.
- RSVP and status colours are fixed: in = primary, maybe = warning, out = danger, waitlist =
  textMuted outline, locked/closed = `fillMuted` with the lock icon, in both schemes. State fills
  always carry their label. No other place uses warning or danger as decoration.
- Hierarchy on light comes from three surface steps (background, surface, surfaceSunken) and
  1 px `border` lines, not from shadows. On dark, from background, surface and surfaceRaised.
- No gradients, no glows, no translucent "glass".

### 4.2 Typography

One family, two widths: **Archivo** (SIL Open Font License 1.1, Omnibus-Type, Google Fonts),
the variable file `Archivo[wdth,wght].ttf`. Verified by reading the font tables of the file from
`google/fonts` on 2026-10-03: axes `wght` 100-900 and `wdth` 62-125; glyphs for Ğ ğ İ ı Ş ş Ç ç
Ö ö Ü ü and ₺ all present; OpenType features include `tnum`, `lnum`, `pnum`, `onum`, `zero`,
`locl` (the Turkish `i`/`İ` casing uses `locl` with `lang="tr"` on the web root and the device
locale on mobile).

| Role    | Setting                                                                  | Where                                                                    |
| ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| display | Archivo `wdth` 75, weight 700-800, tracking -0.01em, line-height 1.0-1.1 | Headlines at 32 px and above, page and section titles, the wordmark      |
| body    | Archivo `wdth` 100, weights 400 / 500 / 600                              | Everything that is read: paragraphs, labels, buttons, list rows          |
| numeric | Archivo `wdth` 75, weight 700-800, `font-variant-numeric: tabular-nums`  | Kit numbers, counts (13/14), kick-off times, fees, scores, dates in rows |

Rules: headlines under 32 px use the body width at weight 600 (no narrow type at small sizes);
uppercase only for kit-number labels and the word `EKSİK` on a marker, never for eyebrows;
no italics; emphasis inside a sentence is weight 600 of the same width; no mixed-colour
headlines.

Web scale (px size / line-height / weight / width). Body text column is 68ch max.

| Token     | Desktop                   | Mobile (< 640 px)   | Use                                     |
| --------- | ------------------------- | ------------------- | --------------------------------------- |
| hero      | 72 / 72 / 800 / 75        | 44 / 46 / 800 / 75  | Home H1 only, max 2 lines               |
| display   | 56 / 58 / 800 / 75        | 40 / 42 / 800 / 75  | Page H1                                 |
| title1    | 40 / 44 / 700 / 75        | 32 / 36 / 700 / 75  | Section H2                              |
| title2    | 28 / 34 / 700 / 75        | 24 / 30 / 700 / 75  | Article H2, row titles                  |
| title3    | 20 / 28 / 600 / 100       | 20 / 28 / 600 / 100 | H3, card titles                         |
| lead      | 20 / 30 / 400 / 100       | 18 / 28 / 400 / 100 | Answer-first paragraph under H1         |
| prose     | 18 / 30 / 400 / 100       | 17 / 28 / 400 / 100 | Article and legal body                  |
| body      | 16 / 24 / 400 / 100       | same                | UI text                                 |
| label     | 14 / 20 / 600 / 100       | same                | Buttons, chips, table heads             |
| caption   | 13 / 18 / 500 / 100       | same                | Meta lines, sample notices              |
| numeralXL | 112 / 112 / 800 / 75 tnum | 72 / 72 / 800 / 75  | The squad count in the hero squad sheet |
| numeral   | 40 / 44 / 700 / 75 tnum   | 32 / 36 / 700 / 75  | Counts in rows, dates in the timeline   |

Mobile scale (pt / line-height / weight / width): caption 12/16/500/100, footnote 13/18/400/100,
label 14/20/600/100, body 16/24/400/100, bodyStrong 16/24/600/100, title3 20/26/600/100,
title2 24/28/700/75, title1 32/36/700/75, display 40/42/800/75, numeral 24/28/700/75 tnum
(kick-off times in rows), score 40/44/700/75 tnum, bib 28/32/800/75 tnum (marker numerals),
numeralXL 64/64/800/75 tnum (the squad count on the Maçlar tab card).

Files (shipped in `packages/brand/fonts/archivo/`, ADR-0084): the web self-hosts two WOFF2
subsets of the variable font with `unicode-range` and preloads only the latin file. The subsets
keep only the axis ranges the system uses (`wdth` 75-100, `wght` 400-800), declared with
`font-stretch: 75% 100%` and `font-weight: 400 800` in `@font-face` and selected with
`font-stretch: 75%` (not `font-variation-settings`, so fallbacks degrade). The latin file also
carries Ğ ğ İ Ş ş and ₺, so a Turkish page needs one file: latin 55 KB, latin-ext 51 KB, 106 KB
together (target under 110 KB; today four files). React Native cannot select variable axes, so
mobile and the OG renderer load five static instances cut with fontTools
(`fonttools varLib.instancer`): `Archivo-Regular`, `-Medium`, `-SemiBold` (wdth 100) and
`ArchivoCondensed-Bold`, `-ExtraBold` (wdth 75). The narrow instances are named Condensed, as
the font's own STAT table names wdth 75, because Archivo Narrow is a separate family. The brand
package ships the unmodified variable file (`Archivo-Variable.ttf`), the two subsets, the five
instances and `OFL.txt`. Sora and Inter stay in the package only until the apps have migrated
(ADR-0084), then they are removed.

### 4.3 Spacing, radius, elevation

- 4 pt grid as today, with three added steps for web sections: 80, 96, 128. Section rhythm on
  the web: hero 96 top / 128 bottom, sections 96, dense sections (venue facts, FAQ) 64.
  Mobile screens: 16 side gutter, 12 between rows, 24 between groups.
- Radius is tied to the element class, one scale: chips and tags 4, buttons and inputs 8,
  cards and list groups 12, sheets, modals and device frames 20, player markers and avatars
  full. Nothing else.
- Elevation: the light scheme has no shadows except `level2` for floating things (bottom sheet,
  sticky CTA on the invite page, the device frame): `0 8px 24px rgba(15, 26, 20, 0.12)`. The
  sticky header uses a 1 px `border` line, not a shadow. The dark scheme replaces shadows with the
  `surfaceRaised` step plus a 1 px `border`; sheets keep a soft `level2`
  (`0 8px 24px rgba(0, 0, 0, 0.5)`) so they separate from the scrim. Overlays per scheme:
  `pressed` (8 % ink on light, 10 % chalk on dark) and `scrim` (48 % ink / 64 % black).

### 4.4 Layout and page compositions (web)

Grid: 12 columns, 1200 px max content width, 24 px gutters, 20 px page gutter under 640 px.
Text columns are left-aligned; nothing is centred except the invite card (it is a ticket). No
section repeats the layout family of the previous one. At most one chip-style label per three
sections. No section is a row of three equal cards.

- **Home** `/`: 1. Hero, split 7/5: left the H1 (two lines), lead (≤ 20 words), one CTA
  "Uygulamayı indir"; right the **squad sheet**: an inline SVG (`components/marketing/squad-sheet.tsx`,
  server-rendered, sample data from `content.ts`) of a 7v7 pitch with 13 markers numbered
  1-14, one outlined empty marker labelled `EKSİK · KALECİ`, and the count `13/14` in
  `numeralXL` above it. 2. **Maç haftası**: a vertical timeline keyed to real clock times
  (Pazartesi 20:14 ilan açıldı, Salı kadro 11/14, Çarşamba eksik kapandı, Perşembe 21:00 maç,
  Cuma ücret 14 × 200 ₺) with the time in `numeral`; this replaces the 1-2-3 steps. 3. Three
  feature rows, each a 2-column split of text and a real app screenshot in a device frame, image
  side fixed left for the first two and the third row full-width with the lineup diagram
  (zig-zag cap). 4. Who it is for: a plain 3-column text list without cards, hairline above. 5. Download band on `surfaceSunken` with the store badges as they are. Footer unchanged.
- **Özellikler** `/ozellikler`: H1 + lead, then four groups (Takım, Maç ve katılım, Eksik Var,
  Saha ve ücret) as 2-column rows: left the group title and a device-framed screenshot, right a
  definition list of the features (term in `title3`, one sentence each). Rows 1-2 image left,
  row 3 full-width lineup diagram, row 4 image right. Kadro Pro and Hesap as a two-column text
  block at the end, no cards.
- **Blog index** `/blog`: a list, not cards: date in `numeral` left column (fixed 96 px), title
  `title2` as the link, one-line summary, hairline between rows.
- **Article** `/blog/[slug]`: single 68ch column, H2 in `title2`, a figure slot for an inline
  SVG formation diagram where the MDX asks for one (the 7v7 article), meta line "2 Ekim 2026,
  4 dk" in caption. No sidebar.
- **Saha** `/saha/[slug]`: H1, the sample notice as a `warning`-tinted tag beside the H1 (not a
  paragraph), the lead, then a 2-column fact grid (dl: Konum, Tür, Fiyat aralığı with the price
  in `numeral`), facilities as a chip row with a check or cross icon, reviews as a count in
  `numeral` with the "en az üç yorum" rule in caption, CTA band with one primary button and one
  text link.
- **Eksik Var district** `/eksik-var/[il]/[ilce]`: H1, lead, "Bu hafta eksik olan maçlar" as
  scoreboard rows: the missing count in `numeral` (56 px) left, format `7v7` under it, middle
  the date and time in tabular numerals and the team name, right the position and level as
  chips and the deadline in caption. Venue list below as a plain link list.
- **SSS** `/sss`: two columns from 900 px: left a sticky list of question titles (in-page
  links), right the questions and answers in `prose`, no accordion. Single column below.
- **Davet** `/mac/[code]`: one centred card (max 480 px, radius 20) with the team name in
  `display`, district, "Kadro: 1 oyuncu" in `numeral`, the primary CTA; the store badges below
  the card; the explanatory paragraph in caption under the CTA.
- **Gizlilik / KVKK / İletişim**: typography and spacing only.
- **404 and error**: `display` title, one sentence, one link.

### 4.5 Mobile screens

- **Tab bar**: five tabs stay. Icons from Phosphor (regular weight, 24 pt); active tab:
  `primaryText` (light) / `text` (dark) with the label at weight 600; inactive `textMuted`.
  No indicator bar, no badges except the Eksik Var count when a call of the user's team is open.
- **Lists vs cards**: lists are the default (`ListItem` rows with a hairline, 56 pt min height).
  Cards only for the next match on Maçlar, the open call rows, and the invite preview.
- **Match card** (Maçlar tab, top): left a 72 pt column with the day in `numeral` and the weekday
  and month in caption; middle the team or opponent name (`title3`), venue and district (body),
  kick-off time in `numeral` 24; right the squad count `11/14` in `numeralXL` scaled to 40 with
  the RSVP chip under it. The card border is `border`; no coloured stripe.
- **Match detail**: header with the count and kick-off; RSVP as a 3-segment control
  (Geliyorum, Belki, Gelmiyorum) filled in the state colour of §4.1; waitlist shows a full-width
  notice row "Bekleme listesi: 3. sıradasın" with the position in `numeral`; locked or closed
  shows the control disabled on `fillMuted` with a lock icon and the reason in caption.
  Participants as a list with the kit number (`bib`) in a 32 pt circle, name, position chip.
- **Lineup** (`dizilis`): a portrait pitch SVG (`PitchView`, react-native-svg, viewBox
  300 × 460, `pitch` fill, 2 px `pitchLine` lines, centre circle r 40) with side A in the top
  half and side B in the bottom; markers are 36 pt circles, `pitchMarker` fill, `bib` numeral in
  `onPitchMarker` (both fixed, so the pitch looks the same in both schemes); an empty slot is a dashed `pitchLine` circle with a plus; the bench is a chip row
  under the pitch. Dragging a chip onto a slot assigns; "Otomatik dengele" is a secondary
  button; the balance summary is four pairs of numerals (KL 1-1, DF 2-2, OS 2-2, FV 2-1), not
  bars.
- **Eksik Var list**: rows with the missing count in `numeral` left, position and level chips,
  date and time; filters as a chip row under the title. The detail screen is the only place with
  an orange button ("Başvur").
- **Sahalar**: search field, district chip, rows with name, district, price range in `numeral`
  and the facilities as four small icons; sample rows keep `[ÖRNEK]` and the notice.
- **Profil**: name in `title1`, position and level as chips, district; stats as three numerals
  (maç, MVP, takım) in a row without cards; the Pro upsell is one list row, not a banner.
- **Auth and settings**: forms with the label above the field, 8 px radius inputs, helper and
  error text below; no cards. Ayarlar has a "Görünüm" row group with three choices, Sistem,
  Açık, Koyu (a radio list, the current one checked), stored on the device (§4.11).

### 4.6 Iconography

One set everywhere: **Phosphor Icons** (MIT; `@phosphor-icons/react` on the web,
`phosphor-react-native` on mobile), regular weight, 1.5 px stroke at 24, 20 px in rows and
chips. The five tab icons map to Phosphor glyphs (SoccerBall, UsersThree, UserPlus, MapPin,
User); `TabIcon.tsx` becomes a thin wrapper. No emoji anywhere, no hand-drawn icon paths
except the pitch diagram and the mark.

### 4.7 Imagery

No stock photography, no synthetic imagery, no video. Allowed and required:

- **Squad sheet and pitch diagrams** as inline SVG (web) and react-native-svg (app), drawn from
  data; the formation figures in articles come from the same component with a formation prop.
- **Kit-number graphics**: large `numeralXL` figures as the visual of a section (the count in the
  hero, the missing count on district rows, the fee split "14 × 200 ₺").
- **Real app screens in a device frame**: PNG screenshots of the actual app (sample data,
  dark scheme) taken on the simulator through Maestro, stored in `apps/web/public/screens/`,
  rendered through `next/image` with fixed dimensions; the frame is our own CSS (radius 44,
  12 px bezel in `text`, no vendor cues). Each PNG under 150 KB at 2x.
- The OG card shows the squad sheet (13 markers, one outlined) with the title, instead of the
  centre circle.

### 4.8 Motion

Durations: press 120 ms, state change 200 ms, enter 320 ms, diagram draw 480 ms. Easing
`cubic-bezier(0.22, 1, 0.36, 1)` for enters and state, `cubic-bezier(0.4, 0, 1, 1)` for exits.
Only `transform` and `opacity` animate. What moves, and nothing else:

- Web: the hero squad sheet draws its chalk lines once on load (stroke-dashoffset, 480 ms) and
  the markers fade in (320 ms, 30 ms stagger); buttons translate 1 px down on press; nothing
  animates on scroll.
- Mobile: the RSVP segment thumb slides (200 ms); a marker dropped on the pitch settles with a
  translateY 8 → 0 (320 ms); list skeletons fade, no shimmer; sheets slide up (320 ms).
- `prefers-reduced-motion` / `AccessibilityInfo.isReduceMotionEnabled`: all durations become 0
  except opacity fades capped at 120 ms; the diagram renders fully drawn.

### 4.9 Components

- **Buttons**: primary = `primary` fill, `onPrimary` text (deep green with white on light,
  bright green with ink on dark); accent = `accent` fill, `onAccent`
  text (one per viewport); secondary = `surface` with 1 px `borderStrong`; text button =
  `primaryText` underline on hover. Height 48 web / 48 pt mobile, radius 8, label weight 600,
  one line, max 3 words, same label for the same intent on a page.
- **Chips** (position, level, facility, filter): radius 4, 32 pt high, body 14 weight 500,
  `fillMuted` fill with `text` label, selected = `inverse` fill with `onInverse` label. State chips use the
  §4.1 state colours as fill with the matching on-colour.
- **Badges**: the sample tag `ÖRNEK` is a chip with `warning` fill and `onWarning` text, placed
  beside the title it qualifies, never floating on an image. Verified venue = `primaryText`
  check icon plus the word "Doğrulanmış".
- **Empty states**: an outlined empty marker (the eksik glyph) at 64 pt, a one-line statement
  of what is missing, one button that creates it ("Henüz maç yok. İlk maçı aç.").
- **Error states**: direct sentence, what to do next, one retry button; never "Oops".
- **Form fields**: label above, 48 pt input, radius 8, `borderStrong` outline, 2 px
  `focusRing` ring with 2 px offset (green on light, chalk on dark), helper text in caption, error text in `dangerText`
  below the field; no placeholder-as-label.
- **Rows**: 56 pt min, hairline `border` between rows only, chevron only when the row opens a
  screen.
- **Device frame**: CSS component, 20 px radius inner, 44 outer, frame colour ink `#0F1A14` in
  both schemes (the screenshots inside are dark-scheme captures); on dark a 1 px `borderStrong`
  outline marks its edge.

### 4.10 Copy tone

Short imperatives, "sen", concrete nouns (saha, kadro, ücret, kaleci), times and counts as
numbers. Headline ≤ 6 words, lead ≤ 20 words, section titles name the thing, not the benefit.
Banned words: kolayca, sorunsuz, modern, yenilikçi, hızlı ve güvenli, "her şey", "tek dokunuşla".
No exclamation marks except the product phrase "Eksik var!". No middle dots as separators.
Three rewrites:

| Where                     | Now                                          | Direction                                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home hero                 | "Kadron eksik kalmasın." + 56-word paragraph | H1 "Kadroyu kur, eksiği kapat, ücreti böl." Lead: "Halı saha maçının takımı, katılımı ve saha ücreti tek ekranda. Eksik kalırsa mahalleden oyuncu çağır." (The tagline stays in the footer and store copy.) |
| Home, steps section       | "Nasıl çalışır? / Üç adımda maçın hazır."    | "Maç haftası Kadro'da böyle geçer" with the timeline rows above (Pazartesi 20:14 ilan açıldı … Perşembe 21:00 maç).                                                                                         |
| Home, features band       | "Maç gününe kadar her şey"                   | "Düdüğe kadar her iş tek yerde"                                                                                                                                                                             |
| District page, list title | "Açık ilanlar"                               | "Bu hafta eksik olan maçlar"                                                                                                                                                                                |

The answer-first paragraphs required by the SEO rules keep their 40-60 words; they sit under the
H1 as `lead` on inner pages, and on the home page the lead is the short version while the
40-60 word definition moves to the "Kim için" section.

### 4.11 Theming: light and dark

Preferences: `system` (default), `light`, `dark`. Labels in Turkish: Sistem, Açık, Koyu.

**Web** (marketing, SEO pages, invite page, e-mail link pages):

- Colours come only from `@kadro/brand/theme.css` (`--k-color-*`). Light values sit on `:root`
  and `[data-theme='light']`, dark values on `[data-theme='dark']`, and the dark values repeat in
  `@media (prefers-color-scheme: dark)` for `:root:not([data-theme])` and `[data-theme='system']`.
  Every block sets `color-scheme`.
- The root layout reads the `kadro-theme` cookie on the server and renders
  `<html data-theme="…">` (`system` when there is no cookie). Every HTML surface already renders
  per request for the CSP nonce (ADR-0055), so this costs nothing and needs no inline script:
  the first paint is right, with no flash, under the existing nonce policy. If CSS support for the
  media query is missing, the page stays light.
- The toggle in the footer is a three-option form (Sistem / Açık / Koyu) that posts to a
  same-origin route handler; the handler validates the value, sets the cookie (`Path=/`,
  `SameSite=Lax`, `Secure`, 365 days) and redirects back with 303. A bundled client component
  may set `data-theme` at once before the round trip (progressive enhancement, no new script
  source). No preference is stored server side.
- `<meta name="color-scheme" content="light dark">` and two `theme-color` entries with `media`
  (`#F5F6F1` light, `#0C1611` dark).

**Mobile:**

- `ThemeProvider` resolves the stored preference (AsyncStorage key `kadro.colorScheme`) against
  `useColorScheme()`; `system` follows the device and reacts to changes, `light` and `dark` pin
  it. Colours come from `colors.light` / `colors.dark` of `@kadro/brand/tokens`; navigation
  chrome, the status bar style and the splash background (`#F5F6F1` / `#0C1611`) follow the
  resolved scheme. The setting lives in Ayarlar (§4.5).

**Always dark, in both schemes:**

- The pitch diagram everywhere it appears (web hero squad sheet, article formation figure, app
  `PitchView`): `pitch`, `pitchLine`, `onPitch`, `pitchMarker`, `onPitchMarker` are fixed roles
  with one value. On light it is a night object on chalk (turf against chalk 7.53:1); on dark its
  edge is the chalk touchline (16.98:1), because turf against night is only 2.26:1. The empty
  slot stays a dashed chalk outline; the orange ball spot is decoration only.
- The OG card images are fixed light-scheme rasters (a raster cannot follow the reader's scheme): chalk ground, ink wordmark and the squad sheet with its always-dark pitch.
- The device frame (ink) and the app screenshots inside it (dark-scheme captures).

**Everything else adapts by role**, never by hard-coded colour: the header and footer wordmark
is inline SVG filled with `--k-color-text` (the ball spot stays orange), so it follows a
pinned scheme too; the files `kadro-wordmark.svg` (ink) and `kadro-wordmark-light.svg` (chalk)
are for places that cannot read CSS (OG card, store art, documents). Store badges use the official
artwork with its outline on dark, and the app icon is unchanged. The admin panel and e-mail
templates keep the light scheme for now; they pick up the tokens only.

## 5. Anti-patterns for implementers

Each of these is a review blocker.

1. No full-bleed coloured hero band; no centre circle or pitch lines as a watermark or background
   pattern. Pitch geometry only inside a diagram that carries data.
2. No row of three (or more) equal cards as a section structure; no numbered step discs; no
   "Nasıl çalışır 1-2-3". Sequence is shown only by the timeline with real times.
3. No emoji, no second icon set, no hand-drawn icons beyond the pitch and the mark.
4. No gradients, blobs, glows, glass, noise overlays, pure black or pure white backgrounds.
5. No uppercase eyebrows above headings; no two-colour headlines; no italic sports type.
6. No stock photos, synthetic imagery, 3D props, or faked UI built from divs; only real app
   screenshots in our frame and SVG diagrams.
7. No scroll-driven animation, parallax, marquee, counters that count up, or hover transitions on
   every card. One load-time draw on the hero, feedback on press, state changes.
8. No fabricated numbers (users, ratings, prices, "12 million"); sample data stays labelled
   `[ÖRNEK]`; fees and counts in examples come from `content.ts` fixtures.
9. No `label: value` bullet lists for facts; facts are definition grids or rows with numerals.
10. No accordion for the FAQ; no sidebars on articles; no footer link farm beyond the two groups.
11. No new hue; no orange as text on light surfaces; no green as a background.
12. No `h-screen`; no literal colours in CSS modules (only `--k-*` properties of the brand theme); no inline `style`
    beyond the shell's variable block; no external font or icon host (CSP `self` only).
13. No change to routes, nav labels, `testID`s, i18n keys, legal copy or the answer-first rule.

## 6. Token handoff

Delivered by W1 (ADR-0084). `packages/brand/theme/tokens.json` (v3.0.0) is the source of truth
and `tokens.json` next to this file mirrors it. It keeps the keys of the first handoff
(`color.palette`, `color.theme.light|dark`, `typography`, `spacing`, `radius`, `elevation`,
`motion`, `state`, `contrast`) and adds `color.fixedRoles`, `color.overlay`, `theming`,
`typography.nativeFamily` and `typography.fontFiles`; contrast pairs carry
`scheme: light | dark | both`. Consumers do not read the JSON directly:

- the web imports `@kadro/brand/theme.css` (`--k-color-*` and the rest, both schemes);
- the app imports `@kadro/brand/tokens` (`colors.light`, `colors.dark`, `typeScale` on the
  static instances, `overlays`, `elevation`, `theming`); the mobile theme takes `border`,
  `pressed` (`overlays.pressed`), `skeleton` (`fillMuted`) and the error text
  (`dangerText`) from roles instead of alpha blends of `textMuted`.

The v1 `packages/brand/tokens.json` and the Sora and Inter files stay frozen until W2, W3 and
W6 have moved their readers; the package README lists every v1 name still in use. The files in
`prototype/` keep the v2 values they were built with (`tokens.css` says so) and are not updated.

## 7. Work breakdown and ownership

Sequence: W1 first (everything depends on the tokens and fonts); W2 and W3 in parallel; then W4
(three workers, disjoint pages) in parallel with W5 (three workers, disjoint screen areas); W6
last. One owner per file; the lead owns `packages/brand/**` and `docs/adr/**` per the workspace
rules, so W1 is the lead or a worker writing files for the lead to commit.

| Work package                    | Owns (exclusive)                                                                                                                                                                                                                                                               | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1 Brand                        | `packages/brand/**`, `docs/adr/0084-design-direction.md`, `docs/design/direction.md`, `docs/design/tokens.json`                                                                                                                                                                | Done: `theme/tokens.json` with both schemes, `theme/theme.css` and `theme/tokens.ts` built from it; `fonts/archivo/` (variable TTF, two WOFF2 subsets, five static instances, `OFL.txt`); wordmarks redrawn in Archivo wdth 75 weight 800 with the O as the centre circle and the orange spot; app icon and mark unchanged; validator checks both schemes (text 4.5, non-text 3.0), the Turkish cmap, features, axes, the web budget and the built files; README contract; ADR-0084. v1 `tokens.json`, `fonts/sora`, `fonts/inter` stay until the readers move.                                                                                                                                                                                                    |
| W2 Web shell                    | `apps/web/components/marketing/**`, `apps/web/public/fonts/**`, `apps/web/public/screens/**`, `apps/web/tests/marketing/**`, `apps/web/app/layout.tsx`, `apps/web/app/tema/route.ts`, `apps/web/lib/client/theme.ts`, `apps/web/components/auth/**`, `apps/web/tests/pages/**` | Import `@kadro/brand/theme.css`; replace `MARKETING_THEME` / `THEME` mirrors and the `--m-*` / `--k-<role>` style blocks with `--k-color-*`; root layout renders `data-theme` from the `kadro-theme` cookie, `color-scheme` meta and two `theme-color` entries; the Sistem / Açık / Koyu footer form and its POST handler (§4.11); `fonts.css`/`fonts.ts` for the two Archivo subsets with `font-stretch`; `marketing.module.css` rebuilt on the §4 scale; inline wordmark on `--k-color-text`; new `squad-sheet.tsx`, `pitch-diagram.tsx` (fixed pitch roles), `device-frame.tsx`, `timeline.tsx`, `fact-grid.tsx`, `chip.tsx`; `content.ts` copy per §4.10; `store-badges.tsx` restyled for both schemes; tests read `theme/tokens.json` and check both schemes. |
| W3 Mobile theme and kit         | `apps/mobile/src/theme/**`, `apps/mobile/src/ui/**`, `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/assets/fonts/**`, `apps/mobile/tests/theme.test.tsx`                                                                                                                   | Read `colors`, `typeScale`, `spacing`, `radius`, `elevation`, `overlays` from `@kadro/brand/tokens`; load the five static instances with `expo-font` (`nativeFontFiles`); `ThemeColors` = the 29 roles plus `pressed`; `ThemeProvider` with the stored preference (`system` / `light` / `dark`, AsyncStorage `kadro.colorScheme`) over `useColorScheme()` and a `useColorPreference()` hook for Ayarlar; navigation, status bar and splash follow the resolved scheme; new `Chip`, `Numeral`, `SegmentedControl`, `PitchView` (fixed pitch roles), `PlayerMarker`, `NoticeRow`; `Button`, `Card`, `ListItem`, `TextField`, `EmptyState`, `Skeleton` restyled; `TabIcon` on Phosphor (add `phosphor-react-native`; `react-native-svg` is already present).          |
| W4a Web home and features       | `apps/web/app/(marketing)/page.tsx`, `ozellikler/page.tsx`                                                                                                                                                                                                                     | Compositions of §4.4 with W2 components.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| W4b Web content pages           | `apps/web/app/(marketing)/blog/**`, `sss/**`, `gizlilik/**`, `kvkk-aydinlatma/**`, `iletisim/**`, `app/not-found.tsx`, `app/(marketing)/error.tsx`, `apps/web/components/content/**`                                                                                           | Blog list and article layout, FAQ two-column, legal typography, error pages. MDX content unchanged except a figure directive in the 7v7 article.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| W4c Web SEO and invite          | `apps/web/app/(seo)/**`, `apps/web/app/(marketing)/mac/**`, `apps/web/components/seo/**`                                                                                                                                                                                       | Venue fact grid, district scoreboard rows, invite ticket card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| W5a Mobile matches              | `apps/mobile/app/(tabs)/maclar/**`, `apps/mobile/app/takim/[id]/mac/**`, `apps/mobile/src/matches/**`                                                                                                                                                                          | Match card, match detail with the RSVP control, lineup with `PitchView`, payments as a numeral list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| W5b Mobile teams, calls, venues | `apps/mobile/app/(tabs)/takimlar/**`, `(tabs)/eksik-var/**`, `(tabs)/sahalar/**`, `app/takim/**` (except `mac/**`), `app/ilan/**`, `app/saha/**`, `app/mac/**`, `src/teams/**`, `src/calls/**`, `src/venues/**`                                                                | Rows, chips, invite preview, call detail with the single accent button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| W5c Mobile profile, auth, pro   | `apps/mobile/app/(tabs)/profil/**`, `app/profil/**`, `app/ayarlar/**`, `app/(auth)/**`, `app/index.tsx`, `app/kadro-pro.tsx`, `app/e-posta-dogrula.tsx`, `app/sifre-sifirla.tsx`, `src/profile/**`, `src/settings/**`, `src/billing/**`                                        | Forms, stats numerals, settings rows with the Görünüm choice (Sistem / Açık / Koyu, via W3's hook), paywall as a plan list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| W6 OG cards and screenshots     | `apps/web/components/marketing/og-image.tsx`, `apps/web/assets/og-fonts/**`, `apps/web/app/og/**`, `docs/screenshots/**`, `apps/mobile/.maestro/screenshots/**`                                                                                                                | OG card with the squad sheet and the Archivo instances; the screenshot run of §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Unchanged: `apps/web/app/api/**`, `lib/server/**` (the theme handler of W2 lives at `app/tema/route.ts`), security headers and CSP, `packages/db`,
`packages/contracts`, worker, admin pages (they inherit tokens only), `content/blog/*.mdx`
prose, `content/legal/*`, `robots`, `sitemap`, JSON-LD, Maestro flows and `testID`s.

Acceptance checks (all must pass before a work package reports done):

1. `pnpm --filter @kadro/brand test`: every pair in `contrast.pairs` ≥ 4.5 and every pair in
   `nonTextPairs` ≥ 3.0 in both schemes, assets present, fonts contain the Turkish glyph set
   (cmap check for U+011E, U+011F, U+0130, U+0131, U+015E, U+015F, U+00C7, U+00E7, U+00D6,
   U+00F6, U+00DC, U+00FC, U+20BA), built files up to date.
2. `apps/web/tests/marketing`: theme values equal the token file in both schemes; text pairs 4.5,
   non-text 3.0; `data-theme` rendered from the cookie (`light`, `dark`, `system` and none);
   header and footer links resolve; answer-first word counts hold; title and description length
   limits hold.
3. Lighthouse CI (ADR-0059) on `/`, `/ozellikler`, one article, one venue, one district page:
   performance, accessibility and SEO ≥ 90; LCP ≤ 2.5 s (the hero SVG is inline, the first
   screenshot image is `priority`); CLS < 0.1 (font metrics via `size-adjust` fallback,
   fixed image dimensions).
4. CSP unchanged: `tests/security` header suite green; no new `style`, `img`, `font` or
   `script` sources; the SVG diagrams use presentation attributes only.
5. Font payload: `public/fonts` total ≤ 110 KB; only the latin subset is preloaded.
6. Axe suite (Playwright e2e) green; focus visible on every interactive element in both schemes.
7. Mobile: `pnpm --filter mobile test` green with unchanged `testID`s, the theme test covering
   both schemes and the three preferences; Maestro flows green on
   the iOS simulator; `expo-doctor` clean; reduce-motion path exercised in the `PitchView` test.
8. Review against §5: a reviewer (second opinion, read-only) lists any violated item by number.

## 8. Screenshot plan

Sample data (all `[ÖRNEK]`, defined once in `content.ts` for the web and in the mobile MSW
fixtures): team "[ÖRNEK] Moda Akşam FK", Kadıköy; match Perşembe 21:00, 7v7, "[ÖRNEK] Kadıköy
Örnek Halı Saha A", fee 2.800 ₺, 14 players, 13 confirmed, missing position Kaleci; players with
numbers 1-14 and realistic names (Emre Kaya, Burak Şahin, Can Yıldız, Mert Aydın, Onur Demir,
Kerem Çelik, Barış Öztürk, Selim Arslan, Tolga Koç, Deniz Güneş, Umut Polat, Arda Kurt, Efe
Doğan, 14 empty); open call "2 eksik oyuncu, 7v7, Kaleci, Düzenli, 4 Ekim Pazar 20:00".

| Set         | Frames                                                                                                                                                                         | Device / size                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Web desktop | home fold, home full page, özellikler, blog index, 7v7 article (with the formation figure), saha, eksik-var Kadıköy, sss, mac invite, 404                                      | 1440 × 900 at 1x, full-page variants for home and özellikler         |
| Web mobile  | home, article, saha, eksik-var, invite                                                                                                                                         | 390 × 844 at 2x                                                      |
| Web dark    | home fold, article, eksik-var, invite (cookie `kadro-theme=dark`)                                                                                                              | 1440 × 900 at 1x and 390 × 844 at 2x                                 |
| App dark    | Maçlar tab with the match card, match detail (RSVP in), match detail (waitlist), lineup with 13 markers and one empty, Eksik Var list, call detail, Sahalar, Profil, Kadro Pro | iOS simulator, 6.1" class, dark scheme, 2x, Maestro `takeScreenshot` |
| App light   | Maçlar tab, lineup, Eksik Var list                                                                                                                                             | same device, light scheme                                            |
| OG          | home card, one article card, one venue card                                                                                                                                    | 1200 × 630 from `/og/*`                                              |

Each app frame is placed in the web device frame for `docs/screenshots` and the store listing
drafts; no vendor device art. The home and lineup frames are the two that must look designed: if
they do not, the direction has not been implemented.
