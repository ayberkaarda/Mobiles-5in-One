---
title: KVKK aydınlatma metni
short: KVKK aydınlatma metni
description: Patika uygulaması ve web sitesinde hangi kişisel verilerin, hangi amaçla işlendiği, kimlere aktarıldığı, ne kadar saklandığı ve 6698 sayılı Kanun kapsamındaki hakların. Taslak, hukuki inceleme bekliyor.
slug: kvkk
updated: 2026-10-26
---
Sürüm 0.1 (taslak). Yürürlük tarihi [YÜRÜRLÜK TARİHİ]. Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun ("KVKK") 10. maddesi uyarınca hazırlanmış bir taslaktır. Köşeli parantezli alanlar hukuk onayından sonra doldurulacaktır.

## 1. Veri sorumlusu {#sorumlu}

Kişisel verileriniz, veri sorumlusu sıfatıyla [ŞİRKET UNVANI] ("Patika") tarafından işlenir.

- Adres: [ADRES]
- KVKK başvuruları için e-posta: [KVKK E-POSTA ADRESİ]
- VERBİS kayıt bilgisi: [VERBİS KAYIT NUMARASI VEYA MUAFİYET DURUMU]

## 2. Hangi kişisel verileri işliyoruz? {#veriler}

Patika yalnızca uygulamanın çalışması için gereken verileri işler:

- **Kimlik ve hesap bilgileri:** e-posta adresi, görünen ad, isteğe bağlı olarak ilçe, hesap rolü. Şifrenin kendisi saklanmaz; yalnızca tek yönlü bir özeti (Argon2) tutulur. Google ile giriş yaparsanız Google hesabınızın kimlik numarası hesabınıza bağlanır.
- **Doğrulama kodları ve oturum bilgileri:** e-posta doğrulama ve şifre sıfırlama için gönderilen 6 haneli kodlar yalnızca anahtarlı bir özet olarak, 15 dakika geçerli tutulur. Oturum yenileme anahtarları da yalnızca özet olarak saklanır.
- **Paylaştığınız içerik:** eklediğiniz istasyonlar, hayvan kayıtları, besleme ve görülme kayıtları, notlar, sahiplendirme ilanları ve başvuruları, acil yardım çağrıları, bildirimler (şikâyetler) ve fotoğraflar.
- **Fotoğraflar:** fotoğrafların konum (GPS), cihaz ve zaman bilgisi dahil tüm meta verileri telefonunuzda silinir; sunucuya yalnızca görüntünün kendisi ulaşır.
- **Konum:** yalnızca bir istasyon eklerken, besleme kaydederken veya acil yardım çağrısı açarken o kaydın yeri olarak işlenir. Konumunuz profilinizde saklanmaz ve arka planda konum alınmaz. Acil bildirimleri açarsanız seçtiğiniz yaklaşık ev bölgesi, yaklaşık 100 metreye yuvarlanmış olarak saklanır; bildirimleri kapattığınızda silinir.
- **Bildirim için cihaz bilgisi:** acil yardım bildirimleri için cihazınızın bildirim belirteci ve uygulama kurulum kimliği.
- **Güvenlik kayıtları:** kötüye kullanımı önlemek için istek sayıları, moderasyon kararları ve yönetim işlemlerinin denetim kaydı. Sunucu kayıtlarında şifre, anahtar ve oturum bilgileri maskelenir, koordinatlar yuvarlanır.

Web sitesi ziyaretçilerinden hesap bilgisi alınmaz; site çerez tabanlı reklam veya takip araçları kullanmaz. [WEB SİTESİ SUNUCU KAYITLARI VE ANALİTİK, VARSA]

## 3. İşleme amaçları ve hukuki sebepler {#amaclar}

Verileriniz şu amaçlarla işlenir: hesabınızı oluşturmak ve güvenliğini sağlamak, istasyon haritasını, besleme takibini, sahiplendirme ve acil yardım özelliklerini sunmak, acil yardım bildirimlerini yakındaki gönüllülere iletmek, içerikleri moderasyondan geçirmek, kötüye kullanımı önlemek ve yasal yükümlülükleri yerine getirmek.

