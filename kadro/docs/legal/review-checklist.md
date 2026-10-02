# Kadro — Hukuki sayfalar inceleme kontrol listesi

## Amaç ve durum

Durum: **partial**. İki sayfa portfolyo için teknik veri işleme örneğidir. Gerçek veri sorumlusu, başvuru kanalı ve nihai işleme şartları belirlenmediğinden aydınlatma yükümlülüğünün tamamlandığı veya OAuth/mağaza için hazır gizlilik politikası olduğu sonucuna varılmaz. Dayanak: `legal-drafts/scope-joint-r2.md` B1–B11, B ve (c).

Kaynak taslaklar atılmadan birleştirildi: `legal-drafts/kvkk-aydinlatma.tr-yurtici.md`, `legal-drafts/kvkk-aydinlatma.tr-yurtdisi.md`, `legal-drafts/gizlilik.tr-yurtici.md`, `legal-drafts/gizlilik.tr-yurtdisi.md` ve `legal-drafts/ACIK-ALANLAR.md`. Yalnız üç teslim dosyası düzenlenir; kaynak beş taslak salt okunur korunur. Bu kontrol listesi ortak kararın teknik doküman dili istisnasıyla Türkçedir.

Kanıt sınırı: kod/ADR okuması ve statik metin/biçim kontrolü; node, pnpm, Docker, built-page, mobil ve üretim koşusu yapılmadı. Sayfa tarihleri 2026-10-02 örnek yayın/değişiklik tarihidir. Her açık maddenin kapanışı için inceleyen, tarih ve kanıt eklenmelidir; kaynakta süre bulunması üretimde işletildiğini kanıtlamaz.

## Gerçek yayına dönüş yolu

Gerçek kişisel veri alan bir yayında örnek etiketi yeterli sayılmaz.

- [ ] Gerçek veri sorumlusu kimliği, adresi, başvuru kanalı ve varsa zorunlu sicil/iletişim bilgileri doğrulansın.
- [ ] Kategori, amaç, toplama, hukuki sebep, alıcı, aktarım ve saklama kapsamı hukuki incelemeyle kesinleştirilsin; gerçek metin ve gerektiğinde ayrı rıza akışları hazırlansın.
- [ ] Doğrulanmış alan adında barındırılsın; ana sayfa ve gizlilik URL'leri uygulama, OAuth konsolu ve mağaza kayıtlarında tutarlı olsun.
- [ ] Google OAuth doğrulaması, gerçek veri sorumlusu ve çalışan kamu URL'leriyle tamamlanıp kanıtı kaydedilsin.
- [ ] Apple privacy labels gerçek veri envanteri, SDK ve bu sayfalarla eşlensin; mağaza konsoluna giriş ayrıca kanıtlansın.
- [ ] /hesap-silme erişilebilirliği ve aydınlatma bağlantısı web sahibi tarafından doğrulansın; ADR-0040 gereği app yüzeyinin noindex niteliği korunsun.
- [ ] Planlanan entegrasyonlar uygulandığında katmanları yalnız doğrulanmış kod ve etkin ayarlar üzerinden güncellensin; mağaza aboneliği cümlesi Faz 5 sonrası gerçek akışla eşlensin.
- [ ] Release-readiness belgesine bu kapılar ve açık kanıt sınırları aktarılsın; örnek etiketi kaldırmak tek başına geçiş ölçütü sayılmasın.

Kaynak: `legal-drafts/scope-joint-r2.md` B7–B9, B §1 ve §7; `kadro/docs/adr/0040-email-link-pages-phase2-scope.md`. Bu teslim rota, metadata, konsol veya release-readiness dosyasını değiştirmez.

## Hukuki sebep eşleştirme taslağı

**İnceleme taslağı, kesinleşmemiş.** Aşağıdaki ilk taslak m.5 tablosu inceleme için korunmuştur; yayın sayfalarına taşınmaz. Satırlar hukuki karar veya bütün özelliklerin uygulanmış olduğu beyanı değildir. Özellikle abonelik Faz 5, Sentry ve istemci/konum kapsamı ayrı kanıt ister.

