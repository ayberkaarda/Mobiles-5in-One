<?php

use App\Support\Web\Facts;
use App\Support\Web\Format;

/*
| The 15 questions and answers of /sss. The page and its FAQPage JSON-LD read this one list
| (same strings). Numbers come from Facts, so the copy follows the configuration.
|
| @return list<array{0: string, 1: string}> [question, answer], plain text
*/

$minutes = Facts::codeValidMinutes();
$radiusDefault = Facts::radiusDefaultM() / 1000;
$radiusMax = Facts::radiusMaxM() / 1000;

return [
    [
        'Askıda nedir?',
        'Askıda, mahalle esnafındaki askıda ekmek geleneğini uygulamaya taşıyan bir iyilik ağıdır. Bağışçı bir dükkândan ekmek, çorba, yemek ya da kırtasiye ürününün bedelini önceden öder; ürün dükkânın askısında bekler ve dileyen herkes soru sorulmadan alır.',
    ],
    [
        'Askıdan kimler alabilir?',
        'Herkes alabilir. Kimin aldığı sorulmaz, kaydedilmez ve kimse puanlanmaz. Askıdan almak bir ayrıcalık ya da başvuru değildir; mahalledeki herkesin kullanabileceği bir ortak askıdır.',
    ],
    [
        'Askıdan almak için hesap gerekir mi?',
        'Hayır. Uygulamada ilk ekrandaki "Askıdan al" seçeneği hesap, e-posta ya da telefon istemez. Yalnızca uygulamanın gerçek bir cihazda çalıştığını doğrulayan bir cihaz onayı yapılır; bu onay kimliğinizle ilişkilendirilmez.',
    ],
    [
        'Kod nasıl çalışır, ne kadar geçerlidir?',
        'Askıdan al dediğinizde '.Facts::codeLength().' karakterlik tek kullanımlık bir kod ve QR görürsünüz. Kod '.$minutes.' dakika geçerlidir; dükkânda esnafa gösterirsiniz, esnaf okutur ya da yazar ve ürünü verir. Süre dolarsa ürün askıya geri döner.',
    ],
    [
        'Bir günde kaç ürün alabilirim?',
        'Bir cihaz günde en fazla '.Facts::anonDailyCap().' ürün alabilir ve aynı dükkândan günde '.Facts::anonShopDailyCap().' ürün alınır. Sınır, askının herkese yetmesi ve tek kişinin hepsini toplayamaması için konmuştur.',
    ],
    [
        'Konumum kaydediliyor mu?',
        'Kesin konumunuz kaydedilmez. Yakındaki dükkânları göstermek için yaklaşık konum ya da seçtiğiniz ilçe kullanılır. Varsayılan arama yarıçapı '.$radiusDefault.' km, en fazla '.$radiusMax.' km olur.',
    ],
    [
        'Bağışımın parası nereye gidiyor?',
        'Ödeme bağışçıdan ödeme kuruluşuna, oradan dükkânın alt üye işyeri hesabına akar. Askıda parayı kendi hesabında tutmaz; yalnızca komisyonunu kaydeder. Bu nedenle ürün bedeli esnafa doğrudan ödeme kuruluşu üzerinden ulaşır.',
    ],
    [
        'Askıda komisyon alıyor mu?',
        'Evet, ödemeden küçük bir komisyon kesilir. Örnek oran '.Facts::commissionLabel().' olarak gösterilir ve kesin oran yayın öncesi belirlenir. Esnaf panelinde komisyon ayrı bir satır olarak şeffaf biçimde görünür.',
    ],
    [
        'Bağış tutarında bir sınır var mı?',
        'Evet. Tek bir ödeme en fazla '.Format::money(Facts::txCapMinor()).', bir bağışçının bir gündeki toplamı en fazla '.Format::money(Facts::dayCapMinor()).' olabilir. Bir ödemede bir üründen en fazla '.Facts::qtyMax().' adet seçilir.',
    ],
    [
        'Bağışımı kimin aldığını görebilir miyim?',
        'Hayır, bilerek görülmez. Bağışçı yalnızca "Askın alındı" diyen anonim bir bildirim alır. Alan kişiyle ilgili hiçbir bilgi bağışçıya ya da esnafa gösterilmez; esnaf yalnızca "1 ekmek verildi" görür.',
    ],
    [
        'Esnaf olarak nasıl katılırım?',
        'Uygulamada esnaf hesabı açar, dükkân adı, türü, adresi, telefonu ve vergi numarasını girersiniz; vergi levhası ve işletme belgesi gibi en fazla 3 belge yüklersiniz. Ödeme alabilmeniz için IBAN bilgisi de istenir. Kayıt, doğrulama sonrasında aktif olur.',
    ],
    [
        'Dükkânım ne zaman görünür?',
        'Dükkân, yöneticiler belgelerini doğruladıktan sonra uygulamada görünür. Web sitesindeki dükkân sayfası ayrıca sizin izninize bağlıdır; izin vermezseniz dükkânınız uygulamada kalır, web dizininde listelenmez.',
    ],
    [
        'Esnaf ödemesini ne zaman alır?',
        'Ödeme, ödeme kuruluşunun uzlaşma takvimine göre dükkânın IBAN hesabına aktarılır. Esnaf panelinde bağışlar, verilen ürün sayıları ve uzlaşma durumu görünür; durum bilgisi doğrudan sağlayıcı verisinden okunur.',
    ],
    [
        'Hesabımı ve verilerimi nasıl silerim?',
        'Bağışçı ve esnaf hesabını uygulamadan ya da web sitesinin hesap silme sayfasından silebilirsiniz. Askıdan alan kişiler hesapsız olduğundan uygulamadaki "Verilerimi sıfırla" seçeneği cihaz kimliğini siler. Toplu sayaçlar kişi içermez.',
    ],
    [
        'Sitedeki rakamlar gerçek mi?',
        'Henüz yayında değil; Askıda şu an örnek verilerle gösterilir. Örnek dükkân ve rakamlar sayfada [ÖRNEK] etiketiyle işaretlenir. Gerçek veri geldiğinde sayaçlar ürün adedi olarak, tarih ve yöntem notuyla yayımlanır.',
    ],
];
