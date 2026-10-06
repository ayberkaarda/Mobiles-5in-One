[English](README.md) | Türkçe

# Patika

Slogan: "Mahallenin patilerini birlikte koruyalım."

## Ürün özeti

Patika, mahalle gönüllülerini buluşturan bir sokak hayvanları topluluk platformu. Mama istasyonu haritası, "Beslendi" check-in'leri, hayvan profilleri, sahiplendirme ilanları, acil yardım gönderileri ve yakındaki veteriner ile bakımevi rehberi sunar. Ad "patika" yolundan geliyor ve içinde "pati" geçiyor. Dil sıcak ve "biz" diliyle yazılır, saygılıdır, suçluluk duygusu yaratmaz. Gönüllü gizliliği ürünün bir özelliğidir: fotoğraflardaki konum bilgisi cihazda silinir, gönüllü konumları hiç saklanmaz.

## MVP özellikleri

- Apple ile giriş ve e-posta/şifre; harita ve ilanlara giriş yapmadan göz atma.
- Mama istasyonlarının kümelenmiş haritası ve filtreler (kedi/köpek, mama/su, "mama bitti"); fotoğraf, son check-in'ler ve "Beslendi" düğmesiyle istasyon detayı.
- İğne bırakarak ya da mevcut konumla istasyon ekleme ve düzenleme.
- Tür, sağlık işaretleri (kısırlaştırılmış, aşılı, küpeli), durum, fotoğraf, takip ve "Bugün gördüm" kaydı olan hayvan profilleri.
- Moderasyon kuyruklu sahiplendirme ilanları, istek formu, yanıtlar; 60 gün sonra ya da sahiplendirilince otomatik kapanma.
- Acil Yardım: yaralı veya hasta hayvan gönderileri; 2 km içindeki, izin vermiş gönüllülere konum bazlı bildirim (gönderi ve kullanıcı başına üst limitlerle); 24 saat işaretli veteriner ve bakımevi rehberi.
- Besleme sayısı ve rozetleri olan gönüllü profili; utandıran liderlik tabloları yok.
- Yakındaki acil gönderiler, sahiplendirme yanıtları ve takip edilen hayvan güncellemeleri için push bildirimleri.
- Son bakılan bölgenin çevrimdışı önbelleği ve check-in'ler için giden kutusu.
- Patika Destekçi aboneliği: destekçi rozeti, satış amaçlı banner yok, daha geniş fotoğraf kotası.
- Uygulama içinden ve web'den hesap silme.
- Web: tanıtım, herkese açık sahiplendirme ilanları, istasyon ve ilçe sayfaları, bakım yeri rehberi, rehber yazıları, yasal sayfalar, gerçek rakamlı etki sayfası ve moderasyon/admin alanı.

## Kapsam dışı

- Kişilere bağış ya da Destekçi aboneliği dışında herhangi bir para akışı
- Canlı sohbet
- Android (v2'de düşünülüyor)
- Veteriner randevusu
- Gerçek zamanlı hayvan takip cihazları
- Liderlik tabloları
- Reklam

## Planlanan teknoloji yığını

| Katman           | Teknoloji                                            |
| ---------------- | ---------------------------------------------------- |
| Mobil uygulama   | .NET MAUI (C#), önce Android; iOS burada derlenmiyor |
| Backend API      | ASP.NET Core Minimal API (C#), EF Core               |
| Web ve admin     | ASP.NET Core Razor Pages, sunucu tarafı render       |
| Arka plan işleri | .NET Worker + Quartz.NET                             |
| Veritabanı       | PostgreSQL + PostGIS                                 |
| Nesne depolama   | S3 uyumlu (Cloudflare R2)                            |
| Push bildirimi   | APNs (token tabanlı)                                 |
| E-posta          | Resend                                               |

## Planlanan mimari

Bir repoda bir .NET MAUI uygulama projesi (C#, önce Android; iOS burada derlenmez ve denenmez) ve `src/` altında Domain, Infrastructure, Api, Web, Worker ve Contracts projelerine ayrılmış bir .NET çözümü; testler `tests/` altında. API, `/v1` altında sürümlü JSON uç noktalarıyla vertical slice düzeninde kurulur; Razor web uygulaması herkese açık SEO sayfalarını ve admin alanını render eder; worker push dağıtımı, silme işlemleri, abonelik mutabakatı ve yedek kontrollerini yürütür. Abonelik hakkı, sunucuda doğrulanmış mağaza işlemleri ve bildirimlerinden belirlenir.

## Durum

Bu klasörde şu an yalnızca tasarım/spec dokümanı var; kaynak kod henüz yazılmadı.

## Kurulum

Henüz kod yok, bu yüzden kurulacak ya da çalıştırılacak bir şey de yok. Ürün ve teknik tanım bu klasörde `03-patika-swift-ios.md` dosyasında duruyor. Geliştirme başlayınca bu README güncellenecek.
