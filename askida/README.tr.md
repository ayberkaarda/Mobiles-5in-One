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

## Durum

Phase 0 (temel) birleşti: Laravel sunucusu Docker'da çalışıyor (sağlık rotası, Filament yönetim
paneli, Horizon, Sanctum), Flutter uygulaması tasarım sistemiyle bir iskelet; marka paketi,
ADR-0001 ile ADR-0006, güvenlik matrisi taslakları ve bir CI iş akışı hazır. Henüz API uç noktası
ve ödeme yok, mod kabuğu dışında ekran da yok. iOS projesi derlenmedi (macOS gerekir). Çözümlenen
sürümler [`docs/adr/0001-stack-and-versions.md`](docs/adr/0001-stack-and-versions.md) dosyasında
kayıtlı.

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
