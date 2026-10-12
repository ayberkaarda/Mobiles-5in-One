import { Block, h2, note, ol, p, to, ul } from './blocks';

export const istanbulBlocks: Block[] = [
  p(
    'Kısaca: gündelik dilde dolmuş ve minibüs çoğu zaman aynı şeyi anlatır; belirli bir güzergâhta giden, yolcu aldıkça dolan paylaşımlı araç. İstanbul’da bu araca binmenin pratik kuralı şudur: hattı ve yönü önceden bil, durakta ya da yol kenarında el kaldır, ücreti ve ineceğin yeri şoföre söyle. Ücret ve güzergâh hat sayfasında tarihiyle yazılır; bu rehberde rakam vermiyoruz.',
  ),
  p(
    'Şehre yeni gelen biri için en şaşırtıcı şey, bu araçların basılı bir tarife tablosuna değil, bir alışkanlığa göre çalışmasıdır. Aşağıda iki kelimenin ne anlattığını ve ilk kez binen birinin neleri bilmesi gerektiğini sıraladık. Hatlar ve ücretler değiştiği için belirli bir hattı anlatmıyoruz; bunun yerine hat sayfalarındaki bilgiyi nasıl yorumlayacağını gösteriyoruz.',
  ),
  h2('Minibüs ve dolmuş: fark nerede'),
  p(
    'Dolmuş kelimesi "doldu" fikrinden gelir: araç dolunca kalkar. Minibüs ise aracın türünü, yani küçük otobüsü anlatır. Pratikte ikisi sık sık çakışır ve insanlar aynı hattı bir gün biri, bir gün öbürü diye çağırır. İnecek Var’da her hattın araç türü "dolmuş", "minibüs" ya da "servis" olarak yazılır; bu yazım hattı en çok kullananların söyleyişini izler. Adı ne olursa olsun, bir hattın nasıl çalıştığını anlamak için şu dört şeye bakmak yeterlidir:',
  ),
  ul(
    'Güzergâh: çoğu hatta başlangıç ve bitiş noktaları bellidir, arada birçok durak vardır.',
    'Kalkış düzeni: araç sabit bir saatte değil, çoğu zaman dolunca kalkar. Yoğun saatte bekleme kısa, sakin saatte uzun olabilir.',
    'Durma şekli: tabelalı duraklar olabilir, mahallenin bildiği noktalar olabilir. İnişte şoföre söylersin, binişte el kaldırırsın.',
    'Ödeme: nakit, kart ya da İstanbulkart hattan hatta değişir ve hat sayfasında işaretlenir.',
  ),
  h2('Nasıl binilir'),
  ol(
    'Doğru yönde olduğundan emin ol. Hat sayfasındaki durak sırasına bak: bineceğin durak, ineceğin duraktan önce mi geliyor?',
    'Araç yaklaşırken ön camdaki güzergâh yazısına bak. Yazı eskiyse ya da okunmuyorsa şoföre bir kez sormakta sakınca yok.',
    'Durakta ya da yolun kenarında, aracın seni görebileceği bir yerde el kaldır.',
    'Bindiğinde ücreti sor ve hat sayfasındaki tarihle karşılaştır. Değişmişse düzeltme notu bırakabilirsin.',
    'Ödemeyi nasıl yapacağını baştan bil. Sayfada kart işaretli olsa bile o gün cihaz çalışmıyor olabilir; yanında bozuk para bulundurmak iyi bir alışkanlıktır.',
  ),
  h2('Ücret ve güzergâh neden sayfada yazılı'),
  p(
    'Ücret ve güzergâh hat sayfasında tarihiyle yazılır. Bir rakamı ezberlemeye çalışma: tarifeler zaman içinde değişir ve aynı iki durak arasında farklı hatların farklı ücreti olabilir. Ücretin yanında "son güncelleme" tarihi yoksa bilgiyi kesin saymamak gerekir. Tarih eskiyse elindeki parayı biraz esnek tut ve binerken sor. Bu rehberin bilerek rakam vermemesinin nedeni budur: rakam yazsak, bir sonraki zamla birlikte yanlış olurdu.',
  ),
  h2('Nereden binilir, nereden inilir'),
  p(
    'Bazı hatların net durakları vardır, bazılarında araç yolun uygun bir yerinde durur. Hat sayfasında duraklar iki türde görünebilir: tabelası olanlar ve mahallelinin kullandığı noktalar. İkincisi için sayfadaki durdurma notuna bak. İnerken kural basittir ve ',
    to('/rehber/durak-yoksa-nereden-inilir-inecek-var', 'durak yoksa nereden inilir rehberinde'),
    ' ayrıntısıyla anlatılır.',
  ),
  h2('İlk kez binenler için küçük ipuçları'),
  ul(
    'Gece ve hafta sonu seferleri farklı olabilir. Hat sayfasındaki saat notuna bak; ilk ve son sefer saatleri hattan hatta değişir.',
    'Değişen bir güzergâh ya da zam sayfaya hemen yansımamış olabilir. Sayfanın "son doğrulama" tarihine bak ve gerekirse şoföre sor.',
    'Telefonunda internet kısıtlıysa şehir paketini önceden indir. Nasıl yapılacağı ayrı bir rehberde anlatılıyor.',
    'Araç doluysa ve bir sonraki araç kısa süre içinde geliyorsa beklemek, tek ayakla basarak yolculuk etmekten genellikle daha rahattır.',
  ),
  h2('Hat sayfasından bilgi okumak'),
  p(
    'Bir hat sayfasının her satırını nasıl yorumlayacağını ',
    to(
      '/rehber/dolmus-ve-minibus-hatti-nasil-okunur',
      'dolmuş ve minibüs hattı nasıl okunur rehberinde',
    ),
    ' topladık. Kısacası: kod ve ad hattı tanımlar, durak sırası yönü verir, ücretin tarihi güncelliği, son doğrulama güveni söyler.',
  ),
  h2('Uçları bilmek, kodu bilmekten iyidir'),
  p(
    'Mahalle "Kadıköy minibüsü" der; kodu bilen azdır. Bu yüzden hat ararken hem kodu hem iki ucu yazabilirsin. Bir şehri öğrenirken önce uçları, sonra kodları ezberle. Aynı iki durak arasında çalışan birden fazla hat varsa hat sayfaları farkı ücret, saat ve durma notu satırlarında gösterir. ',
    to('/', 'Şehir sayfalarından'),
    ' hat listesine ulaşabilirsin.',
  ),
  note(
    'Bu rehber genel bir anlatımdır; bir hattın güncel ücreti, saati ya da durağı için ilgili hat sayfasına bak. Bilgi eksik ya da yanlışsa o sayfadaki düzeltme bağlantısı seni uygulamaya götürür.',
  ),
  p(
    'Toparlarsak: dolmuş ve minibüsle yolculuk, iyi bir bilgiyle zor değildir. Bilgi mahalleden gelir, tarihi sayfada durur ve eksikse düzeltmek herkesin elindedir. Daha fazla soru için ',
    to('/sss', 'sıkça sorulan sorulara'),
    ' bakabilirsin.',
  ),
];
