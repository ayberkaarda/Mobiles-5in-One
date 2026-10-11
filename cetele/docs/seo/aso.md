# Play listing and Data Safety draft

Draft throughout, dated 2026-10-11. No Play Console account exists. Nothing here has been submitted, reviewed or published. Product copy below is Turkish. This document describes repository behavior and release intentions; it does not certify a live service.

## Listing copy draft

Title: Çetele: Veresiye Defteri

Short description: Esnafın dijital veresiye defteri. İnternetsiz çalışır.

### Full description draft

Veresiyeyi unutma, Çetele'ye yaz.

Çetele, bakkal, manav, kasap, berber ve kahvehane gibi küçük esnaf için dijital veresiye defteridir. Müşterilerinizi, borçları ve tahsilatları Android telefonunuzda takip edin. İnternet yokken de deftere yazın; bağlantı geldiğinde kayıtlarınız sunucuyla eşitlensin.

Müşteri kartına ad, isteğe bağlı telefon numarası, not ve etiket ekleyin. Müşterinizin bakiyesini ve hesap dökümünü görün. Borç veya tahsilat kaydına tutar, tarih, not ve isteğe bağlı fotoğraf ekleyin. Tutarlar Türk lirası olarak tutulur. Yanlış bir kaydı düzeltirken ters kayıt oluşturun; eski işlem ve düzeltmesi defter geçmişinde birlikte kalsın.

Bugünün borçlarını ve tahsilatlarını, toplam alacağınızı ve vadesi gelen kayıtları izleyin. Dükkân sahibi ve çalışan rolleriyle aynı dükkânın kayıtlarını farklı cihazlardan takip edin. Çalışanlar borç ve tahsilat yazabilir; üyeleri veya aboneliği yönetemez, tüm kayıtları dışa aktaramaz.

Müşterinize WhatsApp üzerinden hesap dökümü bağlantısı paylaşın. Telefonu ve SMS onayı kayıtlı müşterilere aylık kotanız içinde SMS hatırlatması gönderin. Müşteri bazında PDF dökümü hazırlayın; tüm defter kayıtlarını CSV olarak dışa aktarın. Fiş veya el yazısı fotoğrafını ilgili kayda ekleyin.

Telefon numaranıza gelen kodla giriş yapın. Uygulama PIN'i veya biyometrik kilitle defterinizi açın. Hesap ve dükkân silme talebinde 14 günlük geri dönüş süresi bulunur. Bu süre içinde talebinizi iptal edebilirsiniz.

Ücretsiz planda 100 müşteri, ayda 200 fotoğraf ve 30 SMS hatırlatması bulunur. Çetele Pro, aylık veya yıllık Google Play aboneliği olarak planlanır: sınırsız müşteri, ayda 2.000 fotoğraf, 500 SMS hatırlatması ve öncelikli eşitleme. Fiyatlar Google Play'de gösterilir. Hesap silme, Google Play aboneliğini kendiliğinden iptal etmez.

Çetele bir portföy projesidir ve Google Play'de yayına hazırlanıyor. Bu açıklama mağaza yayını için taslaktır.

## Keywords draft

veresiye defteri, alacak takibi, esnaf, bakkal, tahsilat, borç defteri, müşteri borcu

## Feature graphic concept draft

Use the established Defter Lacivert background, Kâğıt text and Çentik Turuncu accent. Place the tally-stroke logo beside the Turkish slogan “Veresiyeyi unutma, Çetele'ye yaz.” Show one ledger view with debt and payment rows, using Borç Kırmızısı and Ödendi Yeşili. Any displayed shop or customer must have the visible prefix “[ÖRNEK]”. Avoid ratings, awards, download counts, prices and store availability badges. This is a concept, not a produced asset.

## Six screenshot captions draft

1. “İnternet yokken de borç ve tahsilat yazın.” Show the offline ledger entry flow.
2. “Müşterinizin bakiyesini ve hesap geçmişini görün.” Show a customer statement.
3. “Yanlış kaydı ters kayıtla düzeltin.” Show the original and reversing entry together.
4. “Fiş fotoğrafını ilgili kayda ekleyin.” Show the optional photo on a ledger entry.
5. “Hesap dökümünü paylaşın, onaylı müşteriye SMS gönderin.” Show WhatsApp sharing and the recorded-consent requirement for SMS, without suggesting delivery was verified.
6. “Dükkânınızı sahip ve çalışan rolleriyle takip edin.” Show role-based shop access across devices.

Captions and screen selections are drafts. Use only clearly labelled sample records. These are not captured screenshots or evidence of live SMS, WhatsApp delivery or store publication.

## Data Safety answers draft

All answers are provisional repository mappings. No Console form is available or completed. Required and optional refer to the feature described, not to a promise that every installation transmits every field. Local-only information is distinguished from data leaving the device.

