import { Block, h2, note, ol, p, to, ul } from './blocks';

export const stopBlocks: Block[] = [
  p(
    'Durak yoksa iyi bir inme yeri şudur: aracın güvenle durabileceği, arkadan gelenlerin seni ve aracı görebildiği, doğrudan kaldırıma inebileceğin bir nokta. "İnecek var" diyerek şoföre bir iki durak önceden haber ver, aracın durmasını bekle, yola değil kaldırıma in. Bu cümle hem bir alışkanlık hem de uygulamanın adıdır.',
  ),
  p(
    'Dolmuş ve minibüs kültürünün güzel yanı, aracın çoğu zaman yolun en uygun yerinde durabilmesidir. Zor yanı ise bu esnekliğin herkesin aynı şeyi beklediğini varsaymasıdır. Burada inme alışkanlığını, kimseyi zora sokmayacak bir sırayla anlatıyoruz.',
  ),
  h2('"İnecek var" ne demek'),
  p(
    'Yolcu, araç hareket halindeyken "inecek var" der, çoğu zaman "müsait bir yerde" diye ekler. Bu cümle şoföre iki şey söyler: bir yolcu inecek ve aracı güvenle durdurabileceği bir yer seçmesi gerekiyor. Uygulamanın adı bu cümleden gelir. Bir hattı haritalarken de aynı mantığı izleriz: durak diye işaretlenen yer, tabeladan çok mahallenin gerçekten indiği noktadır.',
  ),
  h2('Önceden haber vermek'),
  p(
    'İneceğin noktaya yaklaşmadan, en az bir iki durak ya da yarım dakika önce söyle. Şoför son anda duyarsa aracı sert frenle durdurmak zorunda kalabilir; bu, arkadaki araçlar ve yolcular için tehlikelidir. Kalabalık araçta sesini duyurmakta zorlanıyorsan yanındaki yolcudan ilet. "Şoföre söyler misin" demek bu kültürün normal bir parçasıdır.',
  ),
  h2('Güvenli inme yeri nasıl seçilir'),
  ul(
    'Kavşağın hemen içinde ya da keskin dönemeçte inme. Araç durduğunda arkadan gelen sürücülerin seni görme süresi kısalır.',
    'Doğrudan kaldırıma inebileceğin bir yer seç. Yolun ortasında ya da refüje yakın bir noktada inmen gerekiyorsa şoföre başka bir yer söyle.',
    'Çift sıra park edilmiş araçların önünde inme. Araçların arasından yola çıkmak seni sürücüler için görünmez yapar.',
    'Yaya geçidini ya da bisiklet yolunu kapatan bir noktada durulmasını isteme.',
    'Okul önü ya da hastane girişi gibi zaten yoğun noktalarda şoföre biraz ilerisini söyle.',
  ),
  h2('Kapıdan çıkarken'),
  p(
    'Kapıdan çıkmadan önce yan şeride bak: bir motosiklet ya da bisiklet aracın yanından geçiyor olabilir. İndikten sonra aracın önünden değil, aracın hareket etmesini bekleyip arkasından ya da güvenli bir geçitten karşıya geç. Araç hareket ettiğinde önündeki yayayı görmeyebilir.',
  ),
  h2('Dolu araçta nasıl inilir'),
  ol(
    'İneceğin yere yaklaşmadan önce kapıya doğru ilerle. Araç doluysa ve ayaktaysan yolcuların yol vermesi için bir iki durak önceden hareket et.',
    '"Pardon, inecek var" demek yeterlidir; açıklama yapmak zorunda değilsin.',
    'Şoföre ineceğin yeri net söyle: "köprüden sonra", "fırının önünde", "ışıkta". Genel ifadeler yerine çevredeki bir işaret ver.',
    'Araç durana kadar kapıdan uzak dur; kapı açılınca önce inenlere yol ver.',
  ),
  h2('Yeni bir şehirde inme yeri nasıl bulunur'),
  p(
    'Bilmediğin bir şehirde ineceğin yeri bulmak için hat sayfasındaki durak listesine ve haritadaki çizgiye bak. Durak adları çoğu zaman mahallenin söylediği isimlerdir. Yolculuktan önce ',
    to('/rehber/cevrimdisi-sehir-paketi-nasil-kullanilir', 'çevrimdışı şehir paketini'),
    ' indirdiysen internet olmayan bir yerde bile durak listesini ve hat bilgisini açabilirsin. Telefonunun konumu uygulamada yalnızca yakındaki durakları göstermek için kullanılır.',
  ),
  h2('Durak bilgisi yanlışsa'),
  p(
    'Bir hat sayfasında gördüğün durak aslında başka bir yerde olabilir ya da artık kullanılmıyor olabilir. Hat sayfasındaki düzeltme bağlantısıyla bunu bildirebilirsin. Önerin bir moderatörün onayından geçer; bu süreç ',
    to('/rehber/hat-bilgisi-nasil-dogrulanir', 'hat bilgisi nasıl doğrulanır rehberinde'),
    ' anlatılıyor. Yolculuğunu kayıt olarak gönderirsen, evinin ya da işyerinin tahmin edilmemesi için kaydın başındaki ve sonundaki ilk 200 metre sunucuda kesilir.',
  ),
  h2('Gece ve az ışıklı yerlerde'),
  p(
    'Gece geç saatte, ışığı az bir yerde inmek zorundaysan şoföre aydınlık ya da kalabalık bir noktayı söyle. Telefonunu elinde sallamadan, çevreni gör ve aracın gittiğinden emin olana kadar kaldırımda bekle. Yanındaki biri varsa birlikte in; yalnızsan bir iki durak sonrasına gidip aydınlık bir yerde inmek çoğu zaman daha iyidir.',
  ),
  h2('Çocukla, bavulla, bebek arabasıyla'),
  p(
    'Dolmuş ve minibüs çoğu zaman bavul ya da bebek arabasıyla binmeye göre düzenlenmemiştir ve tekerlekli sandalye için uygun olmayabilir. Böyle bir durumda sakin saati seç, binmeden önce şoföre aracın uygun olup olmadığını sor ve kapıda acele ettirilme. Hat sayfasındaki durdurma notunda böyle bir bilgi varsa orada yazar.',
  ),
  note(
    'Bu rehberdeki öneriler genel güvenlik alışkanlıklarıdır. Bir hattın kendi kuralları olabilir; şüphede şoförün ya da yolculuk sırasındaki yetkili kişinin söylediğine uy.',
  ),
  h2('Kısaca'),
  p(
    'Bir iki durak önce söyle, kaldırım tarafına in, kavşakta ve dönemeçte inme, kalabalıkta yanındakinden yardım iste. Bunları bilen biri hemen her şehirde dolmuşa güvenle biner. ',
    to('/', 'Bir şehir seçip'),
    ' hat ve durakları inceleyebilir, aklına takılanları ',
    to('/sss', 'sıkça sorulan sorulardan'),
    ' kontrol edebilirsin.',
  ),
];
