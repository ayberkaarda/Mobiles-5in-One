[English](README.md) | Türkçe

# Mobiles-5in-One

Birbirinden bağımsız beş mobil ürünün portföy monoreposu. Her ürün farklı bir teknoloji yığınıyla
uçtan uca kuruldu: mobil uygulama, backend API, herkese açık SEO web sitesi ve yönetim alanı;
yanında testler, CI, güvenlik dokümanları ve yayın materyalleri. Her ürün kendi klasöründe, kendi
araçları ve yayın döngüsüyle yaşar; ürünler arasında paylaşılan kod yoktur. Hiçbiri bir mağazada ya
da üretim sunucusunda yayında değil: ödemeler, mağaza faturalaması ve üçüncü taraf sağlayıcılar
sahte servislere ya da sandbox'lara karşı çalışır; her README neyin gerçek, neyin simüle olduğunu
yazar. Herkese açık web sayfalarının statik görüntüleri
[GitHub Pages](https://ayberkaarda.github.io/Mobiles-5in-One/) üzerinde.

## Projeler

| Klasör                    | Ürün                                                                                                                                                      | Teknoloji                                                                      | Durum                                                          | Güvenlik matrisi (23 madde) |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------- |
| [`kadro`](kadro/)         | Halı saha maç organizasyonu: kadro kur, eksik oyuncuyu bul, saha ücretini böl                                                                             | Expo (React Native), Next.js, PostgreSQL + PostGIS, pg-boss                    | 0-6 arası fazlar birleşti, ardından açık ve koyu yeniden tasarım | 13 tamam, 10 kısmi          |
| [`askida`](askida/)       | "Askıda ekmek" geleneğine dayalı dayanışma ağı: bağışçılar doğrulanmış yerel esnaftan ürünleri önceden öder, ihtiyaç sahipleri tek kullanımlık kodla alır | Flutter, Laravel, PostgreSQL + PostGIS, Redis, iyzico (yerelde sahte sağlayıcı) | 0-6 arası fazlar birleşti                                      | 14 tamam, 9 kısmi           |
| [`cetele`](cetele/)       | Küçük esnaf için çevrimdışı çalışan dijital veresiye defteri                                                                                              | Kotlin (Jetpack Compose), Spring Boot, PostgreSQL                              | 0-6 arası fazlar birleşti, ardından sertleştirme ve tasarım paketleri | 12 tamam, 11 kısmi     |
| [`inecekvar`](inecekvar/) | Türkiye şehirleri için kitle kaynaklı dolmuş / minibüs hat haritası; A noktasından B noktasına planlama ve çevrimdışı şehir paketleri                     | Ionic (Angular + Capacitor), Angular SSR, FastAPI, PostgreSQL + PostGIS, Redis | 0-6 arası fazlar birleşti, ardından güzergâh tabelası tasarımı | 15 tamam, 8 kısmi           |
| [`patika`](patika/)       | Sokak hayvanları için topluluk platformu: besleme noktası haritası, "beslendi" bildirimleri, sahiplendirme ilanları, veteriner rehberi                    | .NET 10 MAUI (Android), ASP.NET Core, PostgreSQL + PostGIS                     | 0-6 arası fazlar birleşti, simüle Play faturalaması            | 19 tamam, 4 kısmi           |

Her proje temel kurulumdan (faz 0) sertleştirme ve yayına hazırlığa (faz 6) kadar yedi fazdan geçti
ve aynı 23 maddelik güvenlik kontrol listesini kendi doğrulama matrisinde notlandırır. `partial`
(kısmi) bir satır eksik kanıtı adıyla yazar; bu kanıtların çoğu burada bulunmayan sistemler
gerektirir (alan adı ve TLS, mağaza ya da sağlayıcı hesapları, bulut depolama, fiziksel cihaz, iOS).

## Galeri

Her proje için bir kart. Kartların düzeni aynı: gerçek web ana sayfasının (yerel derleme, örnek veri) bir Android ekranıyla kompoziti ve altında üç Android uygulama ekranı (emülatör, örnek veri). Tam setler [`kadro/docs/screenshots/README.md`](kadro/docs/screenshots/README.md), [`askida/README.tr.md`](askida/README.tr.md#ekran-görüntüleri), [`cetele/docs/release/screenshots`](cetele/docs/release/screenshots/README.md), [`inecekvar/docs/screenshots`](inecekvar/docs/screenshots/route-sign/) ve [`patika/README.tr.md`](patika/README.tr.md#galeri) içinde. "web demo" bağlantıları, her projenin gerçek herkese açık sayfalarının yerel derlemelerden alınmış statik görüntülerini (örnek veri) GitHub Pages'te açar ([dizin](https://ayberkaarda.github.io/Mobiles-5in-One/)); giriş, form ve ödeme orada çalışmaz.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/kadro.png" alt="Kadro: web ana sayfası ve mobil diziliş ekranı, örnek veri" width="100%"><br>
      <img src="kadro/docs/screenshots/mobile/03-matches-light.png" alt="Kadro mobil uygulaması: iki yaklaşan maçlı Maçlar sekmesi, örnek veri" width="32%">
      <img src="kadro/docs/screenshots/mobile/04-match-detail-rsvp-light.png" alt="Kadro mobil uygulaması: katılım yanıtı ve ücret payıyla maç detayı, örnek veri" width="32%">
      <img src="kadro/docs/screenshots/mobile/18-match-lineup-light.png" alt="Kadro mobil uygulaması: saha şemasında diziliş ve boş yerler, örnek veri" width="32%"><br>
      <sub><b>Kadro</b>: web sayfaları ve Android uygulama ekranları (emülatör, örnek veri); planlanan tüm fazlar birleşti · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/kadro/">web demo</a></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/askida.png" alt="Askıda web ana sayfası ve Android alıcı ekranı (yerel yığın, örnek veri)" width="100%"><br>
      <img src="askida/docs/release/screenshots/01-recipient-nearby.png" alt="Askıda alan kişi modu: yakındaki dükkânlar, örnek veri" width="32%">
      <img src="askida/docs/release/screenshots/04-donor-donate.png" alt="Askıda bağışçı modu: ürün ve adet, örnek veri" width="32%">
      <img src="askida/docs/release/screenshots/16-merchant-home.png" alt="Askıda esnaf modu: dükkân paneli, örnek veri" width="32%"><br>
      <sub><b>Askıda</b>: web ana sayfası ve Android alıcı ekranı (yerel yığın, örnek veri) · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/askida/">web demo</a></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/cetele.png" alt="Cetele kartı: web ana sayfası ve Android müşteri listesi, yerel sunucu, örnek veri" width="100%"><br>
      <img src="cetele/docs/release/screenshots/01-customers.png" alt="Cetele Android uygulaması: bakiyeleriyle müşteri listesi, örnek müşteriler, emülatör" width="32%">
      <img src="cetele/docs/release/screenshots/02-customer-ledger.png" alt="Cetele Android uygulaması: bir müşterinin hesabı, borçlar, tahsilat ve üstü çizili düzeltilmiş kayıt, örnek veri, emülatör" width="32%">
      <img src="cetele/docs/release/screenshots/03-dashboard.png" alt="Cetele Android uygulaması: toplam alacak ve en çok borçlu müşterilerle panel, örnek veri, emülatör" width="32%"><br>
      <sub><b>Cetele</b>: web ana sayfası ve Android müşteri listesi (yerel sunucu, örnek veri) · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/cetele/">web demo</a></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/inecekvar.png" alt="Inecek Var kartı: kırmızı hat tabelası, nereden-nereye panosu ve sokak çizimiyle web ana sayfası ve ORN-1 plakası, durak şeması ve ücret biletiyle Android hat sayfası, yerel yığın, örnek veri" width="100%"><br>
      <img src="inecekvar/docs/screenshots/route-sign/android-01-search.png" alt="Inecek Var Android uygulaması: Nereye inecek var? tabelası, etiketli örnek şehir ve kısayollarla arama ekranı, örnek veri, emülatör" width="32%">
      <img src="inecekvar/docs/screenshots/route-sign/android-02-line.png" alt="Inecek Var Android uygulaması: ORN-1 plakası, ilk ve son durak, durak şeması ve ücret biletiyle hat sayfası, örnek veri, emülatör" width="32%">
      <img src="inecekvar/docs/screenshots/route-sign/android-03-planner-dark.png" alt="Inecek Var Android uygulaması koyu temada: iki aktarmalı A'dan B'ye sonucu, hat plakaları ve durak şeması, örnek veri, emülatör" width="32%"><br>
      <sub><b>Inecek Var</b>: web ana sayfası ve Android arama, hat ve rota ekranları, açık ve koyu tema (yerel yığın, örnek veri) · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/inecekvar/">web demo</a></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/patika.png" alt="Patika kartı: giriş bölümü ve Moda sabah turu haritasıyla web ana sayfası ve Pamuk ile Karabaş künye kartlarıyla Android sahiplendirme listesi, yerel yığın, örnek veri" width="100%"><br>
      <img src="patika/docs/design/screenshots/android-harita.png" alt="Patika Android uygulaması: istasyon iğneleri, filtreler ve Beslendi düğmeli istasyon paneliyle harita, örnek veri, emülatör" width="32%">
      <img src="patika/docs/design/screenshots/android-acil.png" alt="Patika Android uygulaması: Acil yardım çağrısı aç düğmesi ve yakındaki bakım yerleriyle koyu acil yardım ekranı, örnek veri, emülatör" width="32%">
      <img src="patika/docs/design/screenshots/destekci-profile.png" alt="Patika Android uygulaması: simüle test satın alımından sonra Patika Destekçi kartı ve rozetiyle profil, emülatör" width="32%"><br>
      <sub><b>Patika</b>: web ana sayfası ve Android sahiplendirme, harita, acil yardım ve Destekçi ekranları (yerel yığın, örnek veri, simüle ödeme) · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/patika/">web demo</a></sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Durum

**Kadro.** Yedi fazın hepsi birleşti: domain API ve pg-boss worker'ı, Expo uygulaması, Next.js
tanıtım ve SEO sayfaları, ekip yönetim paneliyle Kadro Pro aboneliği (RevenueCat) ve sertleştirme
işleri (saldırı testleri, MobSF taraması, bağımlılık denetimi, geri yükleme tatbikatı, cost guard,
mağaza metinleri, gizlilik etiketleri, SEO ve GEO kontrol listesi); ardından açık ve koyu görünümlü
yeniden tasarım (ADR-0084) geldi. Açık kalanlar: 11 Maestro akışının kayıtlı bir koşusu yok, satın
almalar gerçek mağaza hesaplarına karşı denenmedi, Lighthouse laboratuvar LCP değeri bazı
sayfalarda 2,5 ile 2,7 sn; barındırılan bir origin, Sentry hesabı, üretim yedek bucket'ı ve iOS
derlemesi yok. Bkz. [`kadro/README.tr.md`](kadro/README.tr.md).

**Askıda.** Yedi fazın hepsi birleşti: Docker'da çalışan Laravel sunucusu (kimlik doğrulama,
dükkânlar ve katalog, askılar, iyzico akışıyla bağışlar, webhook'lar, esnaf hakedişleri, Filament
yönetim paneli, OpenAPI sözleşmesi), bağışçı, esnaf ve anonim alıcılar için Flutter uygulaması, SEO
ve GEO ile herkese açık web ve sertleştirme fazı (saldırı testleri, kalıcı XSS taraması, ZAP ve
MobSF taramaları, bağımlılık denetimleri, geri yükleme tatbikatlı şifreli yedekler, gönderim
bütçesi, yayın ve mağaza dokümanları). Gerçek ödeme ve cihaz doğrulaması denenmedi, iOS hiç
derlenmedi. Bkz. [`askida/README.tr.md`](askida/README.tr.md).

**Cetele.** Yedi fazın hepsi birleşti: Spring Boot sunucusu (kimlik doğrulama, değişiklik
günlüğüyle senkronizasyon, defter, hatırlatma, medya, Play faturalama, webhook'lar, yönetim
konsolu), çevrimdışı çalışan Android uygulaması (Kotlin, Jetpack Compose, yerel giden kutusu, Play
Billing), SEO ve GEO ile herkese açık web ve yayın sertleştirmesi; ardından bir sertleştirme paketi
(PR #115), tasarım yenilemesi (PR #116) ve ikinci güvenlik paketi (PR #117) geldi. Play Billing,
RTDN ve Play Integrity sahte adaptörlere ve kayıtlı fixture'lara karşı çalıştı; fiziksel cihaz ve
uçtan uca akış koşusu yok. Bkz. [`cetele/README.tr.md`](cetele/README.tr.md).

**Inecek Var.** Yedi fazın hepsi birleşti (PR #118 ile #121, #123 ve #126 ile #128): Capacitor
Android kabuğu üzerinde Ionic/Angular uygulama ve PWA, şehir, hat ve durak sayfaları, rehberler ve
moderasyon ile yönetim alanı olan Angular SSR web içeren bir Nx workspace'i; çift kimlik doğrulama,
moderasyon, izler, planlayıcı, şehir paketleri, dışa aktarma, RevenueCat ve Resend webhook'ları olan
bir FastAPI API'si; ayrıca sertleştirme, taramalar, yedekler, maliyet korumaları ve yayın
dokümanları. Ardından bir test kararsızlığı düzeltmesi, galeri ve güzergâh tabelası düzenlemesiyle
görsel yeniden tasarım geldi (PR #129 ile #131, #133, #137, #138 ve #140). Barındırma, TLS, R2,
sağlayıcı hesapları ve iOS denenmedi. Bkz. [`inecekvar/README.tr.md`](inecekvar/README.tr.md).

**Patika.** Yedi fazın hepsi birleşti (PR #134, #135, #139 ve #141 ile #147): ASP.NET Core API
(Argon2id, ES256 token'lar, refresh aileleri ve TOTP; istasyonlar, beslemeler, hayvanlar,
sahiplendirme, bölgesel bildirimli acil gönderiler, medya hattı, hesap silme), SEO ve GEO
sayfalarıyla Razor Pages web ve TOTP yeniden doğrulamalı yönetim paneli, Worker, .NET MAUI Android
uygulaması, simüle Google Play Destekçi aboneliği ve 6. fazın sertleştirmesi (ZAP ve MobSF
taramaları, geri yükleme tatbikatlı yedekler, maliyet korumaları, yayın dokümanları) içeren bir
.NET 10 çözümü. Son tam test koşusu 1.456 geçen test kaydeder. Bkz.
[`patika/README.tr.md`](patika/README.tr.md).

### İlerleme

Son güncelleme: 2026-10-26.

| Proje       | İlerleme | Dayanak                                                                                                                                  |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `kadro`     | %100     | Faz 0 ile 2 tamam, faz 3 ile 5: 34 iş paketinin 34'ü birleşti, faz 6: 11 çıktının 11'i birleşti; (3 + 3 x 34/34 + 11/11) / 7 = %100 |
| `askida`    | %100     | 7 fazın 7'si birleşti, fazlar eşit ağırlıklı                                                                                             |
| `cetele`    | %100     | 7 fazın 7'si birleşti, fazlar eşit ağırlıklı                                                                                             |
| `inecekvar` | %100     | 7 fazın 7'si birleşti, fazlar eşit ağırlıklı                                                                                             |
| `patika`    | %100     | 7 fazın 7'si birleşti, fazlar eşit ağırlıklı                                                                                             |

İlerleme `main`'e birleştirilmiş işi ifade eder; yalnızca dalda duran ya da açık bir pull
request'teki iş sayılmaz. %100, planlanan işin birleştiği anlamına gelir, her kontrolün üretimde
kanıtlandığı anlamına gelmez: neyin doğrulanmadığının kaydı, her doğrulama matrisinin kısmi
satırları ve her proje README'sindeki "gerçek ve simüle" tablosudur.

## Depo yapısı

```
.github/workflows/   proje başına: CI, güvenlik iş akışı (Patika hariç; taramaları CI'ında) ve
                     geri yükleme tatbikatı; Kadro'da ayrıca elle tetiklenen bir Maestro iş akışı var
.github/dependabot.yml, renovate.json   bağımlılık güncelleme yapılandırması
.gitleaks.toml       sır taraması yapılandırması
lefthook.yml         git hook yapılandırması
docs/readme/         bu README'deki galeri kartları
kadro/               Kadro: pnpm workspaces + Turborepo (Expo uygulaması, Next.js web ve API, worker, paketler)
askida/              Askıda: Laravel sunucusu (Docker), Flutter uygulaması, marka paketi, ADR'ler, spec
cetele/              Cetele: Spring Boot sunucusu, Android uygulaması, marka paketi, ADR'ler, spec
inecekvar/           Inecek Var: Nx workspace (Ionic/Angular uygulama, Angular SSR web), FastAPI api, ADR'ler, spec
patika/              Patika: .NET çözümü (API, Web, Worker), MAUI Android uygulaması, ADR'ler, spec
```

## Projelere hızlı başlangıç

Her proje kendi klasöründen derlenir; tam kurulum kendi README'sinde.

| Proje                               | Gerekenler                      | Kontrol komutları, proje klasöründen                                                                                  |
| ----------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [Kadro](kadro/README.tr.md)         | Node 22, pnpm, Docker           | `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`                                              |
| [Askıda](askida/README.tr.md)       | Docker, Flutter SDK             | `docker compose up -d --wait`, `docker compose exec server php artisan test`; `app/` içinde: `flutter test`           |
| [Cetele](cetele/README.tr.md)       | JDK 21, Android SDK, Docker     | `android/` içinde: `./gradlew testDebugUnitTest :app:assembleDebug`; `server/` içinde: `./gradlew check`              |
| [Inecek Var](inecekvar/README.tr.md) | Node 22, pnpm, uv, Docker      | `pnpm install --frozen-lockfile`, `pnpm nx run-many -t lint test build`; `api/` içinde: `uv sync --locked`, `uv run pytest` |
| [Patika](patika/README.tr.md)       | .NET SDK 10.0.4xx, Docker       | `dotnet build Patika.slnx`, `dotnet test Patika.slnx`                                                                 |

Her projede veritabanı kullanan testler konteyner başlatır; bu yüzden çalışan bir Docker daemon
gerekir.

Depo Conventional Commits kullanır; mesajlar `lefthook.yml` içindeki hook'lar üzerinden commitlint
ile denetlenir. Hook'lar `pnpm --dir kadro exec lefthook install` ile elle kurulur.

## Projelerin dokümantasyonu

- Kadro: [`kadro/README.tr.md`](kadro/README.tr.md) ([English](kadro/README.md)); ADR'ler [`kadro/docs/adr/`](kadro/docs/adr/README.md) altında
- Askıda: [`askida/README.tr.md`](askida/README.tr.md) ([English](askida/README.md)); [`askida/CONTRIBUTING.md`](askida/CONTRIBUTING.md), ADR'ler [`askida/docs/adr/`](askida/docs/adr/) altında
- Cetele: [`cetele/README.tr.md`](cetele/README.tr.md) ([English](cetele/README.md)); ADR'ler [`cetele/docs/adr/`](cetele/docs/adr/README.md) altında
- Inecek Var: [`inecekvar/README.tr.md`](inecekvar/README.tr.md) ([English](inecekvar/README.md)); ADR'ler [`inecekvar/docs/adr/`](inecekvar/docs/adr/) altında
- Patika: [`patika/README.tr.md`](patika/README.tr.md) ([English](patika/README.md)); ADR'ler [`patika/docs/adr/`](patika/docs/adr/) altında

## Lisans

Bu proje MIT Lisansı ile lisanslanmıştır. Bkz. [LICENSE](LICENSE).
