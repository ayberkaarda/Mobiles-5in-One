# App screenshots

Three Android captures of the debug build of the redesigned Cetele app, taken on 2026-10-11 on the
`Pixel_8` Android emulator (an emulator, not a physical device), signed in against a server running
locally. They are the raw device frames (1080x2400, light theme, no device frame, no retouching),
downscaled to 540x1200 and reduced to a 256-colour palette to keep each file small. The pixels
were not edited.

The server was the Spring Boot server of this repository, built and started from source
(`./gradlew bootRun`, profile `local`, JDK 21), with PostgreSQL and MinIO from
`cetele/docker-compose.yml`. It ran with the local stand-ins described in
[`docs/ops/env.md`](../../ops/env.md): fake SMS (no SMS was sent), fake integrity (the debug app
sends the `fake.ok` token) and fake billing. No deployed service was involved.

Every shop, person name, phone number, note and amount on screen is sample data: one `[ÖRNEK]`
shop, seven `[ÖRNEK]` customers and 17 ledger entries, including one reversing entry. The phone
numbers are placeholders in the `0 555 000 00 xx` pattern, picked as sample values and not taken
from any person. The data was sent to the server through its HTTP API and the app pulled it with
its normal sync.

## Files

| # | File | Screen | Caption (tr) | Caption (en) |
| --- | --- | --- | --- | --- |
| 1 | `01-customers.png` | Customer list | Müşteriler ve güncel bakiyeleri; arama ve tek dokunuşla müşteri ekleme. | Customers with their current balances; search, and add a customer with one tap. |
| 2 | `02-customer-ledger.png` | Customer ledger | Müşterinin hesabı: borçlar, tahsilatlar ve düzeltilen kayıt üstü çizili olarak. | One customer's account: debts, payments, and a corrected entry shown struck through. |
| 3 | `03-dashboard.png` | Dashboard | Bugünün özeti, toplam alacak ve en çok borçlu müşteriler. | Today's summary, the total owed to the shop and the customers who owe the most. |

Notes on what the images show:

- 02: the 320,00 TL "Deterjan" debt was entered with a wrong amount, marked "Düzeltilmiş kayıt"
  and reversed by a "Düzeltme" entry, then written again with the right amount (230,00 TL). The
  ledger never deletes an entry; a reversed entry stays visible, struck through. The balance
  (432,00 TL) counts only entries that are not reversed.
- 03: the "Bugün" line shows 0,00 TL because every sample entry is dated before the capture day.
  The list below the visible area ("Bugün vadesi gelen") is cut off by the screen edge.
- 01, 03: "[ÖRNEK] Ali Çelik" has a balance of 0,00 TL: his sample debt is fully paid (he is
  listed on 01 only; 03 shows the six customers with a balance).
- The status bar shows the emulator clock (9:51). The captures are not retouched.

Limits: these are emulator frames of a debug build against a local server with fake adapters. They
are not taken on a physical device and are not an end-to-end test of SMS, integrity or billing.
Not captured: the photo attachment of an entry, reminders and the statement PDF, dark theme, and
iOS (there is no iOS app).
