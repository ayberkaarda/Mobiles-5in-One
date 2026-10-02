[English](README.md) | Türkçe

# İnecek Var

Slogan: "Dolmuş nereden geçer? Mahalle bilir."

## Ürün özeti

İnecek Var, resmî verisi çoğu zaman bulunmayan dolmuş, minibüs ve servis hatlarını mahallelinin birlikte haritaladığı bir hat rehberi. Yolcular hat, durak, ücret ve saatlere bakabilir, aktarmalı A→B rota planlayabilir ve çevrimdışı şehir paketleri indirebilir. Katkıcılar yolculuğu GPS izi olarak kaydeder, hat önerir ya da düzenler; moderatörler inceleyip yayınlar. Ad, yolcuların dolmuşu durdurmak için bağırdığı sözden geliyor. Dil sokak ağzına yakın, esprili ve net.

## MVP özellikleri

- Hat kodu veya adıyla, serbest metinle ya da yer yazarak/haritaya dokunarak A→B arama; cihaz konumuyla yakındaki hatlar.
- Hat sayfası: haritada güzergâh, sıralı duraklar, güncelleme tarihli ücret, saatler, ödeme yöntemleri, nasıl durdurulur notları, son doğrulama tarihi ve "Bu hat değişti" bildirimi.
- A→B planlayıcı: en fazla 2 aktarmalı, 3 seçenekli rota ve tahmini ücret.
- Çevrimdışı şehir paketleri (hat ve durak verisi, harita altlığı); ücretsiz planda 1 şehir.
- Katkıcılar: e-posta/şifre veya magic link ile kayıt, yolculukta iz kaydı, durak işaretleme, ücret/saat/not ve isteğe bağlı fotoğrafla öneri gönderme, mevcut hatları düzenleme.
- Moderasyon: harita farkı gösteren inceleme kuyruğu, değiştirilemez hat sürümüne onaylama, gerekçeyle reddetme, herhangi bir sürüme geri alma; katkıcı kendi önerisini onaylayamaz.
- Favoriler: misafirde yerelde, giriş yapanda senkronize.
- Plus aboneliği (yalnızca native uygulamalar): sınırsız çevrimdışı şehir ve destekçi rozeti.
- Açık veri: şehir bazında haftalık, açık lisanslı herkese açık dışa aktarma.
- Uygulama içinden ve web'den hesap silme; katkılar lisans kapsamında anonimleştirilerek kalır.
- Web: şehir sayfaları, hat ve durak sayfaları, rehber yazıları, yasal sayfalar ve moderasyon/admin arayüzü.

## Kapsam dışı

- Gerçek zamanlı araç takibi
- Bilet satışı
- Araç çağırma
- Resmî veri iddiası
- Reklam
- Sürücü hesapları
- Push bildirimleri (v2'de düşünülüyor)
- Şehirler arası rota

## Planlanan teknoloji yığını

| Katman | Teknoloji |
|---|---|
| Mobil ve PWA | Ionic 8, Angular, Capacitor |
| Web | Angular SSR |
| Harita | MapLibre GL JS + PMTiles |
| Monorepo araçları | Nx, pnpm |
| Backend API | FastAPI (Python 3.12+), Pydantic v2 |
| Veritabanı | PostgreSQL + PostGIS, SQLAlchemy 2, Alembic |
| Önbellek ve işler | Redis, arq worker'ları |
| Nesne depolama | S3 uyumlu (Cloudflare R2) |
| Abonelik | RevenueCat (yalnızca native) |

## Planlanan mimari

Bir Nx workspace: `apps/mobile` (Ionic ve Angular, aynı zamanda PWA olarak sunulur), `apps/web` (Angular SSR) ve arayüz, domain tipleri ile API istemcisi için ortak `libs/`; bunların yanında ayrı bir Python `api/` projesi. Rota planlayıcı, yayın sırasında şehir başına bellekte bir graf kurar ve sonuçları önbelleğe alır. Web ve PWA istemcileri cookie oturumu, native istemciler bearer token kullanır; ikisi tek bir auth arayüzü arkasındadır. Herkese açık hat, durak ve şehir sayfaları sunucuda render edilir; güzergâh haritaları SVG olarak çizildiği için istemci tarafında harita kodu gerekmez. Ham GPS izleri yalnızca sahibine ve moderatörlere görünür; türetilen hat sürümü yayınlandıktan 30 gün sonra silinir.

## Durum

Bu klasörde şu an yalnızca tasarım/spec dokümanı var; kaynak kod henüz yazılmadı.

## Kurulum

Henüz kod yok, bu yüzden kurulacak ya da çalıştırılacak bir şey de yok. Ürün ve teknik tanım bu klasörde `05-inecekvar-ionic-angular.md` dosyasında duruyor. Geliştirme başlayınca bu README güncellenecek.
