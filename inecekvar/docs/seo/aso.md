# App store optimisation (ASO) notes

Status: final for the first submission except the owner decisions named below (package 6F,
ADR-0056); no store account or listing exists yet. Primary locale `tr-TR`, secondary `en`. The
submission copy lives in `docs/release/store-listing.tr.md` and `docs/release/store-listing.en.md`;
this file keeps the reasoning and must stay consistent with them
(`node ops/release/check-release-docs.mjs` checks limits and screenshot paths). Entity facts come
from `apps/web/src/content/facts.ts`, the same module that feeds the web pages, `llms.txt` and the
JSON-LD.

## Listing text

| Field | Value | Length | Note |
| ----- | ----- | ------ | ---- |
| Title (specification, section 2) | `İnecek Var: Dolmuş & Minibüs Hatları` | 36 | Over the 30 character limit of both stores. See "Open decision" below. |
| Subtitle (App Store) / short line | `Hat, durak, ücret; çevrimdışı` | 29 | Within 30. |
| Keywords (App Store, 100 character field) | `dolmuş,minibüs,hat,durak,toplu taşıma,İstanbul minibüs,İzmir dolmuş,servis hattı,güzergâh` | 89 | Turkish, as the specification lists them. English secondary locale: `minibus,dolmus,bus line,stop,offline,transit,Istanbul,Izmir` (58). |
| Short description (Google Play, 80) | `Dolmuş ve minibüs hatları, durakları, ücreti; çevrimdışı da çalışır.` | 68 | |
| Tagline (brand) | `Dolmuş nereden geçer? Mahalle bilir.` | 36 | Not a store field; used in the first lines of the long description. |

### Open decision: title length

The specification fixes the store title as `İnecek Var: Dolmuş & Minibüs Hatları` (36
characters). The App Store and Google Play both cap the title at 30. The identity table says not
to re-brainstorm, so this file records the conflict instead of choosing. Both title forms stay on
the table; the owner picks one before the first submission:

| Option | Title | Length | Trade-off |
| ------ | ----- | ------ | --------- |
| Specification | `İnecek Var: Dolmuş & Minibüs Hatları` | 36 | Not submittable as it is (over 30). Kept for the PWA manifest and `FACTS.storeTitle`. |
| a | `İnecek Var: Dolmuş & Minibüs` | 28 | Keeps both head keywords in the indexed title. |
| b | `İnecek Var: Dolmuş Hatları` | 26 | The 4D suggestion; "minibüs" moves to the subtitle and keywords. |
| c | `İnecek Var` | 10 | Name only; all keywords in subtitle and keyword field. |

English listing options mirror these (`docs/release/store-listing.en.md`). Nothing is submitted
until this is decided.

### Final keyword set

Turkish keyword field (App Store, 100): `dolmuş,minibüs,hat,durak,toplu taşıma,İstanbul minibüs,İzmir dolmuş,servis hattı,güzergâh`
(89 characters, 100 UTF-8 bytes: exactly at the cap if the store counts bytes). This is the
specification list unchanged. If title option a is chosen, `dolmuş` and `minibüs` are already
indexed through the title and may give their room to `servis` or `minibüs hattı`; that swap is
part of the title decision, not made here.

English keyword field: `minibus,dolmus,bus line,stop,offline,transit,Istanbul,Izmir` (59).

Google Play has no keyword field; the short description and the first lines of the full
description carry the same words (dolmuş, minibüs, hat, durak, çevrimdışı).

### Long description

The submission text (Turkish and English) is section 3 of the two store listing files; the 4D
draft that stood here was folded into it. Constraints for any later edit: no fare numbers, no named lines, no claim of official data, no
claim of cities with published lines unless the city page shows them.

## Screenshots (6, Turkish captions)

Files are the phase 3 captures (light theme, 720 x 1600). The same list, in the same order, is
section 5 of both store listing files.

| # | File | Caption (tr) | Caption (en) |
| - | ---- | ------------ | ------------ |
| 1 | `docs/screenshots/phase3/ara-results-light.png` | Kod, ad ya da yer adıyla hattını bul | Find your line by code, name or place |
| 2 | `docs/screenshots/phase3/hat-detail-light.png` | Duraklar, ücret ve saatler tek sayfada | Stops, fare and hours on one page |
| 3 | `docs/screenshots/phase3/planla-results-light.png` | A noktasından B noktasına öneriler | Suggestions from A to B |
| 4 | `docs/screenshots/phase3/packs-installed-light.png` | Şehir paketini indir, internetsiz aç | Download a city pack, open it offline |
| 5 | `docs/screenshots/phase3/katki-kayit-recording-light.png` | Yolculuğunu kaydet, hattı birlikte haritala | Record your ride, map the line together |
| 6 | `docs/screenshots/phase3/ayarlar-hesap-light.png` | Hesabın ve verin senin: istediğinde sil | Your account and data are yours: delete anytime |

