# App store optimisation (spec section 7)

Facts for the two store listings. Nothing here is published: no Apple or Google developer
account exists for this project (ADR-0006), so every store step is **not exercised: no store
accounts**. The listing copy is in `docs/release/store-listing.tr.md` and `.en.md`; the privacy
answers are in `docs/release/privacy-labels.md`; the screenshots are described in
`docs/release/screenshots/README.md`.

## Identity

| Field | Value | Limit |
| --- | --- | --- |
| Store title (both stores) | Askıda: Askıda Ekmek & İyilik | 30 characters (Play title and App Store name): the title is 29 |
| Subtitle (App Store) | Askıya bırak, askıdan al | 30 characters: 24 |
| Application id / bundle id | `app.askida.mobile` | |
| Category | Lifestyle (both stores; proposal) | |
| Primary language | Turkish (tr-TR) | |
| Secondary language | English (en) | |
| Age rating | Everyone / 4+: no public user content, no chat, no ads | questionnaire not submitted: no accounts |
| Price | Free; no in-app purchases (donations are payments for goods at shops, made on the payment provider's page, not in-app purchases) | |

The category is a proposal. Whether a payment made inside the app for goods collected in a
shop falls outside the stores' in-app purchase rules is a store-review question that cannot be
answered without a submission: **not exercised: no store accounts**.

## Keywords

| Language | Keywords | Length |
| --- | --- | --- |
| Turkish (primary, App Store keyword field, comma separated, no spaces after commas) | askıda ekmek,bağış,iyilik,esnaf,yardımlaşma,askıda çorba,kırtasiye yardımı,mahalle | 82 |
| English (secondary) | pay it forward,local shops,donate bread,neighbourhood,community,kindness | 72 |

The App Store keyword field allows 100 characters. The Turkish list is 82 characters, the
English list 72. Words already in the title or subtitle (askıda, ekmek, iyilik, askıya, askıdan)
are not repeated by the stores' ranking, but the phrase forms above are kept because they are
what people type. Google Play has no keyword field: the same words appear naturally in the
short and full descriptions.

## Screenshots and captions (Turkish, six, no recipient imagery)

Raw 1080x2400 Android captures in `docs/release/screenshots/`. Every shop and address on
screen is a labelled sample (`[ÖRNEK]`). No screenshot shows a person, and the recipient screens
show only the code tag, never an identity.

| # | File | Caption (tr) | Caption (en) |
| --- | --- | --- | --- |
| 1 | `01-recipient-nearby.png` | Yakındaki dükkânlarda askıda ne var, hesap açmadan gör. | See what is on the hook at nearby shops, no account needed. |
| 2 | `02-recipient-shop.png` | Doğrulanmış dükkân, askıdaki ürünler, tek dokunuşla askıdan al. | A verified shop, the items on the hook, one tap to take one. |
| 3 | `03-recipient-code.png` | Tek kullanımlık kod: dükkânda göster, soru sorulmadan al. | A one-time code: show it at the shop, no questions asked. |
| 4 | `04-donor-donate.png` | Dükkânı ve ürünü seç, adedi belirle, askıya bırak. | Pick a shop and an item, set the quantity, put it on the hook. |
| 5 | `05-donor-receipt.png` | Ödeme onaylanınca ürünler askıya asılır, makbuz e-postanda. | Once the payment is confirmed the items hang on the hook; the receipt is in your inbox. |
| 6 | `06-merchant-redeemed.png` | Esnaf kodu okutur, ürünü verir, kayıt tek adımda kapanır. | The shopkeeper scans the code, hands over the item, and the record closes in one step. |

Screen 3 shows a code and a QR of a sample reservation that was already redeemed on the local
stack. Screen 5 shows the sample commission split (`%5 (örnek oran)`): the rate is a sample,
not a pricing decision.

## Data Safety (Google Play) and App Privacy (Apple) statements

The spec's ASO paragraph asks for the statement "anonymous mode collects no personal data".
That sentence is **not used** here. It is too strong: in anonymous mode the server still
processes an `anon_id` (a random identifier bound to the install), an attestation verdict, the
client IP address (in transit, in proxy logs and in rate-limiter keys) and an approximate
location for the duration of one request. None of these is a name, an e-mail address, a phone
number, a precise location or a hardware identifier, but they are processed and the stores'
forms ask about them. The corrected statements, which the listing uses:

- **Anonymous mode (taking an item):** no account, no name, no e-mail address, no phone number,
  no precise location, no rating of the person. The app uses an approximate location (rounded to
  two decimals, about one kilometre) only to show nearby shops; the position is sent with that
  request and is not stored. A random device identifier (`anon_id`) and the device's integrity
  verdict are kept to enforce daily limits and to stop abuse. The person can delete them from
  the app ("Verilerimi sıfırla"); daily counters and the device link on past reservations are
  purged after 30 days.
- **Donor and merchant accounts:** e-mail address and display name for the account, the
  donation history for receipts, and for merchants the shop details and verification documents.
  Card data is entered on the payment provider's page and is never received by the app or the
  server.
- **Location:** "approximate, nearby shops only" for recipients. Donors and merchants may share
  a precise position, used the same way (one request, not stored; a merchant's shop pin is the
  shop's own published address).

The element-by-element table with the code or test that proves each row is
`docs/release/privacy-labels.md`; the deviation from the spec's wording is recorded in
ADR-0063 (written in the documentation wave).

## What a real submission still needs

| Step | Status |
| --- | --- |
| Developer accounts (Play Console, Apple Developer Program) | not exercised: no accounts |
| Upload key, Play App Signing, iOS certificates and profiles | not exercised: no accounts, no macOS (see `docs/release/signing.md`) |
| iOS screenshots (6.9 inch and 6.5 inch sets) | not captured: no macOS, no simulator; iOS is not claimed verified |
| Feature graphic (Play, 1024x500) and app preview video | not produced; not in the Phase 6 scope |
| Legal pages (`/gizlilik`, `/kvkk-aydinlatma`) as the privacy policy URL | sample texts, legal review not done (ADR-0051) |
| Store listing text review by a native editor | not done |
