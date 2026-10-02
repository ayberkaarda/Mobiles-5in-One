[English](README.md) | Türkçe

# Kadro

Halı saha maçları için organizasyon uygulaması. Kadronu kur, eksik oyuncuyu bul, saha ücretini böl.
Uygulama içinde para hareketi olmaz; kaptan yalnızca kimin ödediğini takip eder.

## Durum

Geliştirme aşamasında. Phase 0 (iskelet) ve Phase 1 (veri modeli, kimlik doğrulama, güvenlik
çekirdeği) tamamlandı. Domain API, mobil uygulama, SEO sayfaları, abonelik ve yönetim paneli
planlanıyor; henüz uygulanmadı.

`apps/mobile` bir iskelet (Expo Router giriş ekranları), `apps/worker` loglama içeren çalışır bir
iskelet, `apps/web` ise şu an kimlik doğrulama API'sini (`/api/v1/auth/*`, `/api/v1/me`,
`/api/v1/health`) ve geçici bir ana sayfayı sunuyor.

## MVP özellikleri

| Özellik                                                                        | Durum                                  |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| E-posta + şifre ile kayıt ve giriş, Apple ve Google ile giriş, şifre sıfırlama | Uygulandı (auth API, Phase 1)          |
| Veritabanı şeması, migration'lar ve seed verisi (ilçeler, örnek sahalar)       | Uygulandı (Phase 1)                    |
| Takımlar, roller (kaptan, yardımcı kaptan, oyuncu), davet bağlantıları         | Planlı (Phase 2)                       |
| Maçlar, yedek listeli RSVP, pozisyona göre dengelenen kadro dizilimi           | Planlı (Phase 2 API, Phase 3 uygulama) |
| Ücret bölüşümü ve ödendi/ödenmedi takibi                                       | Planlı (Phase 2 API, Phase 3 uygulama) |
| "Eksik Var": eksik oyuncu ilanı yayınlama, göz atma ve başvuru                 | Planlı (Phase 2 API, Phase 3 uygulama) |
| Puan ve yorumlu saha rehberi ("Saha Rehberi")                                  | Planlı (Phase 2 API, Phase 3 uygulama) |
| Worker üzerinden hatırlatma ve bildirimler (push, e-posta)                     | Planlı (Phase 2)                       |
| Maçın oyuncusu (MVP) oylaması ve temel oyuncu istatistikleri                   | Planlı                                 |
| Kadro Pro aboneliği (RevenueCat), sunucu tarafında doğrulanan yetkiler         | Planlı (Phase 5)                       |
| Uygulama içinden ve web üzerinden hesap silme                                  | Planlı                                 |
| Tanıtım sitesi, saha sayfaları, açık ilan listeleri, davet landing sayfaları   | Planlı (Phase 4)                       |

MVP kapsamı dışında bilinçli olarak bırakılanlar: oyuncular arası uygulama içi ödeme, saha rezervasyon
entegrasyonu, canlı sohbet, video, reklam, lig ve turnuvalar, Türkçe ve İngilizce dışındaki diller.

## Teknoloji yığını

- Mobil: Expo (React Native), Expo Router, TypeScript
- Web ve API: Next.js (App Router), `/api/v1` altında REST
- Veritabanı: PostGIS'li PostgreSQL 16, Drizzle ORM ve SQL migration'ları
- Arka plan işleri: pg-boss (worker uygulaması)
- Doğrulama ve sözleşmeler: zod
- Şifreler: Argon2id; erişim token'ları: ES256 JWT; rotasyonlu refresh token'lar
- Araçlar: pnpm workspaces, Turborepo, Vitest, ESLint, Prettier

Sabitlenmiş sürümler ve gerekçeleri
[`docs/adr/0001-stack-and-versions.md`](docs/adr/0001-stack-and-versions.md) dosyasında.

## Depo yapısı

```
apps/
  mobile/      Expo uygulaması (iskelet)
  web/         Next.js: API (/api/v1) ve web sayfaları
  worker/      pg-boss iş çalıştırıcısı
packages/
  auth/        yetkilendirme politikası, şifre hashleme, token araçları
  brand/       tasarım token'ları, logo SVG'leri, fontlar
  config/      doğrulanmış ortam yapılandırması (process.env'i okuyan tek modül)
  contracts/   zod şemaları ve paylaşılan tipler
  db/          Drizzle şeması, migration'lar, seed verisi
docs/
  adr/         mimari karar kayıtları
  handoffs/    paketler arası devir notları
  ops/         barındırma ve operasyon
  security/    yetkilendirme matrisi, tehdit modeli, doğrulama matrisi
```

## Gereksinimler

- Node.js: [`.nvmrc`](.nvmrc) dosyasındaki sürüm (`engines` alanı en az 22.12.0 ister)
- pnpm: [`package.json`](package.json) içindeki `packageManager` alanında sabitlenen sürüm
- Docker: yerel veritabanı ve veritabanı kullanan testler için

