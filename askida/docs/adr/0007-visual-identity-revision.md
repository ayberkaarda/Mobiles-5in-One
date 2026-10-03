# ADR-0007: Visual identity revision

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated the design call; the design decision-maker chose the direction.

## Context

Section 2 of the specification fixed a corporate identity: a seven-colour palette with fixed roles,
Fraunces and Nunito Sans as fonts, and a logo concept of a loaf hanging from a hook whose curve is
the tail of the letter "a". The first brand package followed it with a warm, craft-leaning look.

The owner asked for a different look and authorised changes to the identity. The earlier direction
is dropped as a whole; nothing from it carries over. This record lists every deviation from section
2 so that the specification table is not silently contradicted.

The concept of the new identity is a public rail: in a shop, prepaid items hang on a rail, anyone
takes one down, nobody watches, and nothing is written about who. The system is built from three
objects: the rail (a 2 px horizontal line), the tag (a flat rounded rectangle with a punched hole,
the unit that carries an item, a count or a code) and the count (how many tags are on the rail
today). Design principle: **Rail, not hands.**

Concepts considered and rejected, closed:

- Civic signage in teal with wayfinding pictograms: a blue-green primary with an orange accent is
  the default pair of utility apps and nothing in the product is water or tile.
- Receipt or ledger look: it reads as a cashier flow and makes "askıdan al" feel like a
  transaction.

## Decision

### (a) Palette roles

The seven specification colours stay as core values with their exact hex codes: Ekmek Kabuğu
`#C8763A`, Zeytin `#4E6B3A`, Un Beyazı `#FBF8F3`, Kömür `#2B2B2B`, Gün Batımı `#E9A23B`, Deniz
`#2C6E91`, Nar `#B23A48`. Only their roles change.

| Colour or role | Specification (section 2) | Now                                                                             |
| -------------- | ------------------------- | ------------------------------------------------------------------------------- |
| primary        | Ekmek Kabuğu              | ink: Kömür in light, cream in dark (buttons, selected segment, QR ink)          |
| Ekmek Kabuğu   | primary                   | accent, reserved for tags, counts and the app icon; never a button fill or text |
| Zeytin         | secondary                 | success; secondary is now a quiet sand fill                                     |
| Gün Batımı     | accent                    | dark-scheme warning and the dark focus ring                                     |
| Deniz          | info                      | info keeps Deniz-derived values; the light value is derived as `#25607F`        |
| Un Beyazı      | background                | surface; the page background is a derived limewash one step deeper              |

Reason for the Deniz light value: Deniz itself reaches 4.43:1 on the sunken surface and fails the
4.5:1 text threshold. Gün Batımı reaches only 1.91:1 on the light ground, so it cannot carry meaning
as a light-scheme fill.

Colour contrast was computed with the WCAG 2.x formula over every text and non-text pair of both
schemes; the token validator in the brand package re-checks them. The full role table lives in
`brand/tokens.json`.

### (b) Typography

| Item     | Specification (section 2)  | Now                                                                                                         |
| -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Families | Fraunces and Nunito Sans   | Bricolage Grotesque only (SIL OFL 1.1, no Reserved Font Name)                                               |
| Cuts     | two families, four weights | one variable family, two optical-size cuts: Display (opsz 96, 600 and 700), Text (opsz 14, 400 and 600)     |
| Width    | not applicable             | pinned at 100, never condensed                                                                              |
| Casing   | not specified              | uppercase only for the one-time code and the literal sample tag; no CSS or code uppercasing of Turkish text |

Verified from the font file: 597 glyphs; Ğ ğ İ ı Ş ş Ç ç Ö ö Ü ü and the lira sign ₺ are in the
character map; the layout table has `tnum`, `lnum` and a `TRK` language system for Turkish
casing; axes are `opsz` 12 to 96, `wght` 200 to 800, `wdth` 75 to 100. The serif carried the dropped
craft look, and one family with an optical-size axis gives a display voice and a calm text face from
one source and one licence.

Rejected candidates for typography: none other than the previous pair were evaluated in the
decision record; no additional candidate list is claimed here.

### (c) Logo

| Item     | Specification (section 2)                                         | Now                                                                                |
| -------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Mark     | a loaf hanging from a hook; the hook doubles as the tail of the a | the rail tag: a rail, a tie and a rounded tag with a punched hole (evenodd cutout) |
| Wordmark | hook-tail letter gimmick                                          | `askıda` in lowercase, Bricolage Display 600 as outlines, dotless ı as drawn       |
| App icon | not specified                                                     | full-bleed accent ground, rail, tie and tag in Un Beyazı                           |

The specification concept "loaf hanging from a hook, hook doubles as tail of the a" is superseded.
The loaf-only image was also rejected because the rail serves a loaf, a soup, a notebook and a
nappy pack equally.

## Consequences

- Design principle: Rail, not hands. Web hero shows the rail with real item counts and never a
  person; app lists are rails with one tag per row; the code ticket is one large tag on one rail.
- Guardrails for all brand, app and web work:
  1. Draw rails, tags and counts; never people, hands, hearts, faces, a loaf alone or any giving
     gesture. SVG ids and file names containing `hand`, `heart` or `person` fail validation.
  2. Use the accent only on tags, the rail counter and the app icon; never as a button, band or
     background fill, as text, or on the light sunken surface.
  3. One primary (ink or cream) button per screen; no outlined buttons and no second filled colour.
  4. Uppercase only for the literal code and the sample tag; no `text-transform: uppercase`, no
     `toUpperCase()` on Turkish strings, no uppercase eyebrows.
  5. Flat surfaces: surface steps and 1 px borders; no textures, gradients, glows, blur, or shadows
     outside sheets and dialogs.
  6. Count items ("12 çorba askıda"), never people; never write "muhtaç", "fakir", "yoksul",
     "yardıma muhtaç" or "ihtiyaç sahibi".
  7. Bundle only the Bricolage Grotesque files; no Google Fonts links, no icons from a CDN, no
     second family.
  8. Every SVG is hand-written and palette-only: no embedded image, external reference, script,
     style, comment or metadata; icons use `currentColor` at 1.75 px; tag holes are evenodd.
- ADR-0001 records the previous fonts in its brand and fonts table. Those rows are superseded by this
  record; ADR-0001 is not rewritten apart from a one-line note.
- The brand package (tokens, fonts, logo set), the app theme and the web styles are updated to
  match in follow-up work. Until then, files of the earlier direction may still exist in a branch.
- ADR-0006 (portfolio delivery scope) is not affected.
