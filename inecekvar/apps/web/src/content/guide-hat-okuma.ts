import { app, Block, h2, note, ol, p, to, ul } from './blocks';

export const readLineBlocks: Block[] = [
  p(
    'Bir hat sayfasını okurken beş şeye bak: hattın adı ve kodu, ilk ile son durak, durakların sırası, ücretin yanındaki tarih ve "son doğrulama" tarihi. Bu beşi birbiriyle uyuşuyorsa sayfa sana güvenle yol gösterir; biri eksikse ya da eskiyse hattı yola çıkmadan önce bir kez daha kontrol etmek gerekir.',
  ),
  p(
    'Dolmuş ve minibüs hatlarının çoğunda resmî bir tarife kitapçığı ya da herkese açık bir veri kaynağı yok. Bilgiyi o hattı her gün kullanan insanlar toplar. Bu yüzden sayfadaki her satırın bir tarihi ve bir sürümü var. Aşağıda bir ',
    to('/', 'şehir sayfasından'),
    ' açtığın hat sayfasındaki alanları sırayla anlatıyoruz.',
  ),
  h2('Başlık, kod ve araç türü'),
  p(
    'Sayfanın başlığı hattın adıdır; çoğu zaman iki ucu gösterir. Kod varsa başlığın yanında durur. Araç türü "dolmuş", "minibüs" ya da "servis" olarak yazılır. Aynı iki durak arasında hem minibüs hem dolmuş çalışıyorsa bunlar ayrı hatlardır; ücreti, saati ve durma şekli farklı olabilir. Hat kodunu ezberleme, çünkü aynı kod başka bir şehirde başka bir yolu anlatabilir. Şehir adı her zaman adresin ve başlığın bir parçasıdır.',
  ),
  h2('Kısa özet ne söyler'),
  p(
    'Başlığın altındaki ilk paragraf, hattın en önemli bilgisini tek solukta verir: nereden kalkar, hangi duraklara uğrar, ücreti ne kadardır ve bu ücret hangi tarihte yazılmıştır. Bu özet sayfadaki verilerden otomatik kurulur. Yani özette olup sayfada olmayan bir bilgi yoktur. Özet bir rakam içeriyorsa onun yanında bir tarih de bulursun; tarih yoksa rakamı kesin kabul etme.',
  ),
  h2('Harita ve durak sırası'),
  p(
    'Harita hattın izini çizer, duraklar numaralı listede aynı sırayla gelir. Sıra önemlidir: liste yönü gösterir. Gidiş ve dönüş aynı sokaklardan geçmeyebilir, bu yüzden dönüşte aynı durağın karşı kaldırımda olması normaldir. Durak adları çoğu zaman mahallenin söylediği isimlerdir, resmî tabela adı olmak zorunda değildir. Resmî tabelası olmayan bir noktada durak adı bir yer adı olabilir: bir fırın, bir cami ya da bir köprü altı.',
  ),
  p(
    'Haritadaki çizgi bir rehberdir, mühendislik çizimi değildir. Katkıcıların sürüş kaydından türetilir ve gerçek yoldan bir miktar sapabilir. Çizginin başlangıcı ve sonu ayrıca bilerek kısaltılmıştır; nedenini ',
    to('/rehber/hat-bilgisi-nasil-dogrulanir', 'hat bilgisinin doğrulanması rehberinde'),
    ' bulabilirsin.',
  ),
  h2('Ücret ve tarihi'),
  p(
    'Ücret, kuruş cinsinden saklanan bir değerin lira olarak yazılmış halidir ve yanında "son güncelleme" tarihi bulunur. Dolmuş ve minibüs ücretleri sık değişir; bu yüzden tarihi olmayan bir ücret bilgisini referans alma. Tarih birkaç aydan eskiyse ücret değişmiş olabilir. Böyle bir durumda elindeki parayı biraz esnek tut ve şoförden ücreti binmeden önce sor. Ücreti güncel bildiğin bir hat varsa sayfadaki "Bu hattı düzelt" bağlantısıyla bunu yazabilirsin.',
  ),
  h2('Saatler, ödeme ve durdurma notu'),
  ul(
    'Saatler: ilk ve son sefer saati ya da serbest metin olarak yazılır. Dolmuşlar çoğu zaman dolunca kalktığı için sıklık kesin bir sayı değildir.',
    'Ödeme: nakit, kart ve İstanbulkart seçeneklerinden hangisinin geçtiği işaretlenir. İşaret yoksa bilinmiyor demektir, geçmiyor demek değildir.',
    'Durdurma notu: aracı nereden durdurduğun ve nasıl indiğin, katkıcının düz metin notudur. Örneğin hangi kaldırımdan el kaldırılır gibi mahalle bilgisi burada durur.',
  ),
  h2('Güven göstergeleri: doğrulama, katkıcı sayısı, sürüm'),
  p(
    'Sayfanın alt kısmında üç güven göstergesi vardır. "Son doğrulama" hattın bir moderatör onayından en son ne zaman geçtiğini söyler. Katkıcı sayısı, hattı kaç farklı kişinin yazdığını ya da düzelttiğini gösterir. Sürüm numarası ve sürüm tarihi ise sayfadaki bilginin hangi onaylı kayıttan geldiğini belirtir. Her onay yeni bir sürüm üretir; eski sürümler silinmez, bu yüzden bir yanlış düzeltme geri alınabilir.',
  ),
  p(
    'Üç gösterge birlikte iyi görünüyorsa sayfa sağlamdır. Doğrulama eskiyse ve katkıcı sayısı bir ise, hattı tek bir kişi yazmış ve uzun süredir kimse bakmamış demektir. Bu hat yanlış olmak zorunda değildir, ama dikkatle okunmalıdır.',
  ),
  h2('Hattı yola çıkmadan önce okumanın kısa yolu'),
  ol(
    'Şehri ve hattın iki ucunu kontrol et; gideceğin yönle uyuşuyor mu?',
    'Duraklar listesinde bineceğin ve ineceğin durağı bul; sırayı kontrol et.',
    'Ücretin tarihine bak; eskiyse parayı esnek tut.',
    'Saat ve ödeme notunu oku; kartın geçmeyebileceğini düşünerek nakit bulundur.',
    'Son doğrulama tarihine bak; çok eskiyse yola çıkmadan başka bir kaynakla da kontrol et.',
  ),
  note(
    'İnecek Var resmî bir kurum değildir ve resmî tarife yayımlamaz. Sayfalardaki bilgi mahalleli katkıcılardan gelir; hat sayfalarındaki tarihler bu bilginin ne kadar taze olduğunu söyler.',
  ),
  h2('Uygulamada aynı bilgi'),
  p(
    'Aynı hat bilgisi mobil uygulamada ve ',
    app('/', 'web uygulamasında'),
    ' de görünür. Uygulamada hattı bir kez indirdiğin şehir paketiyle internet olmadan da açabilirsin; bunu ',
    to('/rehber/cevrimdisi-sehir-paketi-nasil-kullanilir', 'çevrimdışı şehir paketi rehberinde'),
    ' anlattık. Sık sorulan sorulara ',
    to('/sss', 'sıkça sorulan sorular'),
    ' sayfasından ulaşabilirsin.',
  ),
  p(
    'İlk kez dolmuşa ya da minibüse biniyorsan ',
    to('/rehber/istanbul-minibus-dolmus-farki-nasil-binilir', 'minibüs ile dolmuş farkını'),
    ' anlatan rehberle başla; inme alışkanlığı için ',
    to('/rehber/durak-yoksa-nereden-inilir-inecek-var', 'durak yoksa nereden inilir'),
    ' yazısına bak.',
  ),
];