Caveats before upload:

- These captures show the sample city ("[ÖRNEK]" labels, "Örnek veri" badge). Store screenshots
  must either keep the sample label visible or be retaken against real published data; a store
  listing must not present sample data as real transport data.
- All six are 720 x 1600 (ratio 2.22). Google Play's screenshot rule caps the long side at twice
  the short side and the App Store accepts only its device sizes, so the set has to be retaken or
  cropped; the check script warns about it.
- The phase 4 captures (`docs/screenshots/phase4/`) are web staff screens and are not used in a
  store listing.

## Data Safety (Google Play) and App Privacy (Apple), consistent with the app

The full data-type mapping, the processors and the mismatches found in package 6F are in
`docs/release/privacy-labels.md`; this table is the summary and was corrected there (mismatches
M1 to M3 and M10). Basis: ADR-0022 (traces), ADR-0026 (deletion), ADR-0021 (nearby stops),
ADR-0050 (purchases), `/gizlilik` on the web.

| Topic | Answer | Source |
| ----- | ------ | ------ |
| Ads | None | `/sss`, `/gizlilik`; no ad SDK in the app |
| Third-party analytics or tracking | None; no tracking domains, no advertising identifier | no such SDK in `apps/mobile` |
| Location | Only while the app is in the foreground and the user allowed it; never in the background, not shared, not used for advertising. Approximate for nearby stops (low-accuracy fix rounded to 3 decimals for `GET stops/near`; with an installed city pack computed on the device). Precise for ride recording the user starts, for the planner "Konumumu kullan" (4 decimals in `POST plan`, not stored with the user) and for a stop position in a proposal. Query strings and precise coordinates are not logged. | ADR-0021, ADR-0022, ADR-0034, `docs/release/privacy-labels.md` |
| Ride traces | User content. Private to the user and moderators, never in a public response or export. Derived geometry drops the first and last 200 m. The raw trace is deleted 30 days after the derived version is published (30 days after upload when unused) and at once on account deletion. | ADR-0022, ADR-0026 |
| Account data | Email address (sign-in), optional display name, password stored only as an Argon2id hash; favourites synced for signed-in users; the account id is also the RevenueCat app user id. | ADR-0007, ADR-0011, ADR-0050 |
| Photos | Optional fare table or stop sign photo; re-encoded, metadata removed. | ADR-0023 |
| Contributions | Approved contributions stay under the licence with the author removed after deletion ("silinmiş katkıcı"). | ADR-0026 |
| Deletion | In the app (Ayarlar, Hesap): immediate deactivation, 7 day grace, then hard delete. A web deletion form does not exist yet; the store field "data deletion URL" points to `/hesap-silme`, which says so. Google Play expects a working web request path, so this is a submission blocker until the owner decides (`docs/release/legal-open-items.md` L7). | ADR-0026, `/hesap-silme` |
| Data encrypted in transit | Yes (HTTPS only, no cleartext traffic) | `capacitor.config.ts`, Android manifest |
| Purchases | Purchase history: Plus through the stores and RevenueCat (native only); the API keeps product id, status and expiry per account; RevenueCat is a service provider, the subscriber is deleted at account erasure. No payment data reaches the app or the API. | ADR-0024, ADR-0050 |
| Diagnostics | None collected: no crash or analytics SDK in the app or the web; the API error reporter is inactive without a DSN and its package. | ADR-0054 |

Not exercised: the real store consoles (no developer accounts), the Apple privacy nutrition
label questionnaire, and the Play Data Safety form submission. Re-check every row against the
shipped build before submitting.

## Entity consistency

The listing name, description sentence and tagline must equal `FACTS.name`,
`FACTS.description` and `FACTS.tagline`. A unit test (`apps/web/src/content/content.spec.ts`)
keeps the web side and `llms.txt` aligned; the store text is copied by hand and reviewed against
the same file. Package 6F review: the second paragraph of the Turkish full description is
`FACTS.name` followed by the `FACTS.description` sentence (first letter lower-cased after the
comma), the promotional text is `FACTS.tagline`, and the specification title equals
`FACTS.storeTitle`; the English listing translates them.
