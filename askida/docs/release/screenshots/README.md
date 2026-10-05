# Store screenshots

Six raw Android captures of the app running on the `Pixel_8` emulator against the
local stack. Light scheme only, 1080x2400, no device frame, no editing. Every shop, address and
amount on screen is sample data and is labelled `[ÖRNEK]`. No screenshot shows a person; the
recipient screens show the code tag only, never an identity.

Captured on 2026-10-04 between 19:18:31Z and 19:24:07Z (about 6 minutes, inside the 45-minute
limit set for the capture). Not captured: none; all six exist.

| # | File | Screen | Caption (tr) | Caption (en) |
| --- | --- | --- | --- | --- |
| 1 | `01-recipient-nearby.png` | Askıdan al: nearby list | Yakındaki dükkânlarda askıda ne var, hesap açmadan gör. | See what is on the hook at nearby shops, no account needed. |
| 2 | `02-recipient-shop.png` | Shop page with items on the hook | Doğrulanmış dükkân, askıdaki ürünler, tek dokunuşla askıdan al. | A verified shop, the items on the hook, one tap to take one. |
| 3 | `03-recipient-code.png` | One-time code and QR | Tek kullanımlık kod: dükkânda göster, soru sorulmadan al. | A one-time code: show it at the shop, no questions asked. |
| 4 | `04-donor-donate.png` | Askıya bırak: item and quantity | Dükkânı ve ürünü seç, adedi belirle, askıya bırak. | Pick a shop and an item, set the quantity, put it on the hook. |
| 5 | `05-donor-receipt.png` | Donation receipt | Ödeme onaylanınca ürünler askıya asılır, makbuz e-postanda. | Once the payment is confirmed the items hang on the hook; the receipt is in your inbox. |
| 6 | `06-merchant-redeemed.png` | Merchant code confirmation | Esnaf kodu okutur, ürünü verir, kayıt tek adımda kapanır. | The shopkeeper scans the code, hands over the item, and the record closes in one step. |

Notes on what the images show:

- 03: the code and QR belong to a sample reservation that was already redeemed on the local stack.
  The gesture handle of the emulator overlaps the last footer line in the raw capture; the
  captures are not retouched.
- 05: the amounts are the sample split (`%5 (örnek oran)` commission), not a pricing decision.
- The payment step between 04 and 05 ran on the local fake checkout page; the real payment
  provider was **not exercised: no sandbox account**.
- Android only. No iOS screenshots exist: **not captured: no macOS, no simulator**.

## Capture command

The script lives in the app, and is run from `askida/app` with the local stack and the emulator
running (see `docs/ops/env.md` and ADR-0040 for the stack):

```sh
bash integration_test/capture_screenshots.sh
```

It switches the emulator to the light scheme (`cmd uimode night no`), puts the status bar into
demo mode (09:41), walks the story on a fresh `[ÖRNEK] Mahalle Fırını`, and saves each screen with
the raw device capture:

```sh
adb exec-out screencap -p > docs/release/screenshots/<NN>-<screen-slug>.png
```

Store requirements: Google Play accepts 1080x2400 phone screenshots as they are (2 to 8 images).
The App Store needs its own device sizes (6.9 inch and 6.5 inch sets) captured on an iPhone
simulator: not captured, see above.
