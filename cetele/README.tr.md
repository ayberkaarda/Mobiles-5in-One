[English](README.md) | Türkçe

# Çetele

[![Cetele CI](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/cetele-ci.yml/badge.svg)](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/cetele-ci.yml)
[![Cetele Security](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/cetele-security.yml/badge.svg)](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/cetele-security.yml)

"Veresiyeyi unutma, Çetele'ye yaz."

Çetele, bakkal, manav, kasap, berber ve kahvehane gibi küçük esnaf için internetsiz de çalışan
dijital veresiye defteri. Müşterileri, borçları, tahsilatları ve hatırlatmaları takip eder; dükkân
sahibi ile çalışanların cihazları arasında senkronize olur. Adı, eskiden esnafın borçları çentik
atarak kaydettiği çetele sopasından geliyor. Dil saygılı ("siz"), sade Türkçe; fintech jargonu yok.
Proje bir Kotlin Android uygulaması ile herkese açık siteyi ve yönetim konsolunu da render eden bir
Spring Boot sunucusundan oluşur. Herkese açık sayfaların statik bir
[web demosu](https://ayberkaarda.github.io/Mobiles-5in-One/cetele/) GitHub Pages'te yayında; orada
giriş ve formlar çalışmaz.

| Müşteriler | Müşteri hesabı | Panel |
| --- | --- | --- |
| <img src="docs/release/screenshots/01-customers.png" width="220" alt="Çetele Android uygulaması: bakiyeleriyle müşteri listesi, örnek müşteriler, emülatör"> | <img src="docs/release/screenshots/02-customer-ledger.png" width="220" alt="Çetele Android uygulaması: borçlar, bir tahsilat ve üstü çizili ters kayıtla bir müşterinin hesabı, örnek veri, emülatör"> | <img src="docs/release/screenshots/03-dashboard.png" width="220" alt="Çetele Android uygulaması: toplam alacak ve en çok borçlu müşterilerle panel, örnek veri, emülatör"> |

Debug derlemesi, `Pixel_8` emülatöründe yerelde başlatılan sunucuya karşı ve `[ÖRNEK]` verisiyle;
çekim yöntemi [`docs/release/screenshots/README.md`](docs/release/screenshots/README.md) dosyasında.

## Durum

Portföy projesi. Planlanan yedi fazın hepsi (0 ile 6) `main`'e birleşti: temel kurulum; kimlik
doğrulama ve güvenlik temeliyle sunucu çekirdeği; değişiklik günlüğüyle senkronizasyon, defter,
hatırlatmalar ve medya hattı; Android uygulaması; Play faturalama, webhook'lar ve yönetim konsolu;
SEO ve GEO ile herkese açık web; sertleştirme ve yayına hazırlık. Ardından bir sertleştirme paketi,
uygulama ve web için tasarım yenilemesi ve ikinci bir güvenlik paketi (yeniden kimlik doğrulama
kapsamı, cihaz oturumları, dükkân ve SMS sınırları) geldi.

| Alan                                                   | Durum                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sunucu, API, senkronizasyon, yönetim konsolu, site     | Gerçek kod; entegrasyon testleri Testcontainers ile başlatılan konteynerlere karşı çalışır                                                                   |
| Android uygulaması                                     | Gerçek uygulama; JVM ve Robolectric testleriyle doğrulandı. Debug derlemesi ekran görüntüleri için emülatörde çalıştırıldı, uçtan uca akış koşusu yok          |
| Google Play Billing, RTDN, Play Integrity              | Gerçek doğrulama kodu, sahte adaptörlere ve kaydedilmiş fixture'lara karşı çalıştırıldı; Play hesabı yok                                                     |
| SMS (Netgsm) ve teslim raporları                       | İstemci ve webhook kodu sahtelerle test edildi; hiç SMS gönderilmedi                                                                                          |
| Biyometri, kamera çekimi, PDF çıktısı, WhatsApp        | Kod var; cihazda denenmedi                                                                                                                                    |
| Yedekler                                               | `Cetele restore drill` iş akışı (PostgreSQL 16, MinIO, age) aylık zamanlanmış; GitHub Actions'ta henüz çalışmadı                                              |
| Barındırma, alan adı, TLS, hukuki inceleme             | Kurulmadı; hukuki metinler örnektir                                                                                                                           |

Doğrulama matrisinde ([`docs/security/verification-matrix.md`](docs/security/verification-matrix.md))
12 satır tamam, 11 satır kısmi, 0 satır başlanmamış; kısmi satırlar dış kapılara bağlı (Play hesabı,
fiziksel cihaz, alan adı, hukuki inceleme).

## MVP özellikleri

- Telefon numarası ve SMS tek kullanımlık kod ile giriş; uygulama PIN'i veya biyometrik kilit.
- `OWNER` ve `STAFF` rolleriyle dükkân; çalışan telefon numarasıyla davet edilir.
- İsim, telefon, not ve etiketli müşteriler; canlı bakiye ve müşteri bazlı hesap dökümü.
- Borç veya tahsilat tipinde defter kayıtları: tutar, tarih, not ve isteğe bağlı fotoğraf. Kayıtlar değiştirilemez, düzeltmeler ters kayıtla yapılır.
- Panel: bugünün borç ve tahsilatları, toplam alacak, en çok borçlu müşteriler, bugün vadesi gelenler.
- Hatırlatma: WhatsApp paylaşımı (imzalı hesap dökümü bağlantısıyla) ve SMS (yalnızca onayı kayıtlı müşteriler için, aylık kotayla).
- Dışa aktarma: müşteri başına PDF döküm ve tüm kayıtların CSV'si.
- Offline-first çalışma; internet gelince senkronize olan giden kutusu; çoklu cihaz tutarlılığı.
- Çetele Pro (Google Play aboneliği): sınırsız müşteri (Free planda 100), daha yüksek SMS kotası, aylık daha fazla fotoğraf, öncelikli senkronizasyon.
- Uygulama içinden ve web'den hesap ve dükkân silme.
- Web: tanıtım sitesi, rehber yazıları, yasal sayfalar ve platform yöneticileri için admin konsolu.

Kapsam dışı: ödeme işleme, POS entegrasyonu, e-Fatura / GİB entegrasyonu, stok takibi, iOS
uygulaması (Kotlin Multiplatform v2 adayı), muhasebeci portalı, çoklu para birimi, reklam.

## Teknoloji yığını

| Katman            | Teknoloji                                                                          |
| ----------------- | ---------------------------------------------------------------------------------- |
| Android uygulaması | Kotlin 2.4.20, Jetpack Compose (BOM 2026.09.00, Material 3), Hilt 2.60.1, AGP 9.3.3 |
| Yerel depolama    | SQLCipher 4.19.1 ile Room 2.8.5, DataStore 1.2.1                                   |
| Arka plan işleri  | WorkManager 2.12.0 (senkronizasyon, hatırlatma, fotoğraf yükleme)                  |
| Ağ                | Ktor client 3.6.0, Kotlinx Serialization, sertifika sabitlemeli OkHttp             |
| Faturalama        | Google Play Billing 8.3.0, Play Integrity 1.6.0; sunucuda Play Developer API       |
| Backend API       | Spring Boot 4.1.1 (Kotlin, JDK 21), Spring Security, Spring Data JPA               |
| Veritabanı        | Flyway migration'larıyla PostgreSQL 16                                             |
| Nesne depolama    | S3 uyumlu (AWS SDK v2; yerelde MinIO)                                              |
| Web ve yönetim    | Thymeleaf, sunucu tarafı render                                                    |

Çözümlenen sürümler ve gerekçeleri [`docs/adr/0001-stack-and-versions.md`](docs/adr/0001-stack-and-versions.md) dosyasında.

## Mimari

İki kök: `android/` (çok modüllü Gradle projesi: `app`, `core/` altında domain, data, network ve
tasarım sistemi modülleri, `feature/` altında auth, shop, customers, ledger, reminders, export,
billing ve settings modülleri) ve `server/` (Spring Boot); yanında `brand/` ve `docs/`. Android
uygulaması tüm veriyi şifreli yerel veritabanında tutar ve internetsiz çalışır. Senkronizasyon yerel
bir işlem giden kutusu ve sunucu tarafında bir değişiklik günlüğü kullanır: defter kayıtları yalnızca
eklenir, bu yüzden çakışmaz; müşteri profil alanlarında son yazan kazanır; silmeler mezar taşı
olarak tutulur. Para, TRY cinsinden kuruş (tam sayı) olarak saklanır. Her kiracı tablosu dükkâna
göre ayrılır ve dükkân her zaman istek verisinden değil, çağıranın üyeliğinden türetilir.

## Kurulum

Android (JDK 21, Android SDK), `android/` içinden, CI ile aynı komut:

```sh
./gradlew ktlintCheck detekt lintDebug testDebugUnitTest :core:domain:test :app:assembleDebug
```

Sunucu (JDK 21; entegrasyon testleri konteyner başlattığı için Docker çalışıyor olmalı), `server/`
içinden:

```sh
./gradlew check openApiContractCheck
```

Tüm yerel yığın (PostgreSQL, MinIO, Mailpit ve sunucu): sunucu imajını `server/` içinden derleyin,
sonra compose'u bu klasörden başlatın. Compose imajı kendisi derlemez:

```sh
./gradlew jibDockerBuild
docker compose up -d --wait
```

Sunucu `local` profili ve yerel yedekleriyle (sahte SMS, sahte integrity, sahte faturalama)
http://127.0.0.1:60080 adresinde dinler; Android emülatörü ona `http://10.0.2.2:60080` üzerinden
ulaşır. Tüm ortam değişkenleri [`docs/ops/env.md`](docs/ops/env.md) dosyasında. Katkı kuralları
[`CONTRIBUTING.md`](CONTRIBUTING.md) dosyasında.

## CI

- `Cetele CI`: Android (ktlint, detekt, Android lint, birim testleri, debug APK), sunucu (`check` ve
  OpenAPI sözleşme kontrolü), marka dosyaları ve tüm geçmişte gitleaks ile yer tutucu grep'i.
- `Cetele Security`: iki Gradle kökü için OWASP Dependency-Check, CycloneDX SBOM, bilgilendirme
  amaçlı bağımlılık güncelleme ve OWASP ZAP işleri.
- `Cetele restore drill`: PostgreSQL 16, MinIO ve age ile aylık yedekleme ve geri yükleme.

## Dokümantasyon

- Ürün ve teknik tanım: [`02-cetele-kotlin-android.md`](02-cetele-kotlin-android.md)
- Mimari kararlar: [`docs/adr/`](docs/adr/README.md)
- API: [`docs/api/openapi.json`](docs/api/openapi.json) ve [`docs/api/README.md`](docs/api/README.md); Android ile sunucu arasındaki sözleşmeler [`docs/handoffs/`](docs/handoffs/README.md) altında
- Güvenlik: [doğrulama matrisi](docs/security/verification-matrix.md), [tehdit modeli](docs/security/threat-model.md), [yetkilendirme matrisi](docs/security/authorization-matrix.md), [pentest raporu](docs/security/pentest-report.md), [tarama raporları](docs/security/scan-reports/) (bağımlılık, MobSF, ZAP), [geçmiş temizleme runbook'u](docs/security/history-purge-runbook.md)
- Operasyon: [ortam](docs/ops/env.md), [yedekleme ve geri yükleme](docs/ops/backup-restore.md), [maliyet uyarıları](docs/ops/cost-alerts.md), [dışa aktarma biçimi](docs/ops/export-format.md)
- Yayın: [yayın kontrol listesi](docs/release/release-checklist.md), [Data Safety](docs/release/data-safety.md), [Play mağaza metni](docs/seo/play-listing.md), [ASO](docs/seo/aso.md)

## Lisans

Bu proje MIT Lisansı ile lisanslanmıştır. Bkz. [LICENSE](../LICENSE).
