# Store listing (tr-TR, primary locale)

Status: copy ready for review; **not submitted**. No Google Play or App Store developer account
exists (ADR-0005), so nothing here has passed a store console. Entity facts (name, tagline,
description sentence, domains, application id) come from `apps/web/src/content/facts.ts` and the
identity table of the specification (section 2). ASO reasoning: `docs/seo/aso.md`. Privacy
answers: `privacy-labels.md`. Limits and screenshot paths are checked by
`node ops/release/check-release-docs.mjs`.

Rules for any later edit (same as `docs/seo/aso.md`): no fare numbers, no named real lines, no
claim of official data, no claim that a city has published lines unless its city page shows them,
no contact address that does not exist.

## 1. Title: owner decision

The specification fixes the store title as `İnecek Var: Dolmuş & Minibüs Hatları` (36 characters).
Google Play and the App Store both cap the app name at 30 characters, so that title cannot be
submitted as it is. The identity table says the identity is decided, so this file does not pick a
replacement: it lists the options and **Ayberk chooses one before the first submission**.

| Field id         | Value                                  | Limit | Note                                                                  |
| ---------------- | -------------------------------------- | ----- | --------------------------------------------------------------------- |
| `title.spec`     | `İnecek Var: Dolmuş & Minibüs Hatları` | n/a   | Specification section 2. 36 characters: over the store cap of 30.     |
| `title.option-a` | `İnecek Var: Dolmuş & Minibüs`         | 30    | Keeps both main keywords; drops "Hatları" (it moves to the subtitle). |
| `title.option-b` | `İnecek Var: Dolmuş Hatları`           | 30    | The form suggested in the 4D notes.                                   |
| `title.option-c` | `İnecek Var`                           | 30    | Name only; every keyword goes to the subtitle and keyword field.      |

The PWA manifest (`apps/mobile/public/manifest.webmanifest`) and `FACTS.storeTitle` keep the 36
character form: a web manifest `name` has no such cap. If the owner picks an option, the store
title and those two places differ on purpose; record the choice in ADR-0056.

## 2. Short fields

| Field id   | Value                                                                                       | Limit | Store field                                       |
| ---------- | ------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| `subtitle` | `Hat, durak, ücret; çevrimdışı`                                                             | 30    | App Store subtitle (specification section 7)      |
| `short`    | `Dolmuş ve minibüs hatları, durakları, ücreti; çevrimdışı da çalışır.`                      | 80    | Google Play short description                     |
| `keywords` | `dolmuş,minibüs,hat,durak,toplu taşıma,İstanbul minibüs,İzmir dolmuş,servis hattı,güzergâh` | 100   | App Store keyword field (specification section 7) |
| `promo`    | `Dolmuş nereden geçer? Mahalle bilir.`                                                      | 170   | App Store promotional text (brand tagline)        |

The App Store counts the keyword field in characters, but several Turkish letters take two bytes;
the check script prints both counts. Apple already indexes the app name, so if title option a or b
is chosen, `dolmuş` and `minibüs` can leave the keyword field to make room (decision recorded with
the title).

## 3. Full description

Limit 4000 characters on both stores. Tone: specification section 2 (sokak ağzına yakın, oyunbaz,
net; "ustam" yalnızca şakacı mikro metinde, burada yok).

<!-- full-description:start -->

Dolmuş nereden geçer? Mahalle bilir.

İnecek Var, resmî verisi olmayan dolmuş, minibüs ve servis hatlarını mahallelinin birlikte haritaladığı, çevrimdışı da çalışan hat rehberi.

HAT NEREDEN GEÇER?
• Hat koduyla, adıyla ya da bir yer adıyla ara.
• Hat sayfasında hat izi, sıralı duraklar, tarihli ücret, çalışma saatleri, ödeme yöntemi (nakit, kart, İstanbulkart), "nasıl durdurulur" notları ve son doğrulama tarihi bir arada.
• Konum izni verirsen yakınındaki durakları ve oradan geçen hatları gösteririz.

