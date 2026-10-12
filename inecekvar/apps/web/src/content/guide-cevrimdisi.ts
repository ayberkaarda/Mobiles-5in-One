import { app, Block, h2, note, ol, p, to, ul } from './blocks';

export const offlineBlocks: Block[] = [
  p(
    'Çevrimdışı şehir paketi, bir şehrin hat ve durak bilgisinin telefonuna indirilmiş halidir. Paketi internet varken bir kez indirirsin; sonra uçak modunda ya da kapsama alanı dışında da hat arar, hat ve durak sayfalarını açar, yakındaki durakları görürsün. İndirme işlemi Ayarlar bölümündeki "Çevrimdışı şehirler" sayfasından yapılır ve ücretsiz sürümde bir şehir için geçerlidir.',
  ),
  p(
    'Dolmuş yolculuğunun en kötü anı, tam inmen gereken yeri bulmaya çalışırken internetin kesilmesidir. Şehir paketi bunun için var. Aşağıda paketin içinde ne olduğunu, nasıl indirileceğini, çevrimdışıyken neyin çalıştığını ve neyin çalışmadığını dürüstçe yazıyoruz.',
  ),
  h2('Pakette ne var'),
  ul(
    'Şehrin yayımlanmış hatları: hat adı, kodu, araç türü ve hat izi.',
    'Sıralı duraklar ve durak adları.',
    'Ücret, ücretin son güncelleme tarihi, saat notu, ödeme yöntemleri ve durdurma notu.',
    'Şehrin harita altlığı. Harita altlığı sunucuda hazırsa pakete eklenir; hazır değilse paket harita altlığı olmadan kurulur ve harita düz bir arka planda çizilir.',
  ),
  p(
    'Pakette katkıcıların adı, e-posta adresi ya da sürüş kayıtları bulunmaz. Paket yalnızca herkese açık hat bilgisini taşır.',
  ),
  h2('Paket nasıl indirilir'),
  ol(
    [
      'Uygulamayı aç, ',
      app('/', 'web uygulamasında'),
      ' ya da mobil uygulamada Ayarlar bölümüne git.',
    ],
    '"Çevrimdışı şehirler" sayfasını aç. Arama sekmesi de şehir seçtiğinde paketi indirmeni önerir.',
    'Şehrin satırında indirme düğmesine bas. İlerleme çubuğu görünür, istersen iptal edebilirsin.',
    'İndirme bitince satırda paketin sürümü, boyutu, tarihi ve harita altlığı içerip içermediği yazar.',
  ),
  p(
    'Boyut şehre göre değişir; indirmeden önce telefonunda boş yer olduğundan emin ol. Uygulama indirmeden önce boş yeri kontrol eder ve yer yoksa paketi kurmaz. Bir şehir için bir günde yapılabilecek indirme sayısı sınırlıdır; bu sınır yanlışlıkla tekrar tekrar indirmeyi önlemek içindir.',
  ),
  h2('Kurulum sırasında yanlış giderse'),
  p(
    'Paket önce ayrı bir yere yazılır, okunur ve beklenen sağlama değeriyle karşılaştırılır; doğruysa tek adımda eski paketin yerine geçer. İndirme yarıda kalırsa, bağlantı kesilirse ya da dosya bozuksa eski paketin çalışmaya devam eder. Uygulama paketi her yüklediğinde sağlamasını yeniden kontrol eder ve uyuşmayan bir paketi bozuk olarak işaretler.',
  ),
  h2('Çevrimdışıyken neler çalışır'),
  ul(
    'Hat arama: kod, ad ya da serbest metinle.',
    'Hat ve durak sayfaları: ücret, saat, durak sırası, durdurma notu ve harita çizgisi.',
    'Yakındaki duraklar: konumun cihazda hesaplanır, hiçbir yere gönderilmez.',
    'Favoriler: misafir olarak cihazda tutulanlar.',
  ),
  h2('Çevrimdışıyken neler çalışmaz'),
  ul(
    'Bir noktadan öbürüne yol planlayıcı: önerileri sunucu kurar, bu yüzden internet gerekir. Çevrimdışıyken uygulama "hatlara göz at" seçeneğini sunar.',
    'Katkı göndermek, giriş yapmak ve hesap işlemleri.',
    'Pakette olmayan bir hat ya da durak: internet varken sunucudan sorulur, çevrimdışıyken "bulunamadı" gösterilir.',
    'Paket yenilikleri: paketi indirdikten sonra bir hat değiştiyse yeni bilgi pakete ancak güncelleyince gelir.',
  ),
  h2('Güncelleme ve silme'),
  p(
    'Şehrin yeni bir paket sürümü olduğunda satırda güncelleme önerisi çıkar. Güncelleme eski paketi yenisi tamamen kurulduktan sonra siler. Bir paketi silmek için silme düğmesine iki kez basman gerekir; ilk basış onay ister. Ekranın altında paketlerin telefonunda ne kadar yer kapladığı ve cihazın bildirdiği boş alan görünür.',
  ),
  h2('Ücretsiz sürüm ve Plus'),
  p(
    'Ücretsiz sürümde bir şehir paketi indirebilirsin. Birden fazla şehir için ayrı bir abonelik planlanıyor; uygulamada "Plus" adıyla duyurulur. Paketi indirmek ve kullanmak için hesap açmak gerekmez. Plus satışı bu aşamada açık değildir; ücretsiz paketin sınırı sunucuda uygulanır, yani cihazdaki bir ayarla aşılamaz.',
  ),
  h2('Tarayıcıda ve telefonda fark'),
  p(
    'Mobil uygulamada paketler uygulamanın kendi veri klasöründe saklanır. Web uygulamasında tarayıcının önbellek deposu kullanılır. Tarayıcı, özellikle yer azaldığında, site verisini kendi başına temizleyebilir; paketin sürekli lazımsa mobil uygulamayı tercih et. Çok eski bir tarayıcıda paket yalnızca sayfa açıkken bellekte kalır ve sayfayı yenileyince gider; uygulama böyle bir durumda bunu açıkça söyler.',
  ),
  note(
    'Paketler bir kayıt tutmaz: hangi şehri indirdiğin, ücretsiz şehir hakkını hesaplamak için sunucuda tutulur; sunucu bunu ham IP adresiyle değil, geri döndürülemeyen bir özetle yapar.',
  ),
  h2('Yolculuktan önce kısa liste'),
  ol(
    'Şehir paketinin indirildiğini ve sürümünün güncel olduğunu kontrol et.',
    'Bineceğin hattı ara, durak listesini bir kez aç ve ineceğin durağı bul.',
    'Telefonun konum izni "uygulama kullanılırken" açık mı, bak. Yakındaki durak özelliği için gerekli.',
    'Hattın ücret tarihine bak; çevrimdışı bilgi, indirdiğin paketin sürüm tarihini taşır.',
  ),
  p(
    'Hat bilgisinin nasıl okunduğunu ',
    to('/rehber/dolmus-ve-minibus-hatti-nasil-okunur', 'hat okuma rehberinde'),
    ' bulabilirsin. Veri paketi tüm şehre ait yayımlanmış hat bilgisini içerdiğinden, açık veri olarak yayımlanan haftalık dışa aktarımla büyük oranda aynı kaynaktan gelir; ayrıntılar ',
    to('/veri', 'açık veri sayfasında'),
    '. Hangi şehirlerin hat bilgisinin yayımlandığını ',
    to('/', 'şehir listesinde'),
    ' görebilir, aklına takılanları ',
    to('/sss', 'sıkça sorulan sorulara'),
    ' sorabilirsin.',
  ),
];
