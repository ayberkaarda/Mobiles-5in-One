# Kadro marka olguları

| Olgu | Değer | Kaynak |
|---|---|---|
| Ad | Kadro | `kadro/01-kadro-react-native-expo.md` §2 |
| Kategori | Halı saha maçlarını organize etmeye yardımcı olan mobil uygulama; JSON-LD kategori değeri SportsApplication | `kadro/01-kadro-react-native-expo.md` §2, §3 madde 12 ve §7 |
| Platformlar | iOS ve Android | `kadro/01-kadro-react-native-expo.md` §2 (bundle/application id), §4 |
| Diller | Türkçe (birincil) ve İngilizce (ikincil) | `kadro/01-kadro-react-native-expo.md` başlık bilgisi, §3 non-goals |
| Kadro Pro özellikleri | Sınırsız takım, kadro geçmişi, gelişmiş istatistikler | `kadro/01-kadro-react-native-expo.md` §3 madde 10 |
| Kuruluş yılı | belirlenmemiştir | `kadro/01-kadro-react-native-expo.md` §7 kuruluş yılının ADR'den alınmasını söyler; incelenen ADR-0031–0038 içinde yıl bilgisi yok |
| Ürün niteliği | Kadro bir portfolyo projesidir. | Görev kapsamında belirtilen olgu; ürün özeti ve ADR’lerde doğrulayıcı kaynak yok |

## Tutarlılık kuralları

- `/hakkinda`, `llms.txt`, `llms-full.txt`, `Organization` ve `MobileApplication` JSON-LD aynı marka adını, kategori açıklamasını, platformları ve dilleri kullanmalıdır.
- Marka adı `Kadro` olarak yazılır. `legalName`, `taxID`, adres, telefon veya e-posta uydurulmaz; şirket adı olarak başka bir ad eklenmez.
- Kuruluş yılı ancak ürün özeti veya ADR'de açıkça kaynaklandığında yayımlanır. Kaynakta yoksa yıl eklenmez; bu olgu burada `belirlenmemiştir` olarak kayıtlıdır.
- `MobileApplication` JSON-LD'de `operatingSystem` iOS ve Android, `applicationCategory` SportsApplication olarak tutulur. Kaynaksız ücret veya teklif ayrıntısı eklenmez.
- Kadro Pro'nun yalnızca üç kapsam özelliği kullanılır: sınırsız takım, kadro geçmişi ve gelişmiş istatistik. Ücretli katman olduğu söylenebilir; fiyat uydurulmaz ve fiyatlar uygulama mağazalarında belirlenir denir.
- `llms.txt` kısa ürün tanımı, hedef kullanıcılar, §3 özellikleri ve göreli sayfa yollarını; `llms-full.txt` aynı olguların açıklamasını taşır. Kapsam dışı özellik eklenmez.
- Her iki llms dosyası "Kadro bir portfolyo projesidir." cümlesini aynen içerir.
- Kullanıcı sayısı, ödül, basın alıntısı ve gerçek dünya istatistikleri kaynak olmadan eklenmez.

## JSON-LD ve /hakkinda için olgu rehberi

`Organization` için marka adı `Kadro` kullanılır; tüzel kişi, iletişim veya adres alanları kaynaksız doldurulmaz. `MobileApplication` için ad `Kadro`, kategori `SportsApplication`, işletim sistemleri iOS ve Android olmalıdır. Ürün açıklaması halı saha maçlarının organizasyonuna odaklanmalı; Kadro'nun rezervasyon veya ödeme işlemi yaptığı izlenimi vermemelidir. `/hakkinda` ve iki llms dosyasındaki iddialar bu tablodaki kaynaklarla uyumlu tutulur.
