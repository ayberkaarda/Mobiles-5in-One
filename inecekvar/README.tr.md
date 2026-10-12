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
| Mobil ve PWA | Ionic 9, Angular, Capacitor |
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

Faz 0 (temel) hazır; henüz ürün özelliği yok. Klasörde şunlar var: `apps/mobile` (Capacitor üzerinde Ionic 9, Android projesi depoda), `apps/web` (Angular SSR) ve `libs/` altındaki ui, domain ve data-access kütüphaneleriyle Nx workspace; `/v1/health` uç noktası ve PostGIS bağlantı testi olan `api/` FastAPI projesi; yerel Docker Compose yığını (PostGIS, Redis, MinIO, Mailpit, Caddy); marka token'ları ve logo seti; `docs/` altında ADR'ler, ortam değişkenleri rehberi ve güvenlik taslakları; `inecekvar-ci.yml` iş akışı. Çözümlenen sürümler ve Faz 0 kanıtları `docs/adr/0001-stack-and-versions.md` dosyasında.

Faz 0'da denenmeyenler: iOS (macOS makine yok), GitHub Actions üzerinde CI iş akışı (dal push edilmedi), lefthook kancalarının kendisi, APK'nın emülatörde veya cihazda çalıştırılması, Caddy arkasındaki geliştirme sunucuları ve marka ikonlarının SSR favicon'una ve Android başlatıcı ikonuna bağlanması.

## Kurulum

Ürün ve teknik tanım bu klasörde `05-inecekvar-ionic-angular.md` dosyasında duruyor. Gerekenler: Node 22, pnpm 12, uv, Docker; Android derlemesi için JDK 21. Faz 0 kapıları ADR-0001'deki gibi `inecekvar/` içinden çalışır:

```sh
pnpm install --frozen-lockfile
pnpm exec prettier --check .
pnpm nx run-many -t lint test build --skip-nx-cache
docker compose up -d
```

ve `inecekvar/api/` içinden:

```sh
uv sync --locked
uv run ruff check . && uv run ruff format --check . && uv run mypy --strict app tests
uv run pytest
uv run uvicorn app.main:app --host 127.0.0.1 --port 57800
```

Compose yalnızca veri ve proxy servislerini çalıştırır; API ve geliştirme sunucuları makinede çalışır. Portlar ve ortam değişkenleri `docs/ops/env.md` dosyasında.

## Lisans

Bu proje Apache License 2.0 ile lisanslanmıştır. Bkz. [LICENSE](../LICENSE).
