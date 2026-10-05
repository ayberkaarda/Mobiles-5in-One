# App screenshots

Twenty-three Android captures of the app running on the `Pixel_8` emulator (Android only) against
the local stack. All 23 come from one run of the capture script on 2026-10-05 between 12:23:30Z
and 12:32:07Z. They are the raw device frames (1080x2400, no device frame, no retouching),
downscaled to 540x1200 for the READMEs. 21 are in the light scheme, two are in the dark scheme
(22, 23). 22 are in Turkish, the default language, and one is in English (24).

Every shop, address, person name and amount on screen is sample data. Shop and person names carry
the `[ÖRNEK]` label, and e-mail addresses use the reserved `example.test` domain. No screenshot
shows a real person. The recipient screens show only the code tag, never an identity.

## Files

| # | File | Mode | Screen | Caption (tr) | Caption (en) |
| --- | --- | --- | --- | --- | --- |
| 1 | `01-recipient-nearby.png` | Recipient | Nearby list | Yakındaki dükkânlarda askıda ne var, hesap açmadan gör. | See what is on the hook at nearby shops, no account needed. |
| 2 | `02-recipient-shop.png` | Recipient | Shop page | Doğrulanmış dükkân, askıdaki ürünler, tek dokunuşla askıdan al. | A verified shop, the items on the hook, one tap to take one. |
| 3 | `03-recipient-code.png` | Recipient | One-time code and QR | Tek kullanımlık kod: dükkânda göster, soru sorulmadan al. | A one-time code: show it at the shop, no questions asked. |
| 4 | `04-donor-donate.png` | Donor | Item and quantity | Dükkânı ve ürünü seç, adedi belirle, askıya bırak. | Pick a shop and an item, set the quantity, put it on the hook. |
| 5 | `05-donor-receipt.png` | Donor | Donation receipt | Ödeme onaylanınca ürünler askıya asılır, makbuz e-postanda. | Once the payment is confirmed the items hang on the hook; the receipt is in your inbox. |
| 6 | `06-merchant-redeemed.png` | Merchant | Code confirmed | Esnaf kodu okutur, ürünü verir, kayıt tek adımda kapanır. | The shopkeeper scans the code, hands over the item, and the record closes in one step. |
| 7 | `07-recipient-onboarding.png` | Recipient | Before the first code | Hesap yok, ad yok: cihaza yalnızca anonim bir kimlik verilir. | No account, no name: the device only gets an anonymous identity. |
| 8 | `08-recipient-map.png` | Recipient | Nearby map | Askıdaki ürünler haritada, dükkân dükkân. | The items on the hook on a map, shop by shop. |
| 9 | `09-recipient-settings.png` | Recipient | Settings without an account | Dil, görünüm ve gizlilik; hesap gerekmez. | Language, appearance and privacy; no account needed. |
| 10 | `10-donor-discover.png` | Donor | Verified shops in a district | İlçeni seç, doğrulanmış dükkânları gör. | Pick your district and see the verified shops. |
| 11 | `11-donor-shop.png` | Donor | Shop page | Dükkânın askıya bırakılabilecek ürünleri ve fiyatları. | The items a shop accepts on the hook, with prices. |
| 12 | `12-donor-history.png` | Donor | Donation history | Bağışların ve askıdaki karşılıkları tek listede. | Your donations and what they put on the hook, in one list. |
| 13 | `13-donor-impact.png` | Donor | Home with impact | Bugün kaç ürün askıya bırakıldı, kaçı alındı. | How many items went on the hook today, and how many were taken. |
| 14 | `14-merchant-onboarding.png` | Merchant | Shop registration, address and pin | Dükkânını kaydet: adres ve haritada konum. | Register your shop: address and a pin on the map. |
| 15 | `15-merchant-catalog.png` | Merchant | Catalog | Ürün, fiyat ve günlük sınır; tek dokunuşla aç ya da kapat. | Item, price and daily cap; switch each on or off with one tap. |
| 16 | `16-merchant-home.png` | Merchant | Shop home | Doğrulanmış dükkânın paneli: kod okut, verilenler, ürünler. | The verified shop's panel: scan a code, the log, the items. |
| 17 | `17-merchant-redeem.png` | Merchant | Redeem by code | Karekod okunmazsa kodu elle yaz. | If the QR does not scan, type the code. |
| 18 | `18-merchant-redemptions.png` | Merchant | Redemption log | Son 30 günde askıdan verilenler, gün gün. | What was handed over in the last 30 days, day by day. |
| 20 | `20-donor-settings.png` | Donor | Settings with an account | Hesap, dil, görünüm; hesabı silme bağlantısı burada. | Account, language, appearance; the account deletion link is here. |
| 21 | `21-donor-delete-account.png` | Donor | Delete account | Hesabını sil: 7 gün içinde giriş yaparsan silme iptal olur. | Delete your account: signing in within 7 days cancels the deletion. |
| 22 | `22-merchant-home-dark.png` | Merchant | Shop home, dark scheme | Koyu görünümde esnaf paneli. | The merchant panel in the dark scheme. |
| 23 | `23-merchant-redemptions-dark.png` | Merchant | Redemption log, dark scheme | Koyu görünümde verilenler kaydı. | The redemption log in the dark scheme. |
| 24 | `24-merchant-catalog-en.png` | Merchant | Catalog, English | İngilizce arayüzde ürünler ekranı. | The catalog screen in English. |