A'DAN B'YE
• Nereden nereye gideceğini yaz ya da haritada işaretle.
• En fazla 2 aktarmalı, duraklar arası en çok 300 m yürümeli rota önerileri; tahmini ücreti de söyleriz.

İNTERNET YOK MU? DERT DEĞİL.
• Şehir paketini bir kez indir; hat arama, hat ve durak sayfaları internetsiz de açılır.
• Ücretsiz planda bir şehir paketi; daha fazlası Plus ile.

BU HAT DEĞİŞTİ Mİ? SÖYLE.
• Hesap aç, yolculuğunu kaydet, durakları yolda işaretle; ücret, saat ve not öner.
• İstersen ücret tablosunun ya da durak tabelasının fotoğrafını ekle; fotoğrafın konum bilgisi silinir.
• Her öneri bir moderatörün onayından geçer. Kimse kendi önerisini onaylayamaz.

GİZLİLİK
• Reklam yok, takip yok.
• Konum yalnızca uygulama açıkken ve sen izin verdiğinde kullanılır; arka planda konum yok.
• Yolculuk kaydın özeldir: yalnızca sen ve moderatörler görür. Kaydın başı ve sonundaki 200 metre hatta hiç yansımaz; ham kayıt, hattın yayımlanmasından 30 gün sonra silinir.
• Hesabını uygulamadan silebilirsin; 7 günlük bekleme süresinden sonra kişisel verilerin silinir.

PLUS
• Sınırsız çevrimdışı şehir ve destekçi rozeti. Uygulama içi satın alma ile; web sürümü her zaman ücretsiz.

Hat bilgileri katkıcılardan gelir; resmî kaynak değildir. Yola çıkmadan son güncelleme tarihine bir bak.

<!-- full-description:end -->

Every sentence traces to the product: search, line page fields and hail notes (`i18n/tr.ts`
`hailTitle`), planner bounds (`i18n/tr.ts` planner lead, specification story 3), one free city and
Plus benefits (`i18n/contrib.tr.ts` `plusBody`, ADR-0024), stop marking while recording
(`markStop`), photo metadata stripping (ADR-0023), moderation and self-approval ban (ADR-0021),
foreground location (ADR-0004), 200 m trim and 30 day retention (ADR-0022), 7 day grace
(ADR-0026), no ads and no trackers (MobSF release scan: 0 trackers, `docs/security/scan-reports/mobsf-static.md`).

## 4. What's new (first release)

<!-- whats-new:start -->

İlk sürüm: hat ve durak arama, A'dan B'ye rota önerileri, çevrimdışı şehir paketleri, yolculuk kaydı ve hat önerisi.

<!-- whats-new:end -->

Limit 500 characters (Google Play) and 4000 (App Store).

## 5. Screenshots (6, Turkish captions)

Source files: the phase 3 captures (light theme, 720 x 1600). The same six as `docs/seo/aso.md`.

| #   | File                                                      | Caption (tr)                                |
| --- | --------------------------------------------------------- | ------------------------------------------- |
| 1   | `docs/screenshots/phase3/ara-results-light.png`           | Kod, ad ya da yer adıyla hattını bul        |
| 2   | `docs/screenshots/phase3/hat-detail-light.png`            | Duraklar, ücret ve saatler tek sayfada      |
| 3   | `docs/screenshots/phase3/planla-results-light.png`        | A noktasından B noktasına öneriler          |
| 4   | `docs/screenshots/phase3/packs-installed-light.png`       | Şehir paketini indir, internetsiz aç        |
| 5   | `docs/screenshots/phase3/katki-kayit-recording-light.png` | Yolculuğunu kaydet, hattı birlikte haritala |
| 6   | `docs/screenshots/phase3/ayarlar-hesap-light.png`         | Hesabın ve verin senin: istediğinde sil     |

Before upload:

- **Sample data.** Every capture shows the sample city (`[ÖRNEK]` labels, for example
  `[ÖRNEK] Durak 1-1` on screenshot 2). A store must not present sample data as real transport
  data: keep the label visible or retake the set against published data.
