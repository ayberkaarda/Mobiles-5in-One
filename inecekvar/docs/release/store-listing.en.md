# Store listing (en, secondary locale)

Status: copy ready for review; **not submitted** (no developer accounts, ADR-0005). Turkish is the
primary locale (`store-listing.tr.md`); this file is the English translation for the secondary
store locale, as specification section 0 asks ("tr-TR primary, en secondary"). The same rules
apply: no fare numbers, no named real lines, no claim of official data or of covered cities, no
contact address that does not exist. Checked by `node ops/release/check-release-docs.mjs`.

## 1. Title: owner decision

Same decision as the Turkish listing: the specification title (36 characters) is over the store
cap of 30, and Ayberk picks the store title. The brand name stays Turkish in every locale.

| Field id         | Value                                  | Limit | Note                                                        |
| ---------------- | -------------------------------------- | ----- | ----------------------------------------------------------- |
| `title.spec`     | `İnecek Var: Dolmuş & Minibüs Hatları` | n/a   | Specification section 2, 36 characters, over the cap.       |
| `title.option-a` | `İnecek Var: Dolmuş & Minibus`         | 30    | Mirrors Turkish option a with the English word for minibüs. |
| `title.option-b` | `İnecek Var: Minibus Lines`            | 30    | Mirrors Turkish option b.                                   |
| `title.option-c` | `İnecek Var`                           | 30    | Name only, same as Turkish option c.                        |

## 2. Short fields

| Field id   | Value                                                           | Limit | Store field                   |
| ---------- | --------------------------------------------------------------- | ----- | ----------------------------- |
| `subtitle` | `Lines, stops, fares; offline`                                  | 30    | App Store subtitle            |
| `short`    | `Dolmuş and minibus lines, stops and fares. Works offline too.` | 80    | Google Play short description |
| `keywords` | `minibus,dolmus,bus line,stop,offline,transit,Istanbul,Izmir`   | 100   | App Store keyword field       |
| `promo`    | `Where does the dolmuş go? The neighbourhood knows.`            | 170   | App Store promotional text    |

## 3. Full description

<!-- full-description:start -->

Where does the dolmuş go? The neighbourhood knows.

İnecek Var is a line guide for the dolmuş, minibus and shuttle routes that have no official data, mapped together by the people who ride them. It works offline too.

FIND YOUR LINE
• Search by line code, by name or by a place name.
• Each line page shows the route, the ordered stops, the fare with its update date, operating hours, payment methods (cash, card, İstanbulkart), how to hail it and when it was last verified.
• Allow location and you see the stops near you and the lines that pass them.

FROM A TO B
• Type where you start and where you go, or tap the map.
• Route suggestions with at most 2 transfers and at most 300 m of walking between stops, with an estimated fare.

NO SIGNAL? NO PROBLEM.
• Download a city pack once; line search and line and stop pages open without internet.
• The free plan includes one city pack; Plus unlocks more.

DID THIS LINE CHANGE? TELL US.
• Create an account, record your ride, mark stops on the way and propose fares, hours and notes.
• Add a photo of the fare table or the stop sign if you like; its location metadata is removed.
• A moderator reviews every proposal. Nobody can approve their own.

PRIVACY
• No ads, no tracking.
• Location is used only while the app is open and only after you allow it; never in the background.
• Your ride recording is private: only you and the moderators see it. The first and last 200 metres never reach the map, and the raw recording is deleted 30 days after the line is published.
• Delete your account in the app; after a 7-day grace period your personal data is erased.

PLUS
• Unlimited offline cities and a supporter badge, as an in-app purchase. The web version stays free.

Line data comes from contributors and is not an official source. Check the last update date before you set off.

<!-- full-description:end -->

## 4. What's new (first release)

<!-- whats-new:start -->

First release: line and stop search, A to B route suggestions, offline city packs, ride recording and line proposals.

<!-- whats-new:end -->

## 5. Screenshots

The same six files as the Turkish listing. The app starts in Turkish and switches to English in
Ayarlar (`core/language.service.ts`: "Turkish by default, English on request");
`docs/screenshots/phase3/ayarlar-en-light.png` is the only English capture in
the repository, so an English screenshot set has to be taken before the English listing goes live.
Until then the store shows the Turkish set for both locales.

| #   | File                                                      | Caption (en)                                    |
| --- | --------------------------------------------------------- | ----------------------------------------------- |
| 1   | `docs/screenshots/phase3/ara-results-light.png`           | Find your line by code, name or place           |
| 2   | `docs/screenshots/phase3/hat-detail-light.png`            | Stops, fare and hours on one page               |
| 3   | `docs/screenshots/phase3/planla-results-light.png`        | Suggestions from A to B                         |
| 4   | `docs/screenshots/phase3/packs-installed-light.png`       | Download a city pack, open it offline           |
| 5   | `docs/screenshots/phase3/katki-kayit-recording-light.png` | Record your ride, map the line together         |
| 6   | `docs/screenshots/phase3/ayarlar-hesap-light.png`         | Your account and data are yours: delete anytime |

The sample-data and size caveats of `store-listing.tr.md` section 5 apply unchanged.

## 6. Category, rating and URLs

Same answers as `store-listing.tr.md` sections 6 to 8. The URLs are the Turkish pages; no English
web pages exist yet (`docs/seo/checklist.md`, "English pages and `hreflang en`": open).