Not captured:

- 19, merchant payouts: **not captured: the screen shows an error on this build.** The payouts
  list shows "Sunucudan beklenmeyen bir yanıt geldi" (the server sent an unexpected answer)
  because the app's payout model reads `day` and `status`, while the server sends `date` and
  `settlement.status` as described in `docs/api/openapi.yaml` (`PayoutLedgerDay`). This is an app
  bug, recorded but not fixed in this change. The number 19 is left free for that screen.
- iOS: **not captured: no macOS, no simulator.** Every image is from the Android emulator.

Notes on what the images show:

- 01, 10: the list shows several `[ÖRNEK]` bakeries at the same spot in Beşiktaş. Earlier runs of
  the capture script on the same local database created them. Every one is sample data.
- 03, 17: the code and QR belong to a sample reservation on the local stack. 06 shows that
  reservation redeemed; on the emulator the code was typed (17), not scanned.
- 05: the amounts are the sample split (`%5 (örnek oran)` commission), not a pricing decision. The
  payment step between 04 and 05 ran on the local fake checkout page; the real payment provider
  was **not exercised: no sandbox account**.
- 08, 14: the map tiles are OpenStreetMap tiles loaded live. These two images are reduced to 256
  colours to stay under the 250 KB budget. The other 21 are only downscaled and losslessly
  recompressed.
- 12, 13: the platform totals are the local stack's numbers for the day. The donor's own count
  ("ürün askıya bıraktın") is refreshed hourly, so it can lag behind the donation shown.
- 17: the camera preview is a blank box. On the emulator the scanner is replaced by manual entry.
  The run also keeps the sign-in tokens in memory and hands the document step a small in-memory
  image. Everything else is the real app against the real local server.
- 20, 21: the account belongs to the run's sample donor (`example.test` address). 21 shows the
  form only; the deletion is not submitted.
- 22, 23: the dark scheme is set inside the run; the system setting stays light.
- 09, 20: the settings say that push notifications are not configured in this build. That is the
  state of the local stack.
- The gesture handle of the emulator overlaps the bottom edge of some screens. The captures are
  not retouched.

## Capture command

The script lives in the app. Run it from `askida/app` with the local stack and the emulator
running (see `docs/ops/env.md` and ADR-0040 for the stack):

```sh
bash integration_test/capture_screenshots.sh
```

It switches the emulator to the light scheme (`cmd uimode night no`), puts the status bar into
demo mode (09:41), runs `integration_test/screenshots_test.dart` (one sample story on a fresh
`[ÖRNEK]` shop, plus the other screens above), and saves each screen with the raw device
capture:

```sh
adb exec-out screencap -p > docs/release/screenshots/<NN>-<mode>-<slug>.png
```

The raw 1080x2400 frames were then downscaled with Pillow (Lanczos, 540x1200) and saved with
`optimize=True`. 08 and 14 were also reduced to a 256-colour palette:

```sh
python -c "import glob; from PIL import Image; [Image.open(f).convert('RGB').resize((540, 1200), Image.LANCZOS).save(f, optimize=True) for f in glob.glob('docs/release/screenshots/*.png')]"
```

Store uploads: the files here are sized for the READMEs. For a store upload, take fresh raw
captures and check them against the store's current size and aspect-ratio rules (not verified
here). The App Store needs its own iPhone simulator sets, which were not captured (see above).