| Kategori ve kapsam | Kullanım amacı | Önerilen hukuki sebep / inceleme noktası |
| --- | --- | --- |
| Hesap ve iletişim: e-posta, görünen ad, kullanıcı kimliği, e-posta doğrulama durumu, Apple/Google sağlayıcı hesap kimlikleri | Üyelik, giriş, hesap iletişimi ve doğrulama | Hizmet sözleşmesiyle doğrudan ilgili gerekli işlemler için m.5/2-c |
| Kimlik doğrulama ve oturum: parola özeti, token özetleri, web/mobil oturum ve cihaz etiketi, geçerlilik/iptal bilgileri; yetkili personelde şifreli TOTP kaydı | Güvenli giriş, oturum yönetimi, yetkili yönetim erişimi | m.5/2-c; hizmet güvenliği için gerekli ölçüde m.5/2-f ve menfaat dengesi |
| Profil ve görsel: avatar, takım arması, yükleyen kimliği, görsel türü/boyutu/durumu; beyan edilen pozisyon ve oyuncu seviyesi | Profil sunma, kadro oluşturma, uygun oyuncu bulma ve görsel güvenliği | İlgili özelliğin ifası için gerekli kapsamda m.5/2-c; isteğe bağlı yayımlama ve kapsamı aşan kullanım için ayrı inceleme açık: İŞLEME DAYANAĞI: profil/görsel yayımlama ve ayrı rıza gereği |
| Konum: seçilen il/ilçe, takım/maç ilçesi, saha noktası ve maç yeri; ön planda cihaz konumu kullanımı | Eksik Var ve saha haritası, bölgesel arama | Seçilen bölgeyle hizmet ifası için m.5/2-c; hassas cihaz konumunun akışı ve dayanağı ayrı inceleme açık: KONUM SÜRECİ: cihazda/sunucuda işleme, alıcılar, süre ve rıza gereği |
| Takım ve davranış: üyelik/rol/katılma zamanı, davet kullanımı, maç katılım cevabı, bekleme listesi, diziliş, başvuru mesajı/sonucu, MVP oyları ve bunlardan türetilen maç/MVP istatistikleri | Takım ve maç organizasyonu, katılımcı bulma, sonuç ve geçmişin gösterilmesi | Gerekli hizmet işlevleri için m.5/2-c; hesap sonrası geçmişin dayanağı ayrıca doğrulanır. Kaynaklarda ayrı bir reklam davranış takibi tanımlanmamıştır |
| Kullanıcı içeriği: saha puanı ve yorum metni; saha ekleyen kimliği, saha adres/telefonu ve serbest maç yeri metni | Saha rehberi, değerlendirmeler ve maç yerini belirtme | Hizmetin gerekli işlemleri için m.5/2-c; alenileştirmeye dayanılacaksa m.5/2-d kapsamında kişinin iradesi ve amaç sınırı ayrıca doğrulanır |
| Ücret işaretleme: saha toplam ücreti, hesaplanan kişi payı, paid işareti ve değişiklik kaydı | Kaptanın saha ücretini takip etmesi | m.5/2-c; uyuşmazlıkta gerekli kayıt için m.5/2-e. Oyuncular arası para transferi, kart veya banka hesabı bilgisi işlenmez; yalnızca organizasyon ve ödeme durumu işaretlenir |
| Abonelik: RevenueCat kullanıcı kimliği, ürün, durum, bitiş zamanı, ortam, webhook olay kimliği/özeti | Kadro Pro erişimi ve abonelik durumunun doğrulanması | m.5/2-c; Kadro Pro mağaza aboneliği, oyuncular arası ücret işaretlemesinden ayrı bir süreçtir |
| Bildirim: push tokenı, platform, son görülme tarihi, bildirim nesne kimliği ve teslimat bilgileri | Maç hatırlatma, katılım ve başvuru bildirimleri | İstenen hizmet bildiriminin gerekli kapsamı için m.5/2-c; ayrı inceleme açık: BİLDİRİM DAYANAĞI: push tercihi ve ayrı rıza değerlendirmesi |
| İşlem güvenliği: bağlantı IP'si, anahtarlı IP/e-posta özetleri, istek kimliği, işlem zamanı, hız sınırlama sayaçları, denetim eylemi/hedefi/metadata, hata ve iş kuyruğu kayıtları | Kötüye kullanım önleme, erişim denetimi, hata çözümü ve işlem tutarlılığı | Hak ve özgürlükleri zedelemeyen gerekli güvenlik işlemleri için m.5/2-f; somut bir hakkın korunması için m.5/2-e. Özetlenmiş veri kendiliğinden anonim sayılmaz |
| Silme ve başvuru: talep zamanı, bekleme/sonuç bilgisi, dış temizlik durumu; KVKK başvurusunda verilen kimlik, iletişim ve talep bilgileri | Silme işlemi, hak taleplerinin karşılanması ve ispatı | İlgili hukuki yükümlülük için m.5/2-ç; somut hakkın korunması için m.5/2-e |

