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

Faz 6 (sertleştirme ve yayına hazırlık) faz 5'in üzerine, bir çekme isteği için `feat/inecekvar-p6` dalında kuruldu (birleşmedi): saldırı takımı ve kayıtlı XSS taraması, ZAP ve MobSF taramaları, bir güvenlik iş akışında bağımlılık denetimleri ve statik taramalar, haftalık geri yükleme tatbikatı ve kurcalama denetimleriyle şifreli yedekler, planlayıcı düşük kipiyle maliyet korumaları ve log temizleme, mağaza metinleri, gizlilik etiketleri ve yayın kontrol listesi, geçmiş temizleme el kitabı (çalıştırılmadı), web'den hesap silme paneli ve ilk kurulum komutu, bağımsız inceleme düzeltmeleri. Kapı `docs/adr/0058-phase-6-gate.md`, son rapor `docs/handoffs/final-report.md`, son matris `docs/security/verification-matrix.md`: 23 maddenin 15'i tamam, 8'i kısmi, 0 başlanmamış, yani 23/23 değil; kısmi satırlar barındırma, alan adı ve TLS, R2, sağlayıcı hesapları, iş akışlarının GitHub çalıştırmaları, iOS ve sahip kararları gerektiriyor. Faz 5 (yalnızca API) açık çekme isteği #127'de (henüz birleşmedi): gece REST mutabakatlı RevenueCat webhook'u ve ilk şehirden sonraki paketler için sunucu tarafında Plus hakkı, hesap silmede RevenueCat abonesinin silinmesi, e-posta göndericinin baktığı karma değerli engel listesiyle Resend webhook'u ve deneme kipli, tekrar çalıştırılabilir gece işleri. Kapı `docs/adr/0050-webhooks-and-entitlements.md`, rapor `docs/handoffs/phase-5-report.md`. Faz 5'te denenmeyenler: gerçek RevenueCat ve Resend hesapları ve onların imzaladığı istekler, mağaza satın alımı, gerçek zamanda tetiklenen zamanlanmış işler. Faz 4 `main`'e birleşti (çekme isteği #126): şehir, hat, durak ve rota sayfaları sunucuda çizilen SVG haritalarla Angular SSR web, beş rehber, SSS, açık veri ve yasal sayfalar, site haritaları, robots, JSON-LD, SVG Open Graph görselleri, `llms.txt`, uygulama ilişkilendirme dosyaları ve TOTP adım doğrulamalı, yalnızca istemcide çalışan `/admin` moderasyon ve yönetim alanı (API tarafı: TOTP kaydı, oturuma bağlı adım doğrulama, yönetim rotaları). Faz 4 kapısı `docs/adr/0042-phase-4-gate.md`, raporu `docs/handoffs/phase-4-report.md`: gerçek API'ye karşı moderasyon e2e yeşil, JSON-LD 8 sayfa türünde geçerli, Lighthouse 5 sayfada performans, erişilebilirlik ve en iyi uygulamalarda 100, SEO 2 sayfada 100, tasarım gereği `noindex` olan 3 örnek şehir sayfasında 66. Faz 4'te denenmeyenler: gerçek TLS ve HSTS preload, Search Console ve Rich Results, iOS evrensel bağlantıları, gerçek bir doğrulayıcı uygulaması, barındırılan Caddy, CDN. Faz 0-3 kuruldu: çift kimlik doğrulamalı API çekirdeği (faz 1), alan modeli, moderasyon, planlayıcı, şehir paketleri, dışa aktarım ve hesap silme (faz 2), Ionic uygulama ve PWA (faz 3: arama ve harita, hat ve durak sayfaları, planlayıcı, çevrimdışı paketler, giriş ve katkı araçları, favoriler, hesap silmeli ayarlar, mağaza adaptörü arkasında Plus ekranı, uygulama bağlantıları, Türkçe ve İngilizce). Faz 3 kapısı `docs/adr/0036-phase-3-gate.md`, raporu `docs/handoffs/phase-3-report.md`. Faz 3'te denenmeyenler: iOS (macOS makine yok), gerçek RevenueCat hesabı ve mağaza satın alımı, doğrulanmış uygulama bağlantıları (yayında `assetlinks.json` yok), emülatörde çalışan bir API'ye bağlı uygulama, gerçek PMTiles altlığı. Faz 0 (temel) altyapıyı kurdu. Klasörde şunlar var: `apps/mobile` (Capacitor üzerinde Ionic 9, Android projesi depoda), `apps/web` (Angular SSR) ve `libs/` altındaki ui, domain ve data-access kütüphaneleriyle Nx workspace; `/v1/health` uç noktası ve PostGIS bağlantı testi olan `api/` FastAPI projesi; yerel Docker Compose yığını (PostGIS, Redis, MinIO, Mailpit, Caddy); marka token'ları ve logo seti; `docs/` altında ADR'ler, ortam değişkenleri rehberi ve güvenlik taslakları; `inecekvar-ci.yml` iş akışı. Çözümlenen sürümler ve Faz 0 kanıtları `docs/adr/0001-stack-and-versions.md` dosyasında.

Şimdiye kadar denenmeyenler: iOS (macOS makine yok), GitHub Actions üzerinde CI iş akışı (dal push edilmedi), lefthook kancalarının kendisi, APK'nın emülatörde veya cihazda çalıştırılması, Caddy arkasındaki geliştirme sunucuları ve marka ikonlarının SSR favicon'una ve Android başlatıcı ikonuna bağlanması.

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
uv run uvicorn app.main:app --host 127.0.0.1 --port 57800 --no-proxy-headers --forwarded-allow-ips 127.0.0.1
```

Compose yalnızca veri ve proxy servislerini çalıştırır; API ve geliştirme sunucuları makinede çalışır. Portlar ve ortam değişkenleri `docs/ops/env.md` dosyasında.

## Lisans

Bu proje Apache License 2.0 ile lisanslanmıştır. Bkz. [LICENSE](../LICENSE).