- **Size.** All six are 720 x 1600 (ratio 2.22). Google Play's published rule caps the long side at
  twice the short side, and the App Store accepts only its listed device sizes; the check script
  warns about the ratio. Retake on a device or emulator frame that meets both, or crop.
- **Alternatives on disk.** `docs/screenshots/phase3/android/` holds real Android emulator
  captures at 1080 x 2400 (`android-ara.png`, `android-cevrimdisi.png`, `android-hat-deeplink.png`,
  `android-ayarlar.png`, `android-plus.png`, `android-giris.png`); same ratio caveat.
- **Not for the app listing.** `docs/screenshots/phase4/` holds the web moderation and admin
  screens (`admin-kuyruk-360.png`, `admin-surumler-1280.png`, ...): staff tools on the web, not
  part of the app, so they do not go into a store listing.

## 6. Category and content rating (answers for the owner to submit)

| Item                                                 | Proposed answer                                                                                                                        | Basis                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Google Play category                                 | Maps & Navigation (proposal; owner confirms)                                                                                           | product scope, specification section 3                 |
| App Store primary category                           | Navigation (proposal; secondary Travel)                                                                                                | same                                                   |
| Violence, sexual content, profanity, drugs, gambling | None                                                                                                                                   | no such content in the product                         |
| User content (contributions)                         | Yes: line, stop, fare and hours proposals, notes and photos; published only after moderator approval; a "Bu hat değişti" report button | specification stories 2, 5, 6; ADR-0021                |
| Users can interact or chat                           | No (no messaging, no profiles to contact)                                                                                              | specification non-goals                                |
| Shares the user's location with other users          | No (traces are private; only trimmed derived geometry enters a proposal)                                                               | ADR-0022                                               |
| Digital purchases                                    | Yes: Plus through the stores (RevenueCat), native only                                                                                 | ADR-0024, ADR-0050                                     |
| Unrestricted web access                              | No                                                                                                                                     | the app opens only its own hosts (`core/deep-link.ts`) |
| Ads                                                  | No                                                                                                                                     | no ad SDK; MobSF 0 trackers                            |
| Target audience                                      | General audience, not directed at children                                                                                             | specification section 2 audience                       |

The resulting IARC and Apple age ratings are produced by the consoles from these answers; they are
not predicted here.

## 7. URLs

Only the project's planned domains (specification section 2, `FACTS`). None of them is live yet
(ADR-0005: no host).

| Store field             | URL                                     | State of the page                                                                                                                                                                      |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website / marketing     | `https://inecekvar.app/`                | built (`apps/web`), not hosted                                                                                                                                                         |
| Privacy policy          | `https://inecekvar.app/gizlilik`        | built; legal review open (`legal-open-items.md`)                                                                                                                                       |
| Account deletion (Play) | `https://inecekvar.app/hesap-silme`     | built, **no web form**: the page says deletion is in the app only. Play expects a web path to request deletion; see `privacy-labels.md` mismatch M5                                    |
| Support                 | `https://inecekvar.app/iletisim`        | built; says the contact channel is being set up and publishes no address. Both stores require a reachable support contact (Play: an email address): open item in `legal-open-items.md` |
| KVKK notice             | `https://inecekvar.app/kvkk-aydinlatma` | draft, `noindex`                                                                                                                                                                       |

## 8. Identity fields

| Field                      | Value                                                                                             | Source                          |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------- |
| Application id / bundle id | `app.inecekvar.mobile`                                                                            | `capacitor.config.ts`, Gradle   |
| App name on the device     | `İnecek Var`                                                                                      | `capacitor.config.ts` `appName` |
| Developer name             | `İnecek Var Teknoloji` (legal name, specification section 2); registry data not in the repository | specification section 2         |
| Default language           | Turkish (tr-TR); English listing: `store-listing.en.md`                                           | specification section 0         |
| Price                      | Free, with in-app purchase (Plus); Plus price not set                                             | ADR-0024; no store account      |
