# App store optimization (ASO)

> SAMPLE for a portfolio product. No store account or listing exists; nothing here has been submitted or approved. Counts are Unicode code points. The final copy lives in `store-listing.tr.md` and `store-listing.en.md`.

## 1. Positioning

- One sentence: Kadro organizes a pitch ("halı saha") football match for an amateur team (team, invite, attendance, lineup, fee split) and helps fill a missing player slot ("Eksik Var").
- Audience: captains and players of Turkish amateur pitch matches. Turkish first; the interface is also available in English.
- Competitor-neutral: no competitor names, no comparative claims ("best", "number one"), no rating or download claims. Differentiate by what the app does: team, match and missing-player calls in one place.
- Only implemented features are claimed: teams, invite link and QR, matches, waitlist, lineup, fee split with payment marks, MVP vote, Eksik Var calls and applications, venue directory and reviews, push reminders (needs a push-configured build, to verify), account deletion, Turkish and English interface. Not claimed: live maps, GPS "nearby" search (device location is not read; the `expo-location` plugin is registered but unused), in-app photo upload, in-app subscription purchase (a paywall exists in the app but is unverified against real stores), chat. See `privacy-labels.md` section 2.

## 2. Store constraints

| Field                       | App Store                              | Google Play                            |
| --------------------------- | -------------------------------------- | -------------------------------------- |
| Name or title               | 30                                     | 30                                     |
| Subtitle                    | 30                                     | none                                   |
| Short description           | none                                   | 80                                     |
| Promotional text            | 170 (editable without a new review)    | none                                   |
| Keywords                    | 100 total, comma-separated             | none (the full description is indexed) |
| Description                 | 4000                                   | 4000                                   |
| What's new or release notes | 4000                                   | 500                                    |
| Screenshots                 | 6.9-inch iPhone set required, up to 10 | at least 2 phone screenshots, up to 8  |

Rules followed: no keyword stuffing, no words repeated between name, subtitle and keyword field, no emoji, no third-party trademarks, no price or "free" claims in the title.

## 3. Keywords

Turkish (primary locale `tr-TR`)

| Role                        | Terms                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Name and subtitle (indexed) | kadro, halı, saha, eksik, oyuncu, kur, bul                                                                |
| Keyword field (96 / 100)    | halısaha, maç organize, futbol, takım, maç bul, oyuncu bul, kaptan, ücret paylaş, saha rehberi, kadro kur |
| Description themes          | halı saha maçı, eksik oyuncu, bekleme listesi, kadro dizilişi, saha ücreti paylaşımı, MVP                 |

English (secondary locale `en-US`)

| Role                        | Terms                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Name and subtitle (indexed) | kadro, pitch, match, organizer, build, squad, fill, gaps                                                        |
| Keyword field (98 / 100)    | football, soccer, team, squad, lineup, match, organizer, pitch, player, captain, rsvp, fee split, halisaha, 5v5 |
| Description themes          | amateur football, missing player, venue guide, attendance                                                       |

Notes: "halısaha" (one word) is a common spelling variant worth a keyword slot. The terms are hypotheses; re-evaluate with store search data once a real listing exists (none today).

## 4. Title, subtitle, short description

| Locale | Name (30)                           | Subtitle (30)                    | Play short description (80)                                                |
| ------ | ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| tr     | Kadro: Halı Saha, Eksik Oyuncu (30) | Kadroyu kur, eksiği bul (23)     | Halı saha maçını kur, kadroyu tamamla, eksik oyuncuyu bul. (58)            |
| en     | Kadro: Pitch Match Organizer (28)   | Build your squad, fill gaps (27) | Organize pitch matches, complete your squad and find missing players. (69) |

The product spec proposes the title "Kadro: Halı Saha & Eksik Oyuncu". That is 31 characters, one over the 30 limit of both stores, so the comma form above replaces the ampersand.

## 5. Screenshot plan

Six frames, portrait, light theme (the app follows the system theme, so a dark set is optional). Use demo fixture data only (fictional team, venue and player names); no real people, venues or phone numbers. Captions are overlay text, kept short.

| #   | Screen                                            | Turkish caption                      | English caption               |
| --- | ------------------------------------------------- | ------------------------------------ | ----------------------------- |
| 1   | Matches tab with an upcoming match and slot count | Maçını kur, kadro hazır              | Set up the match, squad ready |
| 2   | Team screen with invite link and QR code          | Davet linki ya da QR ile takıma ekle | Add players by link or QR     |
| 3   | Match detail: attendance and lineup               | Kim geliyor, tek bakışta gör         | See who is coming at a glance |
| 4   | Fee split with payment marks                      | Saha ücretini adil paylaştır         | Split the pitch fee fairly    |
| 5   | Eksik Var list and an open call                   | Eksik oyuncunu bul                   | Find your missing player      |
| 6   | Venue guide with a venue detail                   | Sahaları incele, yorumları oku       | Browse venues, read reviews   |

Production notes: capture from a real build or simulator with seeded fixtures; show no ratings, awards or device-brand logos in the artwork. Frames 1 and 2 carry the conversion weight (the first ones shown in search results).

## 6. Assets and metadata checklist (all pending)

- App icon (1024 px, no transparency): derived from `packages/brand`, not rendered here.
- Feature graphic for Google Play (1024x500): not made.
- Age rating and content questionnaire: no user-to-user chat; user reviews and free-text application messages exist; moderators can remove reviews and open calls through the admin panel (ADR-0067, ADR-0068), there is no user report queue.
- Category: Sports.
- Support URL, privacy URL, marketing URL: SAMPLE placeholders, see the table in the listing files.