## Kurulum ve çalıştırma

Tüm komutlar bu dizinden (`kadro/`) çalıştırılır.

```sh
pnpm install
cp .env.example .env
pnpm --silent --filter @kadro/config secrets:generate
```

`secrets:generate` imzalama anahtarlarını, CSRF sırrını ve hash sırrını yazdırır; bunları `.env`
içindeki boş anahtarların üzerine yapıştırın. Bu değerler boşken web uygulaması başlamaz.

```sh
pnpm db:up                           # Docker'da PostgreSQL + PostGIS
pnpm build                           # workspace paketleri önce derlenmeli
pnpm --filter @kadro/db db:migrate   # migration'ları uygula
pnpm --filter @kadro/db db:seed      # ilçeler ve [ÖRNEK] sahalar
pnpm dev                             # http://localhost:3000 üzerinde web ve worker
```

Diğer komutlar:

| Komut                                         | Amaç                                                 |
| --------------------------------------------- | ---------------------------------------------------- |
| `pnpm worker:dev`                             | yalnızca worker                                      |
| `pnpm mobile:start`                           | Expo geliştirme sunucusunu başlatır                  |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | tüm paketlerde lint, tip kontrolü ve derleme         |
| `pnpm test`                                   | tüm testleri çalıştırır                              |
| `pnpm format` / `pnpm format:check`           | Prettier biçimini yazar veya denetler                |
| `docker compose up --build`                   | tüm yığın konteynerlerde (web + worker + veritabanı) |

## Ortam değişkenleri

[`.env.example`](.env.example) tüm değişkenleri açıklamalarıyla listeler. İmzalama anahtarları,
CSRF sırrı ve hash sırrı dışındaki değerler yerel geliştirme için örnek değerlerdir; bu üçü bilerek
boş bırakılmıştır ve her makinede `pnpm --silent --filter @kadro/config secrets:generate` ile
üretilir. Preview ve production değerleri barındırma sağlayıcısının sır deposunda tutulur, depoya
asla girmez. Zorunlu bir değişken eksik veya geçersizse uygulamalar açılışta hata verip durur.

## Testler

`pnpm test` her paketin Vitest testlerini çalıştırır. Veritabanı testleri (`@kadro/db`) ve web API
testleri (`@kadro/web`) geçici bir PostGIS konteyneri başlatır; bu yüzden çalışan bir Docker daemon
gerekir. Docker yoksa testler açık bir hata mesajıyla başarısız olur.

## Güvenlik yaklaşımı

Yetkilendirme belgelenmiş bir matristen yola çıkılarak sunucu tarafında uygulanır; sırlar asla
commit'lenmez; refresh token'lar, davet kodları ve e-posta token'ları yalnızca hash olarak saklanır;
kimlik doğrulama uç noktalarında rate limit vardır; yanıtlar katı header'lar ve yüzey bazlı CSP
taşır. CI, tüm geçmişi sır için tarar ve bağımlılıkları denetler. Ayrıntılar:

- [`docs/security/authorization-matrix.md`](docs/security/authorization-matrix.md)
- [`docs/security/threat-model.md`](docs/security/threat-model.md)
- [`docs/security/verification-matrix.md`](docs/security/verification-matrix.md)
- [`docs/security/history-purge-runbook.md`](docs/security/history-purge-runbook.md)
- [`docs/adr/`](docs/adr/) (güvenlikle ilgili kararlar: ADR 0011, 0014, 0015, 0019, 0021 gibi)

## Dokümantasyon

- [`docs/adr/README.md`](docs/adr/README.md): mimari karar kayıtlarının dizini
- [`docs/security/`](docs/security/): güvenlik dokümanları
- [`docs/ops/README.md`](docs/ops/README.md): barındırma ve operasyon
- [`docs/handoffs/`](docs/handoffs/): paketler arası devir notları

Henüz commit'lenmiş bir OpenAPI dokümanı yok; domain API ile birlikte planlanıyor.

## Yol haritası

- Phase 0, iskelet: tamam
- Phase 1, veri, kimlik doğrulama ve güvenlik çekirdeği: tamam
- Phase 2, domain API ve worker işleri (takımlar, maçlar, açık ilanlar, sahalar, yüklemeler, hatırlatmalar)
- Phase 3, mobil uygulama
- Phase 4, web SEO sayfaları ve herkese açık listeler
- Phase 5, Kadro Pro aboneliği, webhook ve yönetim paneli
- Phase 6, sertleştirme ve yayına hazırlık

## Lisans

Paketler `package.json` dosyalarında `UNLICENSED` olarak işaretlidir; depoda `LICENSE` dosyası
yoktur.