| Proposed field or category | Draft answer and implementation mapping |
| --- | --- |
| Does the app collect data? | Yes. Account, shop, customer, ledger and operational data leave the device for authentication, sync and requested server features. These persistent records are not solely ephemeral processing. |
| Personal information: phone number, name, user IDs | Collected for account management and app functionality. Account phone is needed for SMS-code sign-in; display name is stored. Customer name and optional phone are entered by the shop user, not obtained by reading the address book. Staff invitations also contain user-provided phone numbers. |
| Other personal information | Customer notes and tags, shop details and SMS consent status, date and source are stored for app functionality. Free-text fields can contain personal information supplied by the user. |
| Financial information: other financial information | Customer debts, payments, amounts, dates, optional due dates and reversal relationships are collected for ledger and sync functionality. Çetele records payments; it does not process them. |
| Financial information: purchase history | Pro subscription linkage stores product, plan, state, expiry and purchase-token hash, plus an encrypted token while linked. Used for subscription verification and account functionality. No live Play purchase was exercised. Card or bank-account collection is not part of the product. |
| Photos and videos: photos | Optional receipt or handwritten-note photos are uploaded to private object storage for app functionality. The server re-encodes photos and removes metadata. Image contents can still include names and amounts. |
| Messages: SMS or MMS | Outgoing reminder template, status, provider message ID and send/delivery metadata are stored. Recipient number and composed text are transmitted to the SMS provider; login codes also use the provider. No reading of the device SMS inbox is described. Final categorization of app-composed outgoing messages needs Console review. |
| App activity: other actions and other user content | Sync operations, customer/ledger notes, statement-link openings and reminder requests are retained for functionality. Links store expiry, opening time and count; the raw link token is not stored in the database. |
| Device or other IDs | Device ID, model, app version, last-seen and integrity-verification metadata support sessions, sync and fraud prevention. Authentication and statement tokens are stored as hashes where specified; refresh credentials also reside securely on the device. |
| Diagnostics | Masked operational logs and error codes exist. Sentry is disabled without configuration; no real Sentry project exists. Do not declare live third-party crash collection from the planned integration alone. |
| Location, contacts, audio, health | No corresponding collection feature is specified. Shop il/ilçe is user-entered shop information, not GPS tracking. Do not describe customer phone entry as contact-list access. |
| Data sharing | SMS number and message go to the configured provider. User-initiated WhatsApp and PDF/CSV sharing disclose the selected content to the chosen recipient/application. Storage and planned hosting providers also process server data. Draft Console treatment must distinguish service-provider and user-initiated-transfer exceptions; an unconditional “no transfers” answer would be inaccurate. |
| Encryption in transit | Intended release answer: yes, HTTPS is required by the release design. Local development uses an HTTP emulator endpoint. Live TLS and real provider paths have not been exercised; this is not a verified production answer. |
| Encryption at rest | The Android ledger uses SQLCipher and device-protected keys. PIN is local and never sent to the server. Server database and photo-storage encryption at rest must be verified for the selected deployment; do not claim all server data is encrypted at rest from the Android implementation alone. |
| Can users request deletion? | Yes in the implemented app/server flow, with renewed SMS-code verification and a 14-day grace period. Web request support is in the product scope. This draft document and the sample legal page do not prove a working public deletion form. |
| Deletion limits | Shop deletion removes customer, ledger, reminder, link, sync and photo data. Account deletion removes user, device, session and related phone records. Completion IDs/timestamps and an orphaned subscription hash remain. Provider SMS records and old backups are outside verified deletion coverage. Play subscription cancellation is separate. |
| Advertising and tracking | Advertising is outside scope. No advertising-based use of customer or ledger information is specified. |

## Retention and evidence draft

Daily retention removes OTP rows older than one day, refresh rows more than 30 days after expiry/revocation, invitations more than seven days after expiry, statement links more than 90 days after expiry/revocation, and failed/expired media rows older than seven days. Active ledger/customer data has no fixed general retention period in the cited documents. Server logs and planned backup retention are 30 days; real hosting and backup behavior are not verified.

The hourly deletion job can retry storage failure or block when shared-shop ownership changes. Do not promise deletion at the exact grace-period deadline. Server SMS reminder rows are removed with the shop; anonymizing provider-held SMS logs has not been exercised. Subscription maintenance clears the orphaned encrypted token and keeps its hash to prevent relinking.

Sources: product specification sections 2–7; Turkish README; ADR-0002, ADR-0003, ADR-0004, ADR-0011, ADR-0015, ADR-0016, ADR-0017, ADR-0018, ADR-0020 and ADR-0031. The unresolved release checks are real provider transmission, hosting region, server/storage encryption at rest, backups, public web deletion, Console category interpretation and store submission. Every field above remains a draft until those checks and the actual form are completed.
