[English](README.md) | Türkçe

# Çetele

Slogan: "Veresiyeyi unutma, Çetele'ye yaz."

## Ürün özeti

Çetele, bakkal, manav, kasap, berber ve kahvehane gibi küçük esnaf için internetsiz de çalışan dijital veresiye defteri. Müşterileri, borçları, tahsilatları ve hatırlatmaları takip eder; sahip ve çalışan arasında cihazlar arası senkronize olur. Adı, eskiden esnafın borçları çentik atarak kaydettiği çetele sopasından geliyor. Dil saygılı ("siz"), sade Türkçe; fintech jargonu yok.

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

## Kapsam dışı

- Ödeme işleme
- POS entegrasyonu
- e-Fatura / GİB entegrasyonu
- Stok takibi
- iOS uygulaması (Kotlin Multiplatform v2 adayı)
- Muhasebeci portalı
- Çoklu para birimi
- Reklam

## Planlanan teknoloji yığını

| Katman | Teknoloji |
|---|---|
| Android uygulaması | Kotlin, Jetpack Compose (Material 3), Hilt |
| Yerel depolama | Room + SQLCipher, Proto DataStore |
| Arka plan işleri | WorkManager (senkronizasyon, hatırlatma, fotoğraf yükleme) |
| Ağ katmanı | Ktor client, Kotlinx Serialization |
| Backend API | Spring Boot 3 (Kotlin), Spring Security, Spring Data JPA |
| Veritabanı | PostgreSQL, Flyway migration'ları |
| Nesne depolama | S3 uyumlu (fotoğraflar, presigned URL) |
| Faturalama | Google Play Billing, Play Developer API |
| Web ve admin | Thymeleaf, sunucu tarafı render |

## Planlanan mimari

İki kökü olan tek bir repo: `android/` (domain, data, network, tasarım sistemi ve özellik modüllerinden oluşan çok modüllü Gradle projesi) ve `server/` (Spring Boot); yanında `brand/` ve `docs/`. Android uygulaması tüm veriyi şifreli yerel veritabanında tutar ve çevrimdışı çalışır. Senkronizasyon, yerel bir işlem giden kutusu ve sunucu değişiklik günlüğüyle yapılır: defter kayıtları yalnızca eklendiği için çakışmaz, müşteri profil alanlarında son yazan kazanır, silmeler tombstone olarak tutulur. Para, TRY cinsinden kuruş (tam sayı) olarak saklanır. Tüm kiracı tabloları dükkâna göre ayrıştırılır; dükkân bilgisi istek gövdesinden değil, çağıranın üyeliğinden türetilir.

## Durum

7 fazdan 0-4 birleşti: depo temeli, Spring Boot sunucusu (kimlik doğrulama ve güvenlik tabanı, değişiklik günlüğüyle senkronizasyon, defter, hatırlatma, medya hattı, hesap ve dükkân silme) ve Android uygulaması (çevrimdışı defter, senkronizasyon motoru, PIN ve biyometrik kilit, hatırlatma, PDF ve CSV dışa aktarma, ayarlar), Play faturalaması (satın alma bağlama ve yetkilendirme), Play RTDN ve SMS teslim raporu webhook'leri, TOTP ve denetim kaydıyla yönetim konsolu, Android'de Play Billing ve Pro plan ekranları. İlerleme yaklaşık %71. Herkese açık web (SEO ve GEO, Phase 5) ile yayın sertleştirmesi (Phase 6) henüz birleşmedi.

Şimdiye kadarki doğrulama yalnızca JVM birim testleri ve CI; Play Developer API, RTDN imza anahtarları ve Play Integrity sahte adaptörler ve kayıtlı örneklerle çalıştı, Play hesabı yok. Android uygulaması cihazda veya emülatörde çalıştırılmadı, sunucu gerçek bir istemciyle denenmedi; bu yüzden biyometri, kamera çekimi, gerçek PDF çıktısı, WhatsApp ve canlı SMS denenmiş değil. Açık kalanlar: KVKK aydınlatma bağlantısı (ürün kararı), dashboard yenileme göstergesi için çalışan senkronizasyon sinyali ve senkron sorunları ekranında yükseltme düğmesi.

## Kurulum

Ürün ve teknik tanım `02-cetele-kotlin-android.md` dosyasında; mimari kararlar `docs/adr`, API `docs/api/openapi.json`, Android-sunucu sözleşmesi `docs/handoffs` altında.

Android (JDK 21, Android SDK), `android/` içinden:

```
./gradlew ktlintCheck detekt lintDebug testDebugUnitTest assembleDebug
```

Sunucu (JDK 21; entegrasyon testleri konteyner başlatır, Docker çalışıyor olmalı), `server/` içinden:

```
./gradlew check
```
