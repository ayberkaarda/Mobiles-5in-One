# App screenshots

Three Android captures of the debug build of the Cetele app, taken on 2026-10-11 on the `Pixel_8`
Android emulator (Android 17, API 37; an emulator, not a physical device), signed in against a
live server running locally. They are the raw device frames (1080x2400, no device frame, no
retouching), downscaled to 540x1200 and reduced to a 256-colour palette to keep each file small.
The status bar is in the emulator's demo mode (09:41).

The server was the Spring Boot server of this repository, started from source with
`./gradlew bootRun` (profile `local`, JDK 21) on port 60080, with PostgreSQL and MinIO from
`cetele/docker-compose.yml`. It ran with the local stand-ins described in
[`docs/ops/env.md`](../../ops/env.md): `CETELE_SMS_PROVIDER=fake` (no SMS was sent),
`CETELE_INTEGRITY_MODE=fake` (the debug app sends the `fake.ok` token), `CETELE_BILLING_MODE=fake`
and `CETELE_OTP_LOCAL_ECHO=true`, so the sign-in code was read from the server log. No deployed
service was involved.

Every shop, person name, phone number, note and amount on screen is sample data. The shop and
customer names carry the `[ÖRNEK]` label, and the phone numbers are placeholders in the
`0 555 000 00 xx` pattern, picked as sample values and not taken from any person. The shop, the customers and the ledger entries
were sent to the server through its HTTP API (`POST /v1/shops` and `POST /v1/shops/{shopId}/sync/push`);
the app then signed in with the same placeholder phone number through its own screens (phone
number, code, new PIN) and pulled the data with its normal sync.

## Files

| # | File | Screen | Caption (tr) | Caption (en) |
| --- | --- | --- | --- | --- |
| 1 | `01-customers.png` | Customer list | Müşteriler ve güncel bakiyeleri; arama ve tek dokunuşla müşteri ekleme. | Customers with their current balances; search, and add a customer with one tap. |
| 2 | `02-customer-ledger.png` | Customer ledger | Müşterinin hesabı: borçlar, tahsilatlar ve düzeltilen kayıt üstü çizili olarak. | One customer's account: debts, payments, and a corrected entry shown struck through. |
| 3 | `03-dashboard.png` | Dashboard | Bugünün özeti, toplam alacak ve en çok borçlu müşteriler. | Today's summary, the total owed to the shop and the customers who owe the most. |

Notes on what the images show:

- 02: the 320,00 TL "Deterjan" debt was entered with a wrong amount, reversed by a "Düzeltme"
  entry and written again with the right amount (230,00 TL). The ledger never deletes an entry; a
  reversed entry stays visible, struck through. One more entry of this customer (42,50 TL, with a
  due date) is below the visible area. The balance (432,00 TL) counts only entries that are not
  reversed.
- 03: the "Bugün" line shows 0,00 TL because every sample entry is dated before the capture day.
- 01, 03: "[ÖRNEK] Ali Çelik" has a balance of 0,00 TL: his sample debt is fully paid.
- The gesture handle of the emulator overlaps the bottom edge of the screens. The captures are not
  retouched.

Not captured: the photo attachment of an entry, reminders and the statement PDF, and iOS (there is
no iOS app). The two sign-in captures of the earlier run (no server) were replaced by these three.
