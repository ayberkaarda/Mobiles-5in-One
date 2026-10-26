[English](README.md) | Türkçe

# Askıda

[![Askida CI](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/askida-ci.yml/badge.svg)](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/askida-ci.yml)
[![Askida Security](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/askida-security.yml/badge.svg)](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/askida-security.yml)

"İyilik askıda kalmasın."

Askıda, Türkiye'deki "askıda ekmek" geleneğinden doğan bir iyilik ağı. Bağışçılar ekmek, çorba,
yemek ya da kırtasiye gibi gündelik ihtiyaçları doğrulanmış mahalle esnafında önceden öder;
ihtiyacı olan kişi hesap açmadan, anonim kalarak tek kullanımlık bir kodla askıdan alır. Tek bir
Flutter uygulaması üç modda çalışır (bağışçı, esnaf, alan); Laravel sunucusu API'yi, herkese açık
web sitesini ve yönetim panelini sunar. Dil sıcak, saygılı ve sadedir; acındırma yoktur. Herkese
açık sayfaların statik bir [web demosu](https://ayberkaarda.github.io/Mobiles-5in-One/askida/)
GitHub Pages'te yayında; orada giriş, formlar ve ödeme çalışmaz.

## Durum

Portföy projesi. Planlanan yedi fazın hepsi (0 ile 6) `main`'e birleşti: temel kurulum; veri
katmanı, kimlik doğrulama ve güvenlik temeli; dükkânlar, hesaplar ve askılar; ödemeler, webhook'lar,
hakedişler ve yönetim paneli; Flutter uygulaması; SEO ve GEO ile herkese açık web; sertleştirme ve
yayına hazırlık (saldırı testleri, kalıcı XSS taraması, ZAP ve MobSF taramaları, bağımlılık
denetimleri, geri yükleme tatbikatlı şifreli yedekler, maliyet korumaları, yayın ve mağaza
dokümanları).

| Alan                                                                 | Durum                                                                                                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sunucu, API, web sayfaları, Filament paneli, kuyruklar, veritabanı   | Gerçek kod; yerelde Docker'da ve test paketlerinde çalışıyor                                                                                                                  |
| Flutter uygulaması                                                   | Gerçek uygulama; yerel yığına karşı `Pixel_8` Android emülatöründe çalıştırıldı. iOS derlenmedi (macOS gerekir)                                                               |
| Ödemeler (iyzico)                                                    | Gerçek iyzico adaptörü, kaydedilmiş sağlayıcı yanıtlarıyla test edildi; yerel çalıştırmalar `PAYMENT_PROVIDER=fake` ve sahte bir ödeme sayfası kullanır; üye işyeri hesabı yok |
| Cihaz doğrulama (Play Integrity, DeviceCheck)                        | Platform channel kodu var; gerçek bir doğrulama çalıştırılmadı                                                                                                                |
| Yedekler                                                             | Şifreli veritabanı arşivleri ve `Askida restore drill` iş akışı (GitHub Actions'taki son koşu 2026-10-19'da geçti); üretim bucket'ı yok                                       |
| Barındırma, alan adı, TLS, mağaza kaydı, hata izleme                 | Kurulmadı                                                                                                                                                                     |
| Hukuki metinler                                                      | Örnek metinler, öyle etiketli                                                                                                                                                 |

Nihai doğrulama matrisi ([`docs/security/verification-matrix.md`](docs/security/verification-matrix.md))
23 maddenin 14'ünü tamam, 9'unu kısmi olarak notlandırır, her birinin gerekçesiyle; kısmi olanlar
(geçmiş temizliği, HTTPS, sırların hash'lenmesi, temiz loglar, webhook imzaları, paket denetimi,
yedekler, harcama uyarıları, saldırgan gözüyle test) burada bulunmayan sistemlere bağlı. Aynı
doküman 2985 sunucu testinin ve 591 Flutter testinin geçtiğini kaydeder.

## MVP özellikleri

- Bağışçı ve esnaf için e-posta/şifre ile kayıt, Apple ve Google ile giriş, şifre sıfırlama.
- Esnaf kaydı: dükkân bilgileri, harita konumu, doğrulama belgeleri; durumlar `Pending → Verified | Rejected`. Yalnızca doğrulanmış dükkânlar görünür.
- Esnaf kataloğu: kategori, fiyat ve günlük verme sınırı olan ürünler.
- Bağışçı akışı: dükkânları mesafeye göre listeleme, ürün ve adet seçme, kartla ödeme, makbuz ve bağış geçmişi; işlem başına ve günlük üst limitlerle.
- Alan akışı: hesap yok, anonim cihaz kimliği, yakındaki dükkânlarda mevcut ürünler, 10 dakika geçerli 8 karakterlik tek kullanımlık kod (yazı ve QR), günlük adalet limitleri.
- Teslim: esnaf QR'ı okutur ya da kodu yazar, sunucu doğrular; bağışçıya anonim "Askın alındı" bildirimi gider.
- Hakediş defteri: bağışlar, teslim sayıları, ödeme durumu ve şeffaf platform komisyonu.
- Etki: ilçe bazında herkese açık sayaçlar ve uygulama içinde bağışçı etki kartı.
- Bildirimler: esnafa "Yeni askı", bağışçıya "Askın alındı".
- Uygulama içinden ve web'den hesap silme; alan kişi için anonim "Verilerimi sıfırla".
- Web sitesi: tanıtım ve nasıl çalışır sayfaları, doğrulanmış dükkân rehberi, etki sayfası, rehber yazıları, yasal sayfalar ve yönetim paneli.

Kapsam dışı: kişilere nakit bağış, alan kişi için hesap veya profil, sohbet, alan kişilerin
puanlanması, eczane ve tıbbi ürünler, çoklu para birimi, teslimat, reklam, kurumsal bağışçı fatura
portalı (v2'de düşünülüyor).

## Ekran görüntüleri

Android emülatöründe (`Pixel_8`) yerel sunucuya karşı alındı; iOS derlenmedi ve görüntüsü yok.
Ekrandaki her dükkân, kişi ve tutar `[ÖRNEK]` etiketli örnek veridir; ödeme yerel sahte ödeme
sayfasında yapıldı. Varsayılan dil Türkçe; bir ekran İngilizce. Esnafın ödemeler ekranı bu
sürümde hata gösterdiği için alınmadı. Açıklamalar, çekim ayrıntıları ve çekim komutu
[`docs/release/screenshots/README.md`](docs/release/screenshots/README.md) dosyasında.

### Alan kişi (Askıdan al)

| Başlangıç | Yakındakiler | Harita | Dükkân | Kod ve karekod | Ayarlar |
| --- | --- | --- | --- | --- | --- |
| <img src="docs/release/screenshots/07-recipient-onboarding.png" width="160" alt="Alan kişi başlangıcı: anonim kimlik, hesap yok"> | <img src="docs/release/screenshots/01-recipient-nearby.png" width="160" alt="Askıda ürünü olan yakın dükkânlar"> | <img src="docs/release/screenshots/08-recipient-map.png" width="160" alt="Yakın dükkânlar haritada"> | <img src="docs/release/screenshots/02-recipient-shop.png" width="160" alt="Askıdaki ürünleriyle dükkân sayfası"> | <img src="docs/release/screenshots/03-recipient-code.png" width="160" alt="Örnek bir rezervasyonun tek kullanımlık kodu ve karekodu"> | <img src="docs/release/screenshots/09-recipient-settings.png" width="160" alt="Hesapsız ayarlar ekranı"> |

### Bağışçı (Askıya bırak)

| Keşfet | Dükkân | Bağış | Makbuz | Geçmiş | Etki |
| --- | --- | --- | --- | --- | --- |
| <img src="docs/release/screenshots/10-donor-discover.png" width="160" alt="Bir ilçedeki doğrulanmış örnek dükkânlar"> | <img src="docs/release/screenshots/11-donor-shop.png" width="160" alt="Ürünleri ve fiyatlarıyla dükkân sayfası"> | <img src="docs/release/screenshots/04-donor-donate.png" width="160" alt="Ödemeden önce ürün ve adet"> | <img src="docs/release/screenshots/05-donor-receipt.png" width="160" alt="Yerel sahte ödeme sayfasından sonra bağış makbuzu"> | <img src="docs/release/screenshots/12-donor-history.png" width="160" alt="Bağış geçmişi"> | <img src="docs/release/screenshots/13-donor-impact.png" width="160" alt="Günün etki sayılarıyla ana ekran"> |

### Esnaf

| Dükkân kaydı | Ürünler | Panel | Kodla ver | Verildi | Verilenler |
| --- | --- | --- | --- | --- | --- |
| <img src="docs/release/screenshots/14-merchant-onboarding.png" width="160" alt="Dükkân kaydı: adres ve harita iğnesi"> | <img src="docs/release/screenshots/15-merchant-catalog.png" width="160" alt="Tek örnek ürünlü ürünler ekranı"> | <img src="docs/release/screenshots/16-merchant-home.png" width="160" alt="Doğrulanmış dükkânın paneli"> | <img src="docs/release/screenshots/17-merchant-redeem.png" width="160" alt="Kod okutma ekranında elle yazılmış kod"> | <img src="docs/release/screenshots/06-merchant-redeemed.png" width="160" alt="Kod onaylandı, ürün verildi"> | <img src="docs/release/screenshots/18-merchant-redemptions.png" width="160" alt="Günün verilenler kaydı"> |

### Hesap, koyu görünüm ve İngilizce

| Ayarlar | Hesabı sil | Koyu: panel | Koyu: verilenler | İngilizce |
| --- | --- | --- | --- | --- |
| <img src="docs/release/screenshots/20-donor-settings.png" width="160" alt="Giriş yapmış bağışçının ayarları"> | <img src="docs/release/screenshots/21-donor-delete-account.png" width="160" alt="Hesap silme ekranı"> | <img src="docs/release/screenshots/22-merchant-home-dark.png" width="160" alt="Koyu görünümde esnaf paneli"> | <img src="docs/release/screenshots/23-merchant-redemptions-dark.png" width="160" alt="Koyu görünümde verilenler kaydı"> | <img src="docs/release/screenshots/24-merchant-catalog-en.png" width="160" alt="İngilizce arayüzde ürünler ekranı"> |

## Teknoloji yığını

| Katman             | Teknoloji                                                                            |
| ------------------ | ------------------------------------------------------------------------------------ |
| Mobil uygulama     | Flutter 3.47.6 ve Dart 3.13.5, Riverpod 3.4.3, go_router 18.0.2, drift 2.35.1        |
| Backend API        | PHP 8.3 üzerinde Laravel 13.34.0 (yalnızca Docker'da), Sanctum 4.3.3                 |
| Yönetim paneli     | Filament 3.3.55                                                                      |
| Veritabanı         | PostgreSQL 16.9 + PostGIS 3.5.2                                                      |
| Kuyruk ve önbellek | Redis 7.4.11, Horizon 5.50.0                                                         |
| Nesne depolama     | S3 uyumlu (yerelde MinIO, Cloudflare R2 planlandı)                                   |
| Ödeme              | iyzico pazaryeri ödemeleri (Checkout Form ve alt üye işyeri), yerelde sahte sağlayıcı |
| Web                | Laravel Blade, sunucu tarafı render                                                  |
| Cihaz doğrulama    | Play Integrity (Android) ve DeviceCheck (iOS), platform channel ile                  |

Çözümlenen sürümler ve gerekçeleri [`docs/adr/0001-stack-and-versions.md`](docs/adr/0001-stack-and-versions.md) dosyasında.

## Mimari

İki ana kök: Flutter istemcisi için `app/`, Laravel backend için `server/`; yanında `brand/` ve
`docs/`. Backend, `/api/v1` altında sürümlü bir JSON API sunar, Blade web sitesini render eder ve
Filament yönetim panelini barındırır. Para, TRY cinsinden kuruş (tam sayı) olarak tutulur; platform
parayı elinde tutmaz, ödeme bağışçıdan ödeme sağlayıcı üzerinden esnafa akar. Alan kişinin
anonimliği temel bir ilkedir: hesap yok, kimliği bağışçıya ya da esnafa gösterilmez, kesin konumu
saklanmaz.

## Kurulum

Sunucu (Docker gerekir; PHP yalnızca konteynerlerin içinde çalışır), bu klasörden. İlk açılışta
sunucu konteyneri Composer paketlerini kurar ve `.env.example` dosyasından `server/.env` oluşturur:

```sh
docker compose up -d --wait
docker compose exec server php artisan migrate --seed
docker compose exec server php artisan test
```

Ardından web http://localhost:58080, Mailpit http://localhost:58025 adresinde çalışır.

Uygulama (Flutter SDK gerekir), `app/` içinden. drift kodu üretilir, depoda tutulmaz:

```sh
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter analyze
flutter test
flutter build apk --debug --flavor dev --dart-define-from-file=env/example.json
```

Katkı kuralları ve kalan komutlar (PHPStan, Pint, Horizon) [`CONTRIBUTING.md`](CONTRIBUTING.md)
dosyasında; ortam değişkenleri [`docs/ops/env.md`](docs/ops/env.md) dosyasında.

## CI

- `Askida CI`: sunucu (Pint, PHPStan, atlanan testleri hata sayan test paketi), uygulama (biçim,
  analiz, test, debug APK), marka token'ları, tüm geçmişte gitleaks ile yer tutucu grep'i ve
  bilgilendirme amaçlı Lighthouse.
- `Askida Security`: tüm geçmişte gitleaks, Composer denetimi, `composer.lock` ve `pubspec.lock`
  için OSV taraması, CycloneDX SBOM, bilgilendirme amaçlı `flutter pub outdated` ve OWASP ZAP.
- `Askida restore drill`: şifreli bir veritabanı arşivini işe özel bir MinIO bucket'ına yazar ve
  yeni bir PostGIS'e geri yükler.

## Dokümantasyon

- Ürün ve teknik tanım: [`04-askida-flutter.md`](04-askida-flutter.md)
- Mimari kararlar: [`docs/adr/`](docs/adr/)
- API: [`docs/api/openapi.yaml`](docs/api/openapi.yaml) ve [`docs/api/README.md`](docs/api/README.md)
- Güvenlik: [doğrulama matrisi](docs/security/verification-matrix.md), [tehdit modeli](docs/security/threat-model.md), [yetkilendirme matrisi](docs/security/authorization-matrix.md), [saldırı raporu](docs/security/attack-report.md), [pentest raporu](docs/security/pentest-report.md), [XSS taraması](docs/security/xss-sweep.md), [ZAP](docs/security/zap-report.md) ve [MobSF](docs/security/mobsf-report.md) raporları, [bağımlılık denetimi](docs/security/dependency-audit.md), [geçmiş temizleme runbook'u](docs/security/history-purge-runbook.md)
- Operasyon: [yayın](docs/ops/deploy.md), [ortam](docs/ops/env.md), [yedekleme ve geri yükleme](docs/ops/backup-restore.md), [maliyet uyarıları](docs/ops/cost-alerts.md)
- Yayın: [mağaza metni](docs/release/store-listing.tr.md), [gizlilik etiketleri](docs/release/privacy-labels.md), [imzalama](docs/release/signing.md), [ekran görüntüleri](docs/release/screenshots/README.md)
- SEO ve GEO: [kontrol listesi](docs/seo/seo-geo-checklist.md), [ASO](docs/seo/aso.md)
- Devir notları: [`docs/handoffs/`](docs/handoffs/)

## Lisans

Bu proje Apache License 2.0 ile lisanslanmıştır. Bkz. [LICENSE](../LICENSE).
