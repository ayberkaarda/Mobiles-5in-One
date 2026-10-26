# Design concept: the morning round

Patika is about walking the same streets every day with a bag of food and a bottle of water. The look is built on that walk, not on a product template.

## The one bold element: the trail

The dotted path from the logo is the only expressive device. It appears as:

- the hero illustration on the web: a drawn Moda neighbourhood (Kum blocks, Kar streets, blue enamel street plates like the real ones in İstanbul) with a volunteer's route threading four stations. It draws itself once on load (1.6 s, skipped with reduced motion);
- the timeline of "Bir sabah turu": four timed stops on a vertical dotted line. Times make it a true sequence, so the order carries meaning;
- the Harita tab in the app, drawn from the same art with the same tokens.

Everything else stays quiet: Kar Beyazı surface, Kaldırım Taşı text, Turuncu Tekir only for the trail and the "Beslendi" action, Nane only for water and health, Acil only for urgent help.

## Subject-specific forms

- **Station pins** encode state: orange bowl with a green check (fed), green drop (water), dashed orange ring with an empty bowl ("mama bitti"), red cross (urgent).
- **Collar tags** for adoption listings: a tag outline with a hole and a split ring, the animal's name set large. No stock photo grid.
- **The pavement band**: the urgent help section and the app's Acil tab sit on Kaldırım Taşı, the darkest token, so urgency reads without alarm graphics.
- **Impact as a sentence**: "Geçen hafta ... 1.284 kap mama ve su bırakıldı" instead of a stat-card row, with a methodology note under it.

## What was avoided on purpose

No gradient washes, no identical card grid, no uppercase eyebrow labels, no arrow-suffixed links, no stock illustrations. Radii follow hierarchy: pills for actions and chips, 24 for sheets and panels, the collar tag's own shape for listings.

## Accessibility floor

Text colors meet WCAG AA on their surfaces (see `brand/brand.md`). Visible focus ring in Boncuk Mavisi, skip link, `prefers-reduced-motion` respected, no horizontal scroll at 390 px.

## Screenshots

`screenshots/` holds real captures: the web home at 1440 and 390 px (full page and hero), and the Android app on a Pixel 8 emulator (`android-harita`, `android-sahiplen`, `android-acil`, `android-profil`). The `admin-*` captures show the admin console (TOTP step, moderation queue, CSV preview with row errors, user actions with step-up) against a local API with seeded sample data.
