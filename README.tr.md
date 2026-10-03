[English](README.md) | Türkçe

# Mobil-Package

Birbirinden bağımsız beş mobil ürünün monoreposu. Her ürün kendi klasöründe, kendi teknoloji
yığını, araçları ve yayın döngüsüyle yaşar; ürünler arasında paylaşılan kod yoktur.

## Projeler

| Klasör                    | Ürün                                                                                                                                                      | Teknoloji                                                                      | Durum                                                       | İlerleme |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------- |
| [`kadro`](kadro/)         | Halı saha maç organizasyonu: kadro kur, eksik oyuncuyu bul, saha ücretini böl                                                                             | Expo (React Native), Next.js, PostgreSQL + PostGIS, pg-boss                    | Geliştirme aşamasında (Phase 0-5 birleşti, Phase 6 sürüyor) | ~%95     |
| [`askida`](askida/)       | "Askıda ekmek" geleneğine dayalı dayanışma ağı: bağışçılar doğrulanmış yerel esnaftan ürünleri önceden öder, ihtiyaç sahipleri tek kullanımlık kodla alır | Flutter, Laravel, PostgreSQL + PostGIS, Redis, iyzico                          | Yalnızca tasarım dokümanı, kod yok                          | %0       |
| [`cetele`](cetele/)       | Küçük esnaf için çevrimdışı çalışan dijital veresiye defteri                                                                                              | Kotlin (Jetpack Compose), Spring Boot, PostgreSQL                              | Yalnızca tasarım dokümanı, kod yok                          | %0       |
| [`inecekvar`](inecekvar/) | Türkiye şehirleri için kitle kaynaklı dolmuş / minibüs hat haritası; A noktasından B noktasına planlama ve çevrimdışı şehir paketleri                     | Ionic (Angular + Capacitor), Angular SSR, FastAPI, PostgreSQL + PostGIS, Redis | Yalnızca tasarım dokümanı, kod yok                          | %0       |
| [`patika`](patika/)       | Sokak hayvanları için topluluk platformu: besleme noktası haritası, "beslendi" bildirimleri, sahiplendirme ilanları, veteriner rehberi                    | Swift (SwiftUI), ASP.NET Core, PostgreSQL + PostGIS                            | Yalnızca tasarım dokümanı, kod yok                          | %0       |

## Galeri

Her proje için bir kart. Yalnızca Kadro'nun uygulaması var; diğer kartlar henüz tasarım aşamasındaki ürünler için yer tutucudur.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/kadro.png" alt="Kadro: web ana sayfası ve mobil diziliş ekranı, örnek veri" width="100%"><br>
      <sub><b>Kadro</b>: geliştirme aşamasında</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/askida.png" alt="Askida kartı: tasarım aşamasında, henüz uygulama yok" width="100%"><br>
      <sub><b>Askida</b>: tasarım aşamasında, henüz uygulama yok</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/cetele.png" alt="Cetele kartı: tasarım aşamasında, henüz uygulama yok" width="100%"><br>
      <sub><b>Cetele</b>: tasarım aşamasında, henüz uygulama yok</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/inecekvar.png" alt="Inecek Var kartı: tasarım aşamasında, henüz uygulama yok" width="100%"><br>
      <sub><b>Inecek Var</b>: tasarım aşamasında, henüz uygulama yok</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/patika.png" alt="Patika kartı: tasarım aşamasında, henüz uygulama yok" width="100%"><br>
      <sub><b>Patika</b>: tasarım aşamasında, henüz uygulama yok</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Durum

Şu an yalnızca Kadro'nun kodu var. Depo iskeleti, Phase 1 (veri modeli, kimlik doğrulama ve
güvenlik çekirdeği) ve Phase 2 (domain API ve worker işleri) tamamlandı. Phase 3 ile 5 (mobil
uygulama, SEO sayfaları, abonelik ve yönetim paneli) için tüm iş paketleri birleştirildi. Phase 6
(sağlamlaştırma ve yayına hazırlık) sürüyor: saldırı paketi, geri yükleme tatbikatı ve runbook'lar,
maliyet bekçisi, mağaza metni ve gizlilik etiketi taslakları birleşti; nihai doğrulama matrisi, SEO
ve GEO kontrol listesi, bağımlılık denetim raporu ve mobil statik tarama açık. Birleşti, gerçek
dünyada doğrulandı demek değildir: mobil uçtan uca akışlar bir cihazda koşmadı, satın alma gerçek
mağaza hesaplarıyla denenmedi, yasal ve mağaza metinleri örnektir. Ayrıntı için
[`kadro/README.tr.md`](kadro/README.tr.md) dosyasına bakın.

Askida, Cetele, Inecek Var ve Patika için şimdilik yalnızca birer tasarım dokümanı var. Henüz
uygulama kodu yok.

### İlerleme

Son güncelleme: 2026-10-03 (Phase 6 dokümantasyonu ve maliyet bekçisi birleştirildikten sonra). Rakamlar tahmindir; bir iş grubu birleştirildikçe güncellenir.

| Proje       | İlerleme | Dayanak                                                                                                                                                     |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kadro`     | ~%95     | Phase 0 ile 2 tamam; Phase 3 ile 5: 34 iş paketinin 34'ü birleşti; Phase 6: 11 çıktıdan 7'si birleşti. Yedi faz eşit ağırlıklı: (3 + 3 x 34/34 + 7/11) / 7. |
| `askida`    | %0       | Yalnızca spesifikasyon; kod yok.                                                                                                                            |
| `cetele`    | %0       | Yalnızca spesifikasyon; kod yok.                                                                                                                            |
| `inecekvar` | %0       | Yalnızca spesifikasyon; kod yok.                                                                                                                            |
| `patika`    | %0       | Yalnızca spesifikasyon; kod yok.                                                                                                                            |

İlerleme `main`'e birleştirilmiş işi ifade eder; yalnızca dalda duran ya da açık bir pull request'teki
iş sayılmaz. Rakam ancak Phase 6 (sağlamlaştırma ve yayına hazırlık) tamamen bittikten sonra %100 olur.

## Depo yapısı

```
.github/workflows/   Kadro için CI (lint, typecheck, build; güvenlik taramaları)
.gitleaks.toml       sır taraması yapılandırması
lefthook.yml         git hook yapılandırması
kadro/               Kadro monorepo (pnpm workspaces + Turborepo)
askida/              tasarım dokümanı
cetele/              tasarım dokümanı
inecekvar/           tasarım dokümanı
patika/              tasarım dokümanı
```

## Projelerin dokümantasyonu

- Kadro: [`kadro/README.tr.md`](kadro/README.tr.md) ([English](kadro/README.md))
- Askida, Cetele, Inecek Var, Patika: henüz README yok; her klasördeki tasarım dokümanı tek
  kaynaktır.

## Geliştirme

Derlenebilen tek proje Kadro'dur. Komutları `kadro/` içinden çalıştırın:

```sh
cd kadro
pnpm install
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Veritabanı kullanan testler çalışan bir Docker daemon gerektirir. Gereksinimler, ortam kurulumu ve
diğer komutlar [`kadro/README.tr.md`](kadro/README.tr.md) dosyasında anlatılıyor.

Depo Conventional Commits kullanır; mesajlar `lefthook.yml` içindeki hook'lar üzerinden commitlint
ile denetlenir. Hook'lar `pnpm --dir kadro exec lefthook install` ile elle kurulur.

## Lisans

Kadro paketleri `package.json` dosyalarında `UNLICENSED` olarak işaretlidir. Depoda `LICENSE`
dosyası yoktur.
