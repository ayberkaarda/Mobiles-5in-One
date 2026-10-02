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

## Planlanan teknoloji yığını

| Katman | Teknoloji |
|---|---|
| Mobil uygulama | Flutter (iOS ve Android), Riverpod, go_router, drift |
| Backend API | Laravel (PHP 8.3+), Sanctum |
| Yönetim paneli | Filament 3 |
| Veritabanı | PostgreSQL + PostGIS |
| Kuyruk ve önbellek | Redis, Horizon |
| Nesne depolama | S3 uyumlu (Cloudflare R2) |
| Ödeme | iyzico pazaryeri ödemeleri (Checkout Form ve alt üye işyeri) |
| Web | Laravel Blade, sunucu tarafı render |
| Cihaz doğrulama | Play Integrity (Android) ve DeviceCheck (iOS), platform channel ile |

## Planlanan mimari

İki ana kökü olan bir monorepo: Flutter istemcisi için `app/`, Laravel backend için `server/`; yanında `brand/` ve `docs/`. Flutter uygulaması tek kod tabanında bağışçı, esnaf ve alan modlarını barındırır. Backend, `/api/v1` altında sürümlü bir JSON API sunar, Blade web sitesini render eder ve Filament yönetim panelini barındırır. Para, TRY cinsinden kuruş (tam sayı) olarak tutulur; platform parayı elinde tutmaz, ödeme bağışçıdan ödeme sağlayıcı üzerinden esnafa akar. Alan kişinin anonimliği temel bir ilkedir: hesap yok, kimliği bağışçıya ya da esnafa gösterilmez, kesin konumu saklanmaz.

## Durum

Bu klasörde şu an yalnızca tasarım/spec dokümanı var; kaynak kod henüz yazılmadı.

## Kurulum

Henüz kod yok, bu yüzden kurulacak ya da çalıştırılacak bir şey de yok. Ürün ve teknik tanım bu klasörde `04-askida-flutter.md` dosyasında duruyor. Geliştirme başlayınca bu README güncellenecek.