[HER AMAÇ İÇİN KVKK MADDE 5 KAPSAMINDAKİ HUKUKİ SEBEP, ÖRNEĞİN SÖZLEŞMENİN İFASI, MEŞRU MENFAAT VEYA AÇIK RIZA; HUKUK ONAYIYLA]

## 4. Kişisel veriler kimlere aktarılır? {#aktarim}

Kişisel verileriniz satılmaz ve reklam amacıyla paylaşılmaz. Hizmetin çalışması için şu hizmet sağlayıcılarla, yalnızca gerektiği ölçüde paylaşılır:

- Barındırma ve veritabanı hizmeti: [SAĞLAYICI VE ÜLKE]
- Fotoğraf depolama ve içerik dağıtımı: [SAĞLAYICI VE ÜLKE]
- E-posta gönderimi (doğrulama ve bildirim e-postaları): [SAĞLAYICI VE ÜLKE]
- Anlık bildirim iletimi (Firebase Cloud Messaging): [SAĞLAYICI VE ÜLKE]
- Google ile giriş seçeneğini kullanırsanız Google: [ÜLKE]

[YURT DIŞINA AKTARIM DURUMU VE KVKK MADDE 9 KAPSAMINDAKİ DAYANAK]

Herkese açık sayfalarda gönüllülerin adı, e-postası veya kimliği gösterilmez. İstasyon konumları yaklaşık 100 metreye yuvarlanır; acil yardım çağrılarının ve hayvanların konumu web sitesinde yayımlanmaz.

## 5. Ne kadar süre saklıyoruz? {#sure}

- **Hesap verileri:** hesabınız açık kaldığı sürece.
- **Hesap silme:** hesabınızı sildiğinizde hesabınız hemen kapanır. 7 gün içinde yeniden giriş yapmazsanız hesabınız ve kişisel verileriniz kalıcı olarak silinir. Besleme ve görülme kayıtlarınız istasyon geçmişi korunsun diye silinmez; sizinle bağlantısı kesilir, not ve fotoğrafları silinir. Eklediğiniz istasyonlar ve hayvan kayıtları haritada kalır, fotoğrafları silinir.
- **Doğrulanmamış hesaplar:** e-postası 7 gün içinde doğrulanmayan kayıtlar silinir.
- **Doğrulama kodları:** 15 dakika geçerlidir.
- **Sahiplendirme ilanları:** yayımdan 60 gün sonra ya da hayvan yuvasına kavuştuğunda kapanır.
- **Yedekler:** [YEDEKLERİN SAKLAMA SÜRESİ]
- **Diğer süreler:** [SUNUCU KAYITLARI, DENETİM KAYITLARI VE DİĞER SÜRELER]

## 6. Kişisel veriler nasıl toplanır? {#toplama}

Verileriniz, uygulamaya ve web sitesine girdiğiniz bilgilerden, Google ile giriş yaptığınızda Google'ın ilettiği kimlik bilgisinden ve uygulamanın çalışması sırasında elektronik ortamda otomatik yollarla toplanır.

## 7. Haklarınız {#haklar}

KVKK'nın 11. maddesi uyarınca; verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, KVKK'daki şartlar çerçevesinde silinmesini veya yok edilmesini isteme, bu işlemlerin aktarıldığı kişilere bildirilmesini isteme, otomatik sistemlerle analiz sonucu aleyhinize bir sonuç doğmasına itiraz etme ve zarara uğramanız hâlinde giderilmesini talep etme haklarına sahipsiniz.

Başvurularınızı [BAŞVURU YOLU VE ADRESİ] üzerinden iletebilirsiniz. Hesabınızı uygulamadan veya [hesap silme sayfasındaki](/hesap-silme) yol ile silebilirsiniz.