Eşleştirmelerde sözleşmeyle doğrudan ilişki ve zorunluluk, amaç sınırı, ölçülülük ve meşru menfaat denge testi ayrı kaydedilmelidir. Hukuki yükümlülük için somut hüküm belirlenmelidir; kanuni saklama varsayılmamalıdır. Profil/görsel, hassas konum ve push için ayrıca rıza gereği ve geri alma etkisi incelenmelidir; cihaz izni veya metni kabul etmek genel rıza değildir. Özel nitelikli veri için güncel m.6 şartları ve ek tedbirler ayrıca değerlendirilir. Kaynak: ilk KVKK taslaklarının kategori tablosu; [Kurumun işleme şartları açıklaması](https://www.kvkk.gov.tr/Icerik/2050/Kisisel-Veriler).

## Barındırma senaryoları

| Senaryo | Önceki varyantın farkı | Yayın öncesi inceleme |
| --- | --- | --- |
| Türkiye ana barındırma | Ana sunucu/veritabanı ülke içinde varsayılıyordu. Bütün veri zincirinin ülke içinde olduğu sonucu çıkarılamaz. | VPS sağlayıcısı, konumu, üretim/önizleme ayrımı, yabancı destek erişimi, yedek ve devam aktarımları belirlensin. |
| AB ana barındırma | Ana sunucu/veritabanındaki hesap, oturum, takım, maç, içerik ve güvenlik kayıtları da yurt dışı aktarım incelemesine girer. | Ülke/bölge, sağlayıcı, erişim ve alt sağlayıcılar belirlensin; m.9 yolu ayrıca tamamlansın. AB konumu tek başına yeterlilik kararı değildir. |

ADR-0002 bölgeyi aday bırakır; üretim ortamı yok. Mimari kabulü bölge seçiminin tamamlandığı anlamına gelmez. ADR-0002'nin 72–74. satırları yalnız R2, Resend, Sentry ve RevenueCat'i Türkiye dışı olarak niteler; Expo/Apple/Google veya HIBP için bu kaynaktan ülke/bölge çıkarılamaz. Yayın sayfalarında alıcı bazında bölge beyanı verilmedi.

Her düzenli ve devam aktarımı için ilgili işleme şartı ile uygulanabilir yeterlilik kararı; yoksa etkili haklar/kanun yolları ve uygun güvence değerlendirilmelidir. Standart sözleşmenin modülü, ekleri, tarafları ve bildirim işlemi; taahhütname yolunda izin ayrıca doğrulanmalıdır. Açık rızalı arızi istisna sürekli barındırmayı genel olarak karşılamaz. Kaynak: `kadro/docs/adr/0002-hosting.md`; iki KVKK/gizlilik varyantının barındırma bölümleri; [Kurumun yurt dışına aktarım açıklaması](https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim). Standart sözleşmenin imzaları tamamlandıktan sonra 5 iş günü içinde bildirimi ayrıca izlenmelidir: [Kurumun standart sözleşme duyurusu](https://www.kvkk.gov.tr/Icerik/8170/Yurt-Disina-Kisisel-Veri-Aktariminda-Kullanilacak-Standart-Sozlesmelerde-Dikkat-Edilmesi-Gereken-Hususlara-Iliskin-Kamuoyu-Duyurusu).

## Etkin ortam/hosting/alt sağlayıcı envanteri

**AÇIK:** kodda adaptör bulunması gerçek yayında o sağlayıcının etkin olduğu kanıtı değildir. Ortam ayarları, gerçek bağlantılar ve sözleşmeler henüz doğrulanmadı.

- [ ] local / preview / production için etkin servisler, endpoint ve veri kapsamı ayrı kaydedilsin; gizli anahtar/değer yayımlanmasın.
- [ ] VPS ve veritabanı, R2/MinIO, Resend/log, Expo/log, Apple/Google JWKS, HIBP ve planlanan RevenueCat/Sentry tek envanterde izlensin.
- [ ] Her hizmet için sözleşme tarafı, hukuki rol, alt sağlayıcı, depolama, yedek, erişim/destek, devam aktarımı, ek IP/telemetri ve sağlayıcı saklama/silme bilgileri kanıtlansın.
- [ ] R2 görsel yükleme/presign kodu, Faz 6 yedek yükleme uygulamasının kanıtı sayılmasın. Ham görsel metadata ve doğrudan depo isteği bağlantı verisi ayrı değerlendirilsin.
- [ ] RevenueCat dış silme çağrısı varsayılmasın: mevcut işçi yalnız abonelik varsa external_pending kaydeder. Sentry için mevcut entegrasyon dosyası bulunmadı.
- [ ] Apple/Google sunucu doğrulaması yalnız JWKS GET'tir; cihazın doğrudan giriş akışı, istemci kodu ve gerçek sağlayıcı koşuları ayrıca doğrulansın.
- [ ] HIBP ilk beş SHA-1 karakteri, bağlantı metadatası, alıcı rolü/bölgesi ve uygun aktarım yolu incelensin.

Kaynak: `kadro/apps/web/lib/server/uploads/storage.ts`; `kadro/apps/worker/src/storage/storage.ts`; `kadro/packages/emails/src/transport.ts`; `kadro/apps/worker/src/push/transport.ts`; `kadro/apps/web/lib/server/oauth/providers.ts`; `kadro/apps/web/lib/server/oauth/jwks.ts`; `kadro/packages/auth/src/hibp.ts`; `kadro/apps/worker/src/accounts/hard-delete.ts`.

## Çerez ve üçüncü taraf istek envanteri

**WP4-8 testi bekleniyor.** ADR-0040'ın e-posta bağlantı sayfalarına ait kanıtı bütün siteye genellenmez.

- [ ] Tüm built-page rotaları, girişli/girişsiz durumlar, token bağlantıları, başarı/hata durumları ve mobil web yüzeyleri taransın.
- [ ] Çerez adı, sağlayıcı, amaç, tür, ömür, özellikler ve hukuki sebep; Set-Cookie ve istemci depolaması kaydedilsin.
- [ ] Varsayılan `__Host-kadro_session` ve `__Host-kadro_csrf` ile 604800 saniyelik web ttl gerçek ortamda karşılaştırılsın; web oturum yenilemesi ile satır temizliği ayrıştırılsın.
- [ ] Sentry kapalıyken beklenmeyen üçüncü taraf istekler testi düşürsün. Sentry açıkken beklenen istekler endpoint/amaç bazında beyaz listeli olmalı; genel üçüncü taraf serbestliği verilmemeli.
- [ ] Sunucudan yapılan Resend/Expo/HIBP/JWKS çağrıları browser sayfa taramasından ayrı ölçülsün.
- [ ] Site geneli çerez yokluğu ancak kapsamı belli başarılı test sonucu üzerine yazılsın.

Kaynak: `legal-drafts/scope-joint-r2.md` B6 ve (c) WP4-8/WP5-9; `kadro/docs/adr/0040-email-link-pages-phase2-scope.md`; `kadro/apps/web/lib/server/cookies.ts`; `kadro/apps/web/lib/server/auth/sessions.ts`; `kadro/packages/config/src/schema.ts`.

## ACIK-ALANLAR.md — 36 inceleme maddesinin güncel hali

Kaynak numaraları korunmuştur. Tüm maddeler açıktır; teknik alt konunun kodda doğrulanması hukuki/üretim incelemesini kapatmaz. Eski köşeli yer tutucu başlıkları inceleme konusuna dönüştürülmüştür.

### 1. Açık — VERİ SORUMLUSU BİLGİSİ: tebligat ve başvuru adresi

Gerçek veri sorumlusunun kişi veya tüzel kişi kimliği, tebligat ve başvuru adresi belirlenmelidir. Kaynaktaki marka adı hukuki kimlik kanıtı değildir; yayın örneğinde kimlik belirlenmemiştir.

### 2. Açık — VERİ SORUMLUSU BİLGİSİ: MERSİS numarası veya uygulanmama durumu

MERSİS numarası kaynakta yoktur; mevcut olup olmadığı ve açıklanma şekli doğrulanmalıdır.

### 3. Açık — VERİ SORUMLUSU BİLGİSİ: vergi kimlik numarası

VKN kaynakta yoktur; sayı tahmin edilmeyecektir.

### 4. Açık — VERİ SORUMLUSU BİLGİSİ: iletişim ve KVKK başvuru e-posta adresi

İletişim ve KVKK başvurularını alan gerçek adres belirlenmeli, erişim ve başvuru takibi kurulmalıdır; kadro.app alan adından e-posta türetilmemelidir.

### 5. Açık — YÜRÜRLÜK TARİHİ: gün/ay/yıl

Örnek sayfaların publishedAt ve modifiedAt tarihleri 2026-10-02'dir. Gerçek yayının yürürlük günü ayrıca belirlenmeli; örnek hazırlama tarihi hukuki yürürlük kanıtı olarak kullanılmamalıdır.

### 6. Açık — İŞLEME DAYANAĞI: profil/görsel yayımlama ve ayrı rıza gereği

İsteğe bağlı avatar, arma ve profil bilgilerinin hizmet için gerekliliği, herkese açık medya sunumu ve m.5/1 açık rıza gereği hukuki incelemede doğrulanmalı. Fotoğraf seçmek veya yüklemek tek başına genel rıza sayılmamalı.

### 7. Açık — KONUM SÜRECİ: cihazda/sunucuda işleme, alıcılar, süre ve rıza gereği

Hassas cihaz konumunun cihazda kalıp kalmadığı, API/harita hizmetine gönderimi, harita sağlayıcısı, bölgesi, süre ve veri minimizasyonu doğrulanmalı. Şemada kullanıcı GPS alanı yoktur; bu durum hiçbir aktarım olmadığı anlamına gelmez. Cihaz izninin yanında ayrı rıza gereği hukuki incelemede doğrulanmalı.

### 8. Açık — BİLDİRİM DAYANAĞI: push tercihi ve ayrı rıza değerlendirmesi

Hizmet push bildirimlerinin dayanağı, devre dışı bırakma sonrası token temizliği ve tercih kaydı hukuki incelemede doğrulanmalı. İşletim sistemi izni KVKK rızasının yerine geçirilmemeli; ADR-0031'de pazarlama veya yakındaki oyunculara toplu çağrı push'u yoktur.

### 9. Açık — HUKUKİ SEBEP İNCELEMESİ: kategori bazlı nihai dayanaklar

Tablodaki m.5/2-c, ç, d, e, f eşleştirmelerinin her veri ve amaç için zorunluluk/ölçülülüğü hukuki incelemede doğrulanmalı; meşru menfaat için denge testi kaydedilmeli. Kanuni saklama iddiası somut hüküm olmadan eklenmemeli. Rıza ihtiyacı ve geri alma etkisi ayrı belirlenmeli.

### 10. Açık — ÖZEL NİTELİKLİ VERİ SÜRECİ: içerik kaldırma, hukuki şart ve ek tedbirler

m.6 kapsamındaki güncel şartlar ve Kurulun ek tedbirleri hukuki incelemede doğrulanmalı. Fotoğraf, yorum, başvuru veya serbest saha alanından özel nitelikli veri gelirse karantina/kaldırma/inceleme süreci belirlenmeli; sıradan sözleşme veya meşru menfaat sebebi yeterli kabul edilmemeli.

### 11. Açık — AKTARIM BİLGİSİ: R2 ülkeleri ve bölgeleri

R2 görsel, gelen dosya, medya dağıtımı, yedek, destek erişimi ve devam aktarım ülkeleri kaynakta yoktur. ADR-0002 Türkiye dışı sağlayıcı olarak niteler. Şifreleme m.9 incelemesini kendiliğinden kaldırmaz; ham görselde EXIF/GPS bulunabilir.

### 12. Açık — AKTARIM BİLGİSİ: Resend ülkeleri ve bölgeleri

Resend sözleşme tarafı, e-posta içeriği/bağlantı, teslimat kayıtları, destek ve alt sağlayıcı bölgeleri doğrulanmalı; sağlayıcı saklama ve silme koşulları alınmalı.

### 13. Açık — AKTARIM BİLGİSİ: Sentry ülkeleri ve bölgeleri

Sentry spec'te ve ortak karar planında vardır; bu kaynak durumunda entegrasyon kodu bulunmamıştır. Entegrasyon sonrası proje/depolama/erişim ülkeleri, IP, kullanıcı kimliği, breadcrumb ve istek verileri ölçülmeli; beforeSend redaksiyon testleri ve gerçek olay örneği incelenmelidir. Host loglarının 30 günlük süresi Sentry'ye taşınmamalıdır.

### 14. Açık — AKTARIM BİLGİSİ: RevenueCat ülkeleri ve bölgeleri

RevenueCat veri modeli ve silme kaydı vardır; dış entegrasyon Faz 5'tir. Bölge, sözleşme tarafı, mağaza işlem/abonelik verisi ve SDK teknik veri kapsamı doğrulanmalıdır. Kart/banka verisi işlendiği iddia edilmemeli; abonelik meta verisi ile saha ücret işaretleme ayrılmalıdır. Mağaza aboneliği ayrıca iptal edilir cümlesi yalnız planlanmış katmanda tutulmuştur.

### 15. Açık — AKTARIM BİLGİSİ: Expo ve push alt sağlayıcılarının ülkeleri ve bölgeleri

Expo'nun saklama/işleme ülkeleri ve APNs/FCM gibi fiili push alt sağlayıcı zinciri, roller ve devam aktarım koşulları doğrulanmalı; bölge uydurulmamalı.

### 16. Açık — AKTARIM BİLGİSİ: Apple/Google giriş hizmetlerinin ülkeleri, bölgeleri ve rolleri

Apple/Google sunucu kodu yalnız JWKS indirir ve cihazın gönderdiği belirteci yerelde doğrular; kullanıcı verisi bu doğrulama akışında sunucudan sağlayıcıya gönderilmez. Ortak karar giriş sırasında cihazın sağlayıcıyla doğrudan konuştuğu akışı tarif eder; istemci uygulaması ve gerçek giriş doğrulanmalıdır. Sağlayıcı rolleri, ülkeleri, IP/telemetri ve saklama koşulları ayrıca envantere alınmalı; JWKS akışından bütün ek veri alıcıları çıkarılmamalıdır.

### 17. Açık — ALICI ENVANTERİ: sözleşme tarafları, roller, ek veriler ve alt sağlayıcılar

Tüm sağlayıcıların tüzel sözleşme tarafları, roller, alt sağlayıcılar, erişim/telemetri/IP verileri, gizlilik hükümleri ve silme taahhütleri tamamlanmalı. ADR'deki 'processor' sözcüğü fiili hukuki rolü tek başına kesinleştirmez.

### 18. Açık — BARINDIRMA BİLGİSİ: Türkiye VPS sağlayıcısı, bölgesi ve erişim yerleri

Türkiye varyantı için VPS sağlayıcısı/ili ve bölgesi, üretim/önizleme ayrımı, yabancı destek erişimi ve yedek güzergâhı belirlenmeli. ADR-0002'nin mimari seçimi kabul edilmiştir; veri lokasyonu hâlâ açıktır.

### 19. Açık — AKTARIM DAYANAĞI: her alıcı ve aktarım için seçilen m.9 yolu ve tamamlanan işlemler

Durum partial: aktarım alıcıları için teknik izler vardır; m.9 hukuki yol, sözleşme ve üretim kanıtları eksiktir. Her alıcı/aktarım için ilgili m.5/m.6 şartı, uygulanabilir yeterlilik kararı ve yoksa etkili haklar/kanun yolları ile uygun güvence incelenmelidir. Standart sözleşmenin doğru modülü, ekleri, taraf yetkileri ve imzaların tamamlanmasından itibaren 5 iş günü içinde Kuruma bildirimi; taahhütname yolunda Kurul izni doğrulanmalıdır. Açık rızalı arızi istisna, koşullarıyla sınırlıdır; düzenli barındırma ve devam aktarımları için genel izin sayılmaz. AB konumu veya yabancı hukuk uyumu Kurul yeterlilik kararı değildir. HIBP dahil tüm dış akışlar incelenmelidir.

### 20. Açık — SAKLAMA PLANI: hesap, içerik, oturum, denetim, başvuru ve sağlayıcı kayıtları

Hesap/profil, yorum/başvuru, davet, oturum/token satırları, abonelik/webhook, silme talebi ve append-only audit_logs için kategori bazlı azami süre, tetikleyici ve imha yöntemi tamamlanmalı. Ham IP/reverse proxy kayıtları ve dış sağlayıcı logları ayrıca envantere alınmalı. İş kuyruğu ve ilişkilendirilebilir kimlikler 'kişisel veri değil' kabul edilmemeli.

### 21. Açık — SİLME SÜRESİ: bakım taraması ve dış sağlayıcı tamamlanma sınırı

ADR-0032, 7 gün ve bakım taramasıyla silme öngörür; ADR-0028 taramanın saatlik olduğunu ve bir saatten fazla gecikmiş talebi yeniden kuyruğa aldığını belirtir. Bu yeniden kuyruğa alma kuralı silmenin her durumda bir saat içinde tamamlandığı garantisi değildir. R2/RevenueCat kesintilerinde tamamlanma, bildirim ve eskalasyon üst sınırları belirlenmeli.

### 22. Açık — GEÇMİŞ İNCELEMESİ: anonimlik, yeniden ilişkilendirme ve saklama sınırı

ADR-0033 her silinen hesaba özgü yeni 'Silinmiş oyuncu' kaydını süresiz tutar; maç/oy/ücret işaretleri aynı geçmişte kalabilir. Takım arkadaşlarının bilgisi, eski ekran görüntüleri ve audit kimlikleriyle yeniden ilişkilendirme riski hukuki incelemede doğrulanmalı. Gerçek anonimlik yoksa kişisel veri saklama dayanağı/süresi ve ek önlemler belirlenmeli; süresiz saklamanın kabul edilebilirliği kesin yazılmamalı. ADR-0005/0032 takımın silinmesi halinde geçmişin de kalkabildiğini belirtir.

### 23. Açık — YEDEK SİLME PLANI: geri yükleme ve yeniden silme süreci

ADR-0032 ve threat-model RR-2 silinmiş verinin yedekte 30 güne kadar kalmasını belirtir. Yaşam döngüsünün fiilen çalışması, erişim sınırları ve geri yüklemede silme listesinin yeniden uygulanması doğrulanmalı; silme listesi de yeni kişisel veri kaydı yaratabilir.

### 24. Açık — MEDYA ÖNBELLEĞİ: kaldırma ve önbellek süresi

ADR-0030 yayımlanmış medya için public, immutable ve max-age=31536000 öngörür. Bu teknik önbellek ayarı her kopyanın tam bu sürede silindiği anlamına gelmez. Kaynak silme, CDN purge, istemci önbelleği ve bilinen kopyaların kaldırılması süreci doğrulanmalı.

### 25. Açık — ÇEREZ ENVANTERİ: CSRF adı/süresi ve diğer web çerezleri

Kodda varsayılan adlar `__Host-kadro_session` ve `__Host-kadro_csrf` olarak doğrulanmıştır. Oturum varsayılanı 604800 saniye (7 günlük yenilenen), CSRF çerezi aynı ttl ile üretilir; gerçek ortamda ad ve süre değişebilir. Oturum HttpOnly, her ikisi Secure, Path=/ ve SameSite=Lax'tır. Tüm yüzeylerde fiili Set-Cookie, kullanım, süre, sağlayıcı ve dayanak envanteri yapılmalıdır. Kaynak: `kadro/apps/web/lib/server/cookies.ts`; `kadro/apps/web/lib/server/auth/sessions.ts`; `kadro/packages/config/src/schema.ts`.

### 26. Açık — ÇEREZ DOĞRULAMASI: tüm web yüzeylerinde analitik, reklam ve üçüncü taraf çerezlerinin durumu

ADR-0040 yalnız e-posta bağlantı yüzeylerini kapsar; tüm site için analitik/reklam çerezi yokluğu sonucu çıkarılmaz. WP4-8 built-page testi beklenmektedir. Bütün sayfalar, giriş/çıkış ve hata durumları taranmalı; Sentry etkinse beklenen istekler açık beyaz listeyle sınırlandırılmalıdır. Çerez varsa kapsam ve gereken tercih/rıza süreci güncellenmelidir.

### 27. Açık — YAŞ POLİTİKASI: asgari yaş, çocukların erişimi ve gerektiğinde veli süreci

Spec §2'deki 18–40 hedef kitledir, üyelik alt/üst sınırı değildir. Asgari yaş, yaş doğrulama/minimizasyon, çocuk verisinin tespiti, gerektiğinde veli süreci ve kaldırma işlemleri hukuki incelemede doğrulanmalı; doğum tarihi alanı uydurulmamalı.

### 28. Açık — GÜVENLİK DOĞRULAMASI: yayındaki teknik ve idari tedbirler

Üretim ortamı yok; spec ve threat-model tedbirlerinin tamamı yayında uygulanmış kabul edilmemelidir. Üretim log rotasyonu, yedekleme/geri yükleme, erişim rolleri, Sentry temizliği, sağlayıcı sözleşmeleri, personel erişimi ve olay yönetimi fiilen doğrulanmalıdır. Güvenlik denetimini tamamlanmış/yeşil diye raporlamayın; ortak karar B10'daki 3 moderate bulgu ve ADR-0043 izinin güncel durumu ayrıca doğrulanacaktır.

### 29. Açık — BAŞVURU USULÜ: Tebliğdeki zorunlu bilgiler, kimlik doğrulama, varsa KEP ve diğer kanallar

Başvuru Tebliği'ndeki zorunlu bilgiler ve yöntemler, kayıtlı e-postadan başvuru, yazılı imza/kimlik unsurları, yabancılar için bilgiler, gerekiyorsa KEP, ücret ve cevap usulü hukuki incelemede doğrulanmalı. Normal hesap kullanımında alınmayan başvuru bilgileri sadece başvuru kapsamında ölçülü işlenmeli; hesap silme diğer hakların tek kanalı olmamalı.

### 30. Açık — DEĞİŞİKLİK BİLDİRİMİ: uygulama içi ve/veya e-posta kanalı ile sürüm kaydı

Esaslı değişiklik bildirimi için uygulanabilir kanal, sürüm/tarih kaydı ve gereken yeni rıza süreci belirlenmeli; bildirim push'u mevcut kapalı ADR-0031 listesinde varsayılmamalı.

### 31. Açık — BARINDIRMA BİLGİSİ: Avrupa VPS sağlayıcısı, ülkesi, bölgesi ve erişim yerleri

Avrupa varyantı için VPS ülke/bölgesi, üretim/önizleme ve destek erişimi belirlenmeli. 'Avrupa' tek başına ülke envanteri değildir; seçimin m.9 koşulları tamamlanmadan yayına hazır kabul edilmemeli.


### 32. Açık — Veri sorumlusunun hukuki kimliği

Veri sorumlusu örnekte belirlenmemiştir. Gerçek veri sorumlusunun gerçek kişi veya tüzel kişi kimliği ve varsa kayıtlı unvanı doğrulanmalıdır; marka adından tüzel kişilik çıkarılmamalı, şirket yoktur gibi olumsuz iddia kurulmamalıdır. MERSİS/VKN/KEP gereği ve gerçek bilgileri ayrı incelenmelidir.

### 33. Açık — Kaynaklar ile yayındaki kapsamın eşleşmesi

Mobil silme ekranı, abonelik/RevenueCat, yönetim, Sentry ve yedekler farklı teslim aşamalarındadır. RevenueCat veri modeli vardır; hard-delete.ts yalnız abonelik kaydı varsa external_pending alanına revenuecat ekler, dış silme çağrısı yapmaz. Faz 5 entegrasyonu ve uzlaştırma sonrasında kanıt eklenmelidir. Sentry şimdilik planlanmıştır. Etkin özellikler, dış servisler ve mağaza aboneliğinin ayrıca iptal akışı uçtan uca doğrulanmalıdır.

### 34. Açık — Kamuya görünürlük ve üçüncü kişilere ait içerik

Authorization-matrix §6'daki görünürlük kuralları, yorumda görünen ad, herkese açık medya URL'leri, açık çağrı ve davet önizlemesi uygulamayla karşılaştırılmalı. Yayımlama için m.5/m.8 dayanağı, başkasının verisini içeren arma/fotoğraf/yorum/saha iletişim bilgisi ve kaldırma talepleri hukuki incelemede doğrulanmalı. Kamuya sunum, sınırsız yeniden kullanma izni sayılmamalı.

### 35. Açık — Haklar ve aydınlatmanın sunulması

m.11 haklarının tamamı, m.13 başvuru/cevap ve Kurula şikâyet koşulları hukuki incelemede doğrulanmalı. Kayıt, konum, görsel, abonelik ve aktarım noktalarında zamanında aydınlatma sağlanmalı; metni kabul düğmesi genel açık rıza yerine kullanılmamalı. Ayrı rıza gereken amaç, alıcı ve riskler kendi tercih akışında açıklanmalı.

### 36. Açık — İş kuyruğu, silme izi ve denetim kayıtları

ADR-0028 iş payload'larını kimliklerle sınırlar; completed/dead/receipt süreleri 7/14/30 gündür. queues.ts ve boss.ts kuyruk ayarlarını, maintenance/sweep.ts makbuz temizliğini içerir; üretim işleyişi kanıtlanmamıştır. Kullanıcıyla ilişkilendirilebilirlik, pg-boss arşivleri ve silme sonrası hedef kimlikleri incelenmelidir. ADR-0032'de append-only denetim kayıtları kalır; bunlar otomatik olarak anonim veya 30 günde silinir sayılmaz.

## Kaynak tablosu

Yayın sayfalarındaki iddiaların izleri aşağıdadır. İnceleme maddeleri gereklilik olarak okunur; “doğrulanmalı” ifadeleri o işlemin yapıldığı beyanı değildir.

| İddia / inceleme izi | Dosya / sınır |
| --- | --- |
| Örnek etiketi, kimliğin belirlenmemesi, partial, TR/AB birleştirme, üç katman | `legal-drafts/scope-joint-r2.md` B1–B11, B ve (c) |
| Kategori/amaç taslağı, m.5 tablosu, senaryo farkları | `legal-drafts/kvkk-aydinlatma.tr-yurtici.md`; `legal-drafts/kvkk-aydinlatma.tr-yurtdisi.md`; `legal-drafts/gizlilik.tr-yurtici.md`; `legal-drafts/gizlilik.tr-yurtdisi.md` |
| 36 maddelik kaynak ve inceleme kapsamı | `legal-drafts/ACIK-ALANLAR.md`; bu belgenin 1–36 maddeleri |
| Hesap/e-posta/sağlayıcı kimlikleri, profil, TOTP, token, silme kaydı | `kadro/packages/db/src/schema/users.ts` |
| Takım, rol ve davet alanları | `kadro/packages/db/src/schema/teams.ts` |
| Katılım, diziliş, başvuru, MVP, ücret işaretleme; kart/banka alanı içermeyen model | `kadro/packages/db/src/schema/matches.ts` |
| Saha noktası/adres/telefon, puan ve yorum | `kadro/packages/db/src/schema/venues.ts` |
| Görsel türü/boyutu/durumu ve kimlikler | `kadro/packages/db/src/schema/uploads.ts` |
| Push token/platform/son görülme, abonelik/webhook, denetim, hız sınırlama ve makbuz alanları | `kadro/packages/db/src/schema/system.ts` |
| Bölge adayları, yalnız dört sağlayıcı için Türkiye dışı nitelemesi, 30 günlük yedek tasarımı | `kadro/docs/adr/0002-hosting.md`; üretim kanıtı yok |
| Web 7 gün, mobil 15 dakika/30 gün geçerlilik | `kadro/docs/adr/0014-client-type-and-session-transport.md`; geçerlilik satır silme süresi değildir |
| S3 presign yerelde; dosya cihazdan depoya | `kadro/apps/web/lib/server/uploads/storage.ts`; `kadro/docs/adr/0030-image-upload-pipeline.md` |
| R2/S3 depo işçi işlemleri; yerel MinIO karşılığı | `kadro/apps/worker/src/storage/storage.ts`; `kadro/docs/adr/0030-image-upload-pipeline.md` |
| Resend mesaj alanları ve local logun bağlantı/token içermesi, local sınırı | `kadro/packages/emails/src/transport.ts` |
| Expo gönderim/receipt ve local log; cihaz tokenı loglanmaz | `kadro/apps/worker/src/push/transport.ts`; `kadro/docs/adr/0031-push-notifications.md` |
| Apple/Google sadece JWKS GET, yerel belirteç doğrulaması | `kadro/apps/web/lib/server/oauth/providers.ts`; `kadro/apps/web/lib/server/oauth/jwks.ts`; `kadro/apps/web/lib/server/auth/provider-sign-in.ts` |
| Cihazın girişte sağlayıcıyla doğrudan konuşması | `legal-drafts/scope-joint-r2.md` B4; sunucu dosyaları yalnız doğrulama kısmını kanıtlar, istemci uygulaması/gerçek koşu açık |
| HIBP ilk 5 SHA-1 karakteri, parola gönderilmez | `kadro/packages/auth/src/hibp.ts` |
| RevenueCat modeli ve abonelik varsa koşullu external_pending; dış çağrı yok, Faz 5 | `kadro/packages/db/src/schema/system.ts`; `kadro/packages/db/src/schema/users.ts`; `kadro/apps/worker/src/accounts/hard-delete.ts`; `kadro/docs/adr/0032-account-deletion-flow.md` |
| Sentry hata izleme/temizleme planı | `kadro/01-kadro-react-native-expo.md` §6 madde 14 ve §8; `legal-drafts/scope-joint-r2.md` (c); taranan TS/TSX/JSON kaynaklarında entegrasyon bulunmadı |
| Görünürlük sınırları | `kadro/docs/security/authorization-matrix.md` §6; tasarım ile fiili ekran/API eşleşmesi açık |
| Public medya, ham metadata, yayımlanan metadata temizliği | `kadro/docs/adr/0030-image-upload-pipeline.md`; `kadro/apps/worker/src/uploads/image.ts`; `kadro/apps/worker/src/uploads/process.ts` |
| Gelen depo 1 gün; public medya max-age=31536000; kaldırma | `kadro/docs/adr/0030-image-upload-pipeline.md`; `kadro/apps/worker/src/uploads/process.ts`; üretim yaşam döngüsü/CDN purge açık |
| Kuyruk 7/14/30 gün, saatlik bakım ve bir saat gecikeni yeniden kuyruğa alma | `kadro/docs/adr/0028-worker-queues-and-job-conventions.md`; `kadro/apps/worker/src/queues.ts`; `kadro/apps/worker/src/boss.ts`; `kadro/apps/worker/src/maintenance/sweep.ts` |
| 60 gün görülmeyen push tokenları; geçersiz tokenların kaldırılma tasarımı | `kadro/docs/adr/0031-push-notifications.md`; `kadro/apps/worker/src/maintenance/sweep.ts` |
| İptal/süre sonundan 30 gün sonra oturum satırı temizliği | `kadro/apps/worker/src/maintenance/sweep.ts`; üretim koşusu yok |
| Silme 7 gün, anında devre dışı/oturum iptali/token temizliği, girişle iptal | `kadro/docs/adr/0032-account-deletion-flow.md`; `kadro/apps/web/lib/server/account/deletion.ts`; `kadro/apps/web/lib/server/auth/account-state.ts` |
| Hesap/avatar/yorum/başvuru kaldırma, kaptanlık devri, tek üyeli takım silme, saha ekleyen bağlantısını kaldırma | `kadro/apps/worker/src/accounts/hard-delete.ts`; `kadro/docs/adr/0032-account-deletion-flow.md` |
| Tombstone: kişisel tanımlayıcılardan arındırılmış kayıt, süresiz; takım silinince geçmiş kalkabilir | `kadro/docs/adr/0033-per-account-history-tombstone.md`; `kadro/apps/worker/src/accounts/hard-delete.ts`; anonimlik sonucu çıkarılmaz |
| Append-only denetim kalır; azami süre belirlenmedi | `kadro/docs/adr/0032-account-deletion-flow.md`; `kadro/packages/db/src/schema/system.ts` |
| Host uygulama logları 30 gün; yedekte 30 güne kadar | `kadro/docs/ops/README.md`; `kadro/docs/adr/0032-account-deletion-flow.md`; `kadro/docs/adr/0002-hosting.md`; tasarım, üretim kanıtı yok |
| Çerez adları, nitelikler, varsayılan 7 gün ve aynı CSRF ttl | `kadro/apps/web/lib/server/cookies.ts`; `kadro/apps/web/lib/server/auth/sessions.ts`; `kadro/packages/config/src/schema.ts` |
| E-posta bağlantı yüzeylerinde analitik/üçüncü taraf kaynak yok; noindex | `kadro/docs/adr/0040-email-link-pages-phase2-scope.md`; site geneline uygulanmaz |
| Mobil Ayarlar → Hesabımı sil tasarımı ve /hesap-silme | `kadro/01-kadro-react-native-expo.md` §6 madde 21; `kadro/docs/adr/0032-account-deletion-flow.md`; `kadro/docs/adr/0040-email-link-pages-phase2-scope.md`; mobil gerçek koşu açık |
| Yaş, hassas cihaz konumu, özel nitelikli veri, rıza, başvuru/cevap ve değişiklik bildirimi | `legal-drafts/ACIK-ALANLAR.md` maddeler 6–10, 27, 29–30, 35; kesin süreçler belirlenmedi |
| Güvenlik denetimi partial ve 3 moderate notu | `legal-drafts/scope-joint-r2.md` B10; ADR-0043 güncel bulgu kapanışı bu teslimde doğrulanmadı |
| İşleme şartları ve m.11 hakları | İlk taslaklar; aşağıdaki resmi kaynaklarla karşılaştırıldı, nihai hukuki inceleme açık |
| m.9 aktarım ve 5 iş günü bildirim | İlk taslak madde 19 ve senaryolar; resmi aktarım/standart sözleşme duyuruları |

Hukuki inceleme kaynakları: [işleme şartları](https://www.kvkk.gov.tr/Icerik/2050/Kisisel-Veriler), [ilgili kişi hakları](https://www.kvkk.gov.tr/Icerik/2036/Ilgili-Kisinin-Haklari), [yurt dışına aktarım](https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim), [standart sözleşme bildirim koşulları](https://www.kvkk.gov.tr/Icerik/8170/Yurt-Disina-Kisisel-Veri-Aktariminda-Kullanilacak-Standart-Sozlesmelerde-Dikkat-Edilmesi-Gereken-Hususlara-Iliskin-Kamuoyu-Duyurusu), [özel nitelikli veriler](https://www.kvkk.gov.tr/Icerik/2051/Ozel-Nitelikli-Kisisel-Veriler). Başvuru m.13, cevap/bildirim ve Tebliğ usulü madde 29/35 kapsamında güncel Türkçe mevzuatla kesinleştirilecektir.

## Teslim doğrulaması

- [x] Tek anlatı; üç akış katmanı; hukuki sebep tablosu yalnız inceleme belgesinde.
- [x] Yayın sayfalarında kimlik, iletişim veya alıcı bölgesi uydurulmadı; köşeli yer tutucu kullanılmadı.
- [x] Saklama süreleri kaynak/kod sınırlarıyla eşlendi; üretim işletim kanıtı ileri sürülmedi.
- [x] Hesap silme bağlantıları korundu; mağaza aboneliği cümlesi yalnız planlanmış katmanda.
- [ ] WP4-8 built-page, MDX build/render, rota/bağlantı ve erişilebilirlik koşusu web sahibi tarafından tamamlanacak.
- [ ] Gerçek ortam, sağlayıcı sözleşmeleri ve 36 inceleme maddesi kapanacak; durum partial kalır.
