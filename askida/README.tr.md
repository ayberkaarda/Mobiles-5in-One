[English](README.md) | Türkçe

# Askıda

Slogan: "İyilik askıda kalmasın."

## Ürün özeti

Askıda, Türkiye'deki "askıda ekmek" geleneğinden doğan bir iyilik ağı. Bağışçılar ekmek, çorba, yemek ya da kırtasiye gibi gündelik ihtiyaçları doğrulanmış mahalle esnafında önceden öder; ihtiyacı olan kişi hesap açmadan, anonim kalarak tek kullanımlık bir kodla askıdan alır. Tek bir mobil uygulama üç modda çalışır: bağışçı, esnaf ve alan. Dil sıcak, saygılı ve sadedir; acıma ya da hayır afişi duygusallığı yoktur.

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

## Kapsam dışı

- Kişilere nakit bağış
- Alan kişi için hesap veya profil
- Sohbet
- Alan kişilerin puanlanması
- Eczane ve tıbbi ürünler
- Çoklu para birimi
- Teslimat
- Reklam
- Kurumsal bağışçı fatura portalı (v2'de düşünülüyor)

## Teknoloji yığını

| Katman             | Teknoloji                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Mobil uygulama     | Flutter 3.47.6 ve Dart 3.13.5 (iOS ve Android), Riverpod 3.4.3, go_router 18.0.2; drift sonraki bir fazda eklenecek |
| Backend API        | PHP 8.3.35 üzerinde Laravel 13.34.0 (yalnızca Docker'da), Sanctum 4.3.3                                             |
| Yönetim paneli     | Filament 3.3.55                                                                                                     |
| Veritabanı         | PostgreSQL 16.9 + PostGIS 3.5.2                                                                                     |
| Kuyruk ve önbellek | Redis 7.4.11, Horizon 5.50.0                                                                                        |
| Nesne depolama     | S3 uyumlu (Cloudflare R2)                                                                                           |
| Ödeme              | iyzico pazaryeri ödemeleri (Checkout Form ve alt üye işyeri)                                                        |
| Web                | Laravel Blade, sunucu tarafı render                                                                                 |
| Cihaz doğrulama    | Play Integrity (Android) ve DeviceCheck (iOS), platform channel ile                                                 |

## Mimari

İki ana kökü olan bir monorepo: Flutter istemcisi için `app/`, Laravel backend için `server/`; yanında `brand/` ve `docs/`. Flutter uygulaması tek kod tabanında bağışçı, esnaf ve alan modlarını barındırır. Backend, `/api/v1` altında sürümlü bir JSON API sunar, Blade web sitesini render eder ve Filament yönetim panelini barındırır. Para, TRY cinsinden kuruş (tam sayı) olarak tutulur; platform parayı elinde tutmaz, ödeme bağışçıdan ödeme sağlayıcı üzerinden esnafa akar. Alan kişinin anonimliği temel bir ilkedir: hesap yok, kimliği bağışçıya ya da esnafa gösterilmez, kesin konumu saklanmaz.

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

## Durum

Phase 0 ile Phase 6 arası bir portfolyo projesi olarak uygulandı: Laravel sunucusu (kimlik doğrulama,
dükkânlar ve doğrulama, askı ve kullanım, sahte sağlayıcıyla ödemeler, aktarımlar, yönetim paneli,
herkese açık web sayfaları, açık veri, yedekler, maliyet korumaları), üç modlu Flutter uygulaması
(Android emülatöründe doğrulandı, iOS için macOS gerektiğinden derlenmedi) ve güvenlik çalışmaları
(saldırı paketi, kalıcı XSS taraması, ZAP ve MobSF taramaları, bağımlılık denetimleri). Nihai doğrulama
matrisi 23 maddenin 14'ünü tamam, 9'unu kısmi olarak notlandırıyor, her birinin gerekçesiyle:
[`docs/security/verification-matrix.md`](docs/security/verification-matrix.md). Hiçbir şey yayınlanmadı:
alan adı, mağaza kaydı veya ödeme sağlayıcı hesabı yok, hukuki metinler örnek olarak etiketli.
Çözümlenen sürümler [`docs/adr/0001-stack-and-versions.md`](docs/adr/0001-stack-and-versions.md)
dosyasında kayıtlı.

## Kurulum

Ürün ve teknik tanım bu klasörde `04-askida-flutter.md` dosyasında duruyor. Katkı kuralları ve tüm
komutlar [`CONTRIBUTING.md`](CONTRIBUTING.md) dosyasında.

Sunucu (Docker gerekir; PHP yalnızca konteynerlerin içinde çalışır), bu klasörden:

```sh
docker compose up -d --wait
docker compose exec server php artisan test
```

Uygulama (Flutter SDK gerekir), `app/` içinden:

```sh
flutter pub get
flutter analyze
flutter test
dart format --set-exit-if-changed .
```
