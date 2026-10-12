# App store optimisation (ASO) notes

Status: draft for the store listings; no store account or listing exists yet. All store strings are
Turkish (primary locale `tr-TR`). Entity facts come from `apps/web/src/content/facts.ts`, the same
module that feeds the web pages, `llms.txt` and the JSON-LD.

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
to re-brainstorm, so this file records the conflict instead of choosing: the owner either accepts
`İnecek Var` as the title with the rest in the subtitle and keywords, or approves a 30 character
form such as `İnecek Var: Dolmuş Hatları` (26). Nothing is submitted until this is decided.

### Long description (draft, Turkish)

> İnecek Var, resmî verisi olmayan dolmuş, minibüs ve servis hatlarını mahallelinin birlikte
> haritaladığı, çevrimdışı da çalışan hat rehberidir. Dolmuş nereden geçer? Mahalle bilir.
>
> Hat sayfasında hat izi, sıralı duraklar, tarihli ücret, saatler, ödeme yöntemi ve son doğrulama
> tarihi bulunur. Şehir paketini bir kez indir, internet olmadan da hat ara. Bir bilgi yanlışsa
> düzeltme öner; her değişiklik bir moderatörün onayından geçer.
>
> Reklam yok. Konum yalnızca uygulama açıkken kullanılır. Yolculuk kaydın özeldir ve hattın
> yayımlanmasından 30 gün sonra silinir.

Constraints for any later edit: no fare numbers, no named lines, no claim of official data, no
claim of cities with published lines unless the city page shows them.

## Screenshots (6, Turkish captions)

Files are the phase 3 captures under `docs/screenshots/phase3/` (light theme, 720 x 1600).

| # | File | Caption (tr) |
| - | ---- | ------------ |
| 1 | `ara-results-light.png` | Kod, ad ya da yer adıyla hattını bul |
| 2 | `hat-detail-light.png` | Duraklar, ücret ve saatler tek sayfada |
| 3 | `planla-results-light.png` | A noktasından B noktasına öneriler |
| 4 | `packs-installed-light.png` | Şehir paketini indir, internetsiz aç |
| 5 | `katki-kayit-recording-light.png` | Yolculuğunu kaydet, hattı birlikte haritala |
| 6 | `ayarlar-hesap-light.png` | Hesabın ve verin senin: istediğinde sil |

Caveat: these captures show the sample city ("[ÖRNEK]" labels, "Örnek veri" badge). Store
screenshots must either keep the sample label visible or be retaken against real published data;
a store listing must not present sample data as real transport data.

## Data Safety (Google Play) and App Privacy (Apple), consistent with the app

Basis: ADR-0022 (traces), ADR-0026 (deletion), ADR-0021 (nearby stops), `/gizlilik` on the web.

| Topic | Answer | Source |
| ----- | ------ | ------ |
| Ads | None | `/sss`, `/gizlilik`; no ad SDK in the app |
| Third-party analytics or tracking | None; no tracking domains, no advertising identifier | no such SDK in `apps/mobile` |
| Location | Precise location, only while the app is in the foreground and the user allowed it. Used for nearby stops and for ride recording the user starts. With an installed city pack nearby stops are computed on the device; without one the coordinates go to `GET stops/near` for that query and are not logged. Not shared, not used for advertising, never in the background. | ADR-0021, ADR-0034 |
| Ride traces | User content. Private to the user and moderators, never in a public response or export. Derived geometry drops the first and last 200 m. The raw trace is deleted 30 days after the derived version is published (30 days after upload when unused) and at once on account deletion. | ADR-0022, ADR-0026 |
| Account data | Email address (sign-in), password stored only as an Argon2id hash; favourites synced for signed-in users. | ADR-0007, ADR-0011 |
| Photos | Optional fare table or stop sign photo; re-encoded, metadata removed. | ADR-0023 |
| Contributions | Approved contributions stay under the licence with the author removed after deletion ("silinmiş katkıcı"). | ADR-0026 |
| Deletion | In the app (Ayarlar, Hesap): immediate deactivation, 7 day grace, then hard delete. A web deletion form does not exist yet; the store field "data deletion URL" points to `/hesap-silme`, which says so. | ADR-0026, `/hesap-silme` |
| Data encrypted in transit | Yes (HTTPS only, no cleartext traffic) | `capacitor.config.ts`, Android manifest |
| Purchases | Plus is not on sale yet; answer again at the phase 5 gate. | ADR-0024 |

Not exercised: the real store consoles (no developer accounts), the Apple privacy nutrition
label questionnaire, and the Play Data Safety form submission. Re-check every row against the
shipped build before submitting.

## Entity consistency

The listing name, description sentence and tagline must equal `FACTS.name`,
`FACTS.description` and `FACTS.tagline`. A unit test (`apps/web/src/content/content.spec.ts`)
keeps the web side and `llms.txt` aligned; the store text is copied by hand and reviewed against
the same file.
