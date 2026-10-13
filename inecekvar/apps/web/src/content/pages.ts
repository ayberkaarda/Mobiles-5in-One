import { Block, h2, note, ol, p, to, ul } from './blocks';
import { FACTS } from './facts';
import { FAQ } from './faq';
import { GUIDES } from './guides';

export type PageKind = 'index' | 'faq' | 'data' | 'about' | 'info' | 'legal';

export interface StaticPage {
  readonly path: string;
  readonly kind: PageKind;
  readonly h1: string;
  readonly title: string;
  readonly description: string;
  /** A status line shown above the text (drafts and pending decisions). */
  readonly status?: string;
  readonly blocks: readonly Block[];
  /** Defaults to true; a draft or a thin page stays out of the index and the sitemap. */
  readonly index?: boolean;
  /** The page lists the export endpoint built from the public API base. */
  readonly showExport?: boolean;
  readonly dateModified: string;
}

const paths = FACTS.topLevelPaths;
const date = FACTS.contentDate;

const guidesIndex: StaticPage = {
  path: paths.guides,
  kind: 'index',
  h1: 'Rehberler',
  title: 'Dolmuş ve minibüs rehberleri',
  description:
    'Dolmuş ve minibüs hattı nasıl okunur, durak yoksa nereden inilir, şehir paketi nasıl kullanılır: İnecek Var rehberleri.',
  blocks: [
    p(
      'Burada hat sayfalarını okumayı, güvenle binmeyi ve inmeyi, çevrimdışı şehir paketini ve bilginin nasıl doğrulandığını anlatan kısa rehberler var. Her biri dürüst bir kural koyar: ücret ve güzergâh için hat sayfasındaki tarihe bak.',
    ),
  ],
  dateModified: date,
};

const faqPage: StaticPage = {
  path: paths.faq,
  kind: 'faq',
  h1: 'Sıkça sorulan sorular',
  title: 'Sıkça sorulan sorular',
  description: `${FACTS.name} hakkında ${FAQ.length} soru ve yanıtı: veri nereden geliyor, konum, çevrimdışı kullanım, katkı, hesap silme ve açık veri.`,
  blocks: [],
  dateModified: date,
};

const dataPage: StaticPage = {
  path: paths.data,
  kind: 'data',
  h1: 'Açık veri',
  title: 'Açık veri: haftalık GeoJSON dışa aktarımı',
  description: `${FACTS.name} hat ve durak verisi şehir başına haftalık GeoJSON olarak yayımlanır. Yöntem, alanlar ve lisans durumu burada.`,
  status: FACTS.licence.statusLine,
  showExport: true,
  blocks: [
    p(
      `${FACTS.name} yayımlanmış hat ve durak verisini şehir başına ${FACTS.export.cadence} bir ${FACTS.export.format} dosyası olarak açar. Dosyada yalnızca yayımlanmış hatlar ve etkin duraklar vardır; sürüş kayıtları, katkıcı adları ve e-posta adresleri hiçbir dışa aktarımda yer almaz.`,
    ),
    h2('Ne dışa aktarılıyor'),
    ul(
      'Her yayımlanmış hat için bir LineString: hat izi, ad, kod ve araç türü.',
      'Her etkin durak için bir Point: durak adı ve konum.',
      'Ücret, saat ve ödeme bilgisi ile durdurma notları hat kaydında yer alır.',
      `Dosya düzeyinde şu alanlar bulunur: lisans durumu, atıf metni ("${FACTS.export.attribution}"), şehir, dışa aktarım zamanı ve sürüm numarası.`,
    ),
    h2('Yöntem'),
    p(
      'Veri üç adımdan geçer. Katkıcılar hat, durak, ücret ve saat önerir; bir moderatör öneriyi onaylayınca hat değiştirilemez yeni bir sürüm olur; haftalık işlem de o anki yayımlanmış sürümleri bir dosyaya yazar. Dosyanın sürüm numarası her dışa aktarımda bir artar.',
    ),
    p(
      'Hat izleri sürüş kayıtlarından türetilir ve kayıtların ilk ile son 200 metresi kesilir; ham kayıtlar dışa aktarıma girmez. Hat izleri bir harita altlığındaki yollara oturtularak üretilmez: katkı verisi ile harita altlığı ayrı tutulur. Süreci ',
      to('/rehber/hat-bilgisi-nasil-dogrulanir', 'hat bilgisi nasıl doğrulanır rehberinde'),
      ' anlattık.',
    ),
    h2('Güncelleme sıklığı ve tazelik'),
    p(
      `Dışa aktarım ${FACTS.export.cadence} çalışır. Bir hattın kendi sayfasındaki tarihler daha günceldir: ücretin güncelleme tarihi ve son doğrulama tarihi hat sayfasında yazılır. Bir şehir için henüz dışa aktarım üretilmediyse adres bulunamadı yanıtı verir.`,
    ),
    h2('Lisans'),
    p(
      `Önerilen lisans ${FACTS.licence.proposed}'tür ve hukuki onay beklenmektedir; henüz verilmiş bir lisans yoktur. Dışa aktarım dosyası da aynı durumu bildirir. Ayrıntılar ve katkıcılar için sonuçları `,
      to(paths.licence, 'veri lisansı sayfasında'),
      '.',
    ),
    h2('Sınırlar'),
    ul(
      'Veri resmî değildir; mahalleli katkıcılardan gelir ve moderatörler onaylar.',
      'Bir şehirde yayımlanmış hat yoksa dosyada hat bulunmaz. Kapsam, şehir sayfasındaki hat sayısıdır.',
      'Bir şehirde hat ve durak toplamı 50 000 öğeyi aşarsa dışa aktarım oluşturulmaz; bu sınır dosyayı makul boyutta tutar.',
    ),
  ],
  dateModified: date,
};

const licencePage: StaticPage = {
  path: paths.licence,
  kind: 'legal',
  h1: 'Veri lisansı',
  title: 'Veri lisansı: önerilen CC BY 4.0, onay bekliyor',
  description: `${FACTS.name} açık verisi için ${FACTS.licence.proposed} önerilmiştir; hukuki onay bekleniyor, henüz verilmiş bir lisans yok.`,
  status: FACTS.licence.statusLine,
  blocks: [
    p(
      `Kısa durum: ${FACTS.name} açık verisi için ${FACTS.licence.proposed} lisansı önerilmiştir. Bu öneri henüz hukuki olarak onaylanmamıştır. Onay çıkana kadar bu sayfa ve dışa aktarım dosyası herhangi bir lisans vermiş gibi davranmaz.`,
    ),
    h2('Önerilen lisans ne anlatıyor'),
    p(
      `${FACTS.licence.proposed}, veriyi kullanmaya, paylaşmaya ve uyarlamaya, ticari amaç dahil, izin verir; karşılığında atıf ister. Önerilen atıf metni "${FACTS.export.attribution}" biçimindedir. Lisans verildiğinde bu sayfa ve dışa aktarım dosyasındaki lisans alanı birlikte güncellenir.`,
    ),
    h2('Henüz ne yok'),
    ul(
      'Hukuki onay: önerinin kabul edildiğine dair bir karar yoktur.',
      'Verilmiş bir lisans: bu nedenle dışa aktarımı kullanmak için hangi koşulların geçerli olduğu şu an belli değildir.',
      'Makine tarafından okunabilir bir lisans beyanı: onaydan önce yayımlanmaz.',
    ),
    h2('Harita altlığı ayrıdır'),
    p(
      'Harita altlığındaki çizimler OpenStreetMap katkıcılarına aittir ve ODbL koşullarına tabidir; bu koşullar proje verisinin lisansından ayrıdır. Katkıcıların hat izleri harita altlığındaki yollara oturtularak üretilmez; böylece iki veri kümesi karışmaz.',
    ),
    h2('Katkıcılar için anlamı'),
    ul(
      'İlk katkıdan önce katkı lisansı sana gösterilir ve kabul etmen istenir. Metin hukuki onay beklediğini söyler.',
      'Onaylanmış katkıların, hesabın silinse bile, adın kaldırılmış halde lisans kapsamında kalır; sayfalarda "silinmiş katkıcı" olarak görünür.',
      'Ham sürüş kayıtların hiçbir lisansa konu olmaz; özel kalır ve süre dolunca silinir.',
    ),
    note(
      'Bu sayfa hukuki bir metin değildir; mevcut durumu özetler. Hukuki onay tamamlandığında bu sayfa güncellenir.',
    ),
    p('Dışa aktarımın içeriği için ', to(paths.data, 'açık veri sayfasına'), ' bak.'),
  ],
  dateModified: date,
};

const aboutPage: StaticPage = {
  path: paths.about,
  kind: 'about',
  h1: `${FACTS.name} hakkında`,
  title: `${FACTS.name} hakkında`,
  description: `${FACTS.name}: ${FACTS.description}`,
  blocks: [
    p(`${FACTS.description} ${FACTS.tagline}`),
    h2('Adı nereden geliyor'),
    p(
      '"İnecek var" yolcunun dolmuşu durdurmak için söylediği cümledir. Bir hattı haritalarken de aynı fikri izleriz: durak, tabelada yazan yer değil, insanların gerçekten indiği yerdir.',
    ),
    h2('Ne yapar'),
    ul(
      'Hat arama: kod, ad ya da serbest metinle.',
      'Hat sayfası: hat izi, sıralı duraklar, tarihli ücret, saatler, ödeme yöntemi, durdurma notu ve son doğrulama.',
      'Çevrimdışı şehir paketi: internet olmadan hat ve durak bilgisi.',
      'Katkı: düzeltme önerisi, yolculuk kaydı, fotoğraf; hepsi moderatör onayından geçer.',
      'Açık veri: şehir başına haftalık dışa aktarım.',
    ),
    h2('Ne yapmaz'),
    ul(
      'Araçların canlı konumunu göstermez.',
      'Bilet satmaz, araç çağırmaz.',
      'Resmî veri iddiasında bulunmaz.',
      'Reklam göstermez.',
    ),
    h2('Veri nasıl doğrulanır'),
    p(
      'Her değişiklik bir moderatör onayından geçer, her onay yeni bir sürüm üretir ve sayfalarda son doğrulama tarihi görünür. Süreç ',
      to('/rehber/hat-bilgisi-nasil-dogrulanir', 'rehberde'),
      ' ayrıntılı anlatılıyor.',
    ),
    h2('Kapsam'),
    p(
      `Hedef şehirler ${FACTS.targetCities.join(', ')}. Bir şehrin gerçek kapsamı, o şehrin sayfasındaki yayımlanmış hat sayısıdır; bu sayfa bir kapsam garantisi vermez.`,
    ),
    h2('Kim yapıyor'),
    p(
      `Proje ${FACTS.legalName} tarafından yürütülür. Hat bilgisinin kendisi katkıcılardan gelir. İletişim kanalı için `,
      to(paths.contact, 'iletişim sayfasına'),
      ' bak.',
    ),
    h2('Platformlar'),
    p(
      `${FACTS.name} bir web uygulaması olarak ${FACTS.appDomain} adresinde çalışır; Android uygulamasının uygulama kimliği ${FACTS.applicationId}'dir. Bu herkese açık site hat sayfalarını ve rehberleri sunar.`,
    ),
  ],
  dateModified: date,
};

const privacyPage: StaticPage = {
  path: paths.privacy,
  kind: 'legal',
  h1: 'Gizlilik',
  title: 'Gizlilik: neyi topluyoruz, neyi toplamıyoruz',
  description: `${FACTS.name} konum, iz kaydı, hesap ve günlük verilerini nasıl ele alıyor: konum uygulama içinde, iz kaydı özel, hesap silinebilir.`,
  blocks: [
    p(
      'Kısaca: konum yalnızca uygulama açıkken kullanılır, sürüş kaydı senin içeriğindir ve özeldir, hesabını silebilirsin; reklam ve üçüncü taraf izleme yoktur. Aşağıda her şeyi tek tek yazıyoruz.',
    ),
    h2('Herkese açık site'),
    p(
      `${FACTS.domain} üzerindeki herkese açık sayfalar (şehir, hat, durak, rehber ve bilgi sayfaları) çerez bırakmaz, tarayıcı depolamasına bir şey yazmaz ve bir analiz ya da reklam aracı yüklemez. Sayfaları açtığında sunucu, her web sunucusu gibi, isteğin adresini ve zamanını işler.`,
    ),
    p(
      'İki istisna var: yalnızca moderatör ve yöneticilerin kullandığı yönetim paneli (/admin) ve hesap silme sayfasındaki silme paneli. İkisi de giriş yapıldığında oturum ve CSRF çerezleri koyar ve yarım kalan bir çıkışı tamamlayabilmek için tarayıcı depolamasına bir çıkış işareti yazar. Bu çerezler yalnızca girişi ve güvenliği sağlar; izleme ya da reklam için kullanılmaz.',
    ),
    h2('Konum'),
    ul(
      'Konum yalnızca uygulama açıkken ve izin verdiğinde kullanılır; arka planda izlenmez.',
      'Şehir paketi kuruluysa yakındaki duraklar cihazda hesaplanır. Paket yoksa konum yalnızca o sorgu için sunucuya gider ve günlüğe yazılmaz.',
      'Yolculuk kaydı yalnızca sen başlattığında alınır.',
      'Sunucu günlüklerinde koordinatlar yuvarlanır ve kayıtlar ham konum taşımaz.',
    ),
    h2('Yolculuk kaydı senin içeriğindir'),
    p(
      `Kayıt, hattı haritalamak için gönderdiğin bir içeriktir. Ham kayıt özeldir: yalnızca sen ve moderatörler görür, herkese açık hiçbir yanıtta ya da dışa aktarımda yer almaz. Kayıttan türetilen hat izinde ilk ve son ${FACTS.trace.trimMetres} metre kesilir. Ham kayıt, türetilen sürüm yayımlandıktan ${FACTS.trace.retentionDays} gün sonra silinir; hiçbir öneriye bağlanmadıysa yüklemeden ${FACTS.trace.retentionDays} gün sonra silinir. Hesabını silersen kayıtların hemen silinir.`,
    ),
    h2('Hesap verisi'),
    ul(
      'E-posta adresi: giriş ve bildirim için. Parola yalnızca geri döndürülemeyen bir özet olarak saklanır.',
      'Favoriler: misafirken yalnızca cihazda, giriş yaptığında hesabınla eşitlenir.',
      'Fotoğraflar: yalnızca eklediğin ücret tablosu ya da durak levhası; yeniden kodlanır ve üst bilgileri silinir.',
      'Onaylanmış katkılar: hesabını silsen bile adın kaldırılarak kalır.',
    ),
    h2('Sunucu kayıtları'),
    p(
      'Günlüklerde parola, anahtar ve oturum bilgisi tutulmaz, e-posta adresleri özetlenir, koordinatlar yuvarlanır. Şehir paketi indirmeleri için sınır uygulamak amacıyla ağ adresinin geri döndürülemeyen bir özeti kullanılır; ham adres saklanmaz.',
    ),
    h2('Reklam ve izleme'),
    p(
      'Uygulamada reklam yoktur. Üçüncü taraf reklam ya da izleme aracı kullanılmaz. Hata izleme gibi bir hizmet eklenirse bu sayfa önce güncellenir.',
    ),
    h2('Haklarını nasıl kullanırsın'),
    p(
      'Hesabını uygulamadan silebilirsin; adımlar ',
      to(paths.deletion, 'hesap silme sayfasında'),
      '. KVKK kapsamındaki haklar ve başvuru için ',
      to(paths.kvkk, 'KVKK aydınlatma taslağına'),
      ' bak.',
    ),
    note(
      'Bu sayfa uygulamanın bugünkü davranışını anlatır. Bir davranış değiştiğinde önce bu sayfa güncellenir.',
    ),
  ],
  dateModified: date,
};

const kvkkPage: StaticPage = {
  path: paths.kvkk,
  kind: 'legal',
  h1: 'KVKK aydınlatma metni (taslak)',
  title: 'KVKK aydınlatma metni (taslak)',
  index: false,
  description: `${FACTS.name} KVKK aydınlatma metni taslağıdır; hukuki inceleme bekliyor ve bağlayıcı bir metin değildir.`,
  status:
    'Taslak: bu metin hukuki incelemeden geçmemiştir ve henüz bağlayıcı bir aydınlatma metni değildir.',
  blocks: [
    p(
      'Bu sayfa, 6698 sayılı Kişisel Verilerin Korunması Kanunu’nun aydınlatma yükümlülüğüne göre hazırlanacak metnin taslağıdır. Hukuki incelemeden geçmemiştir; tamamlanıp onaylandığında bu başlık ve üstteki uyarı kaldırılır.',
    ),
    h2('Veri sorumlusu'),
    p(
      `Veri sorumlusu ${FACTS.legalName}’dir. Adres, ticaret sicil ve MERSİS bilgileri hukuki inceleme sırasında eklenecektir; bu taslakta yer almaz.`,
    ),
    h2('İşlenen kişisel veriler'),
    ul(
      'Hesap verisi: e-posta adresi ve parola özeti.',
      'Konum verisi: yalnızca senin başlattığın yolculuk kayıtları.',
      'Katkı içeriği: öneriler, fotoğraflar.',
      'İşlem verisi: sunucu günlükleri, yuvarlanmış koordinatlar, ağ adresinin özeti.',
    ),
    h2('İşleme amaçları'),
    ul(
      'Hat bilgisinin üretilmesi, doğrulanması ve yayımlanması.',
      'Hesap, giriş ve katkı süreçlerinin yürütülmesi.',
      'Güvenlik, kötüye kullanımın önlenmesi ve hız sınırları.',
    ),
    h2('Hukuki sebepler'),
    p(
      'Hukuki sebeplerin kesin listesi hukuki inceleme sırasında belirlenecektir. Taslakta düşünülenler: sözleşmenin ifası (hesap), meşru menfaat (güvenlik) ve açık rıza (konum kaydı ve katkı lisansı).',
    ),
    h2('Aktarım'),
    p(
      'Veri barındırma, depolama ve e-posta gönderimi sağlayıcılarına işleme amacıyla aktarılabilir. Sağlayıcıların adları ve veri bulundukları ülkeler hukuki inceleme sonrasında bu metne yazılacaktır.',
    ),
    h2('Saklama'),
    ul(
      `Ham sürüş kaydı: türetilen sürüm yayımlandıktan ${FACTS.trace.retentionDays} gün sonra silinir.`,
      `Hesap: silme isteğinde ${FACTS.deletion.graceDays} günlük bekleme sonrası kişisel kayıtlar silinir.`,
      'Onaylanmış katkılar: yazar adı kaldırılarak yayında kalır.',
    ),
    h2('Haklar ve başvuru'),
    p(
      `KVKK’nın 11. maddesi kapsamındaki haklarını (bilgi isteme, düzeltme, silme, itiraz) kullanabilirsin. Hesabını uygulamadan silmenin yolu `,
      to(paths.deletion, 'hesap silme sayfasında'),
      '. ',
      FACTS.contact.statusLine,
      ' Başvuru kanalı kurulduğunda buraya yazılacaktır.',
    ),
    p('Bugünkü davranışın düz anlatımı için ', to(paths.privacy, 'gizlilik sayfasına'), ' bak.'),
  ],
  dateModified: date,
};

const deletionPage: StaticPage = {
  path: paths.deletion,
  kind: 'info',
  h1: 'Hesap silme',
  title: 'Hesabını nasıl silersin',
  description: `${FACTS.name} hesabını bu sayfadan ya da uygulamadan silebilirsin: ne hemen silinir, ${FACTS.deletion.graceDays} günlük bekleme nedir, ne kalır.`,
  status:
    'Hesabını bu sayfanın altındaki web silme panelinden ya da uygulamadan silebilirsin. Panel tarayıcıda açılır ve JavaScript gerektirir.',
  blocks: [
    p(
      `Hesabını bu sayfadaki panelden e-posta adresin ve şifrenle ya da uygulamadan (Ayarlar, Hesap, hesabı sil) silebilirsin. Silme isteğinden sonra hesabın hemen devre dışı kalır, ${FACTS.deletion.graceDays} gün bekleme süresi başlar ve süre dolunca kişisel kayıtların silinir.`,
    ),
    h2('Adımlar'),
    ol(
      'Aşağıdaki panelde e-posta adresin ve şifrenle giriş yap. E-posta bağlantısıyla giriş panelde sunulmaz; hesabında şifre yoksa uygulamayı kullan.',
      'Ne silineceğini ve ne kalacağını oku.',
      'Güvenlik için şifreni yeniden gir, onay kutusunu işaretle ve hesabı silmeyi seç.',
      'Sunucu isteği kabul edince bu tarayıcıdaki oturum ve form bilgileri temizlenir.',
    ),
    p(
      `Uygulamada da aynı adımlar var: uygulamayı ya da ${FACTS.appDomain} üzerindeki web uygulamasını aç, Ayarlar bölümünde Hesap sayfasına git ve hesabı silmeyi seç. İnternet yoksa silme isteği gönderilmez ve hiçbir şey silinmez; önce sunucunun isteği kabul etmesi beklenir.`,
    ),
    h2('Hemen silinenler'),
    ul(
      'Oturumların ve erişim anahtarların iptal edilir.',
      'Favorilerin silinir.',
      'Özel sürüş kayıtların silinir.',
      'Bekleyen önerilerin geri çekilir.',
    ),
    h2(`${FACTS.deletion.graceDays} günlük bekleme`),
    p(
      `Bekleme süresi içinde yeniden giriş yaparsan silme iptal edilir ve hesabın yeniden etkinleşir. Bu yüzden silme istedikten sonra bu sayfada ya da uygulamada yeniden giriş yapma. Silinmiş favoriler ve kayıtlar geri gelmez. Süre dolunca e-posta adresin, kişisel kayıtların ve yüklediğin fotoğraflar silinir ve bir onay e-postası gelir.`,
    ),
    h2('Ne kalır'),
    ul(
      'Onaylanıp yayımlanmış hat katkıların lisans kapsamında kalır; yazar adı kaldırılır ve sayfalarda "silinmiş katkıcı" olarak görünür.',
      'Silme işleminin denetim kaydı kişisel veri içermez.',
    ),
    p(
      'Aktif bir Plus aboneliği olan hesaplarda, abonelik kaydı sağlayıcıdan silinene kadar silme ertelenir; hesabın bu sırada silinmiş sayılmaz.',
    ),
    h2('Çerezler ve yardım'),
    p(
      `Panelde giriş yaptığında oturum ve CSRF çerezleri konur; silme isteği kabul edilince ya da çıkış yapınca kaldırılır. Giriş yapamıyorsan veya yardım gerekiyorsa: ${FACTS.contact.statusLine}`,
    ),
    p(
      'Genel gizlilik bilgisi için ',
      to(paths.privacy, 'gizlilik sayfasına'),
      ', taslak aydınlatma metni için ',
      to(paths.kvkk, 'KVKK sayfasına'),
      ' bak.',
    ),
  ],
  dateModified: date,
};

const contactPage: StaticPage = {
  path: paths.contact,
  kind: 'info',
  h1: 'İletişim',
  index: false,
  title: 'İletişim',
  description: `${FACTS.name} iletişim kanalı kurulum aşamasında. Bu sayfada henüz yayımlanmış bir iletişim adresi yok; şu an yapabileceklerin burada.`,
  status: FACTS.contact.statusLine,
  blocks: [
    p(
      'İletişim kanalı kurulum aşamasındadır. Bu sayfada bir e-posta adresi ya da telefon numarası yayımlamıyoruz, çünkü henüz gerçek bir kanal açılmadı. Açıldığında buraya yazılacaktır.',
    ),
    h2('Bu arada ne yapabilirsin'),
    ul(
      'Bir hat bilgisi yanlışsa hat sayfasındaki "Bu hattı düzelt" bağlantısıyla uygulamadan düzeltme öner.',
      ['Sık sorulan sorulara ', to(paths.faq, 'SSS sayfasından'), ' bak.'],
      ['Hesabını silmek için ', to(paths.deletion, 'hesap silme sayfasındaki'), ' adımları izle.'],
      ['Veri ve lisans durumu için ', to(paths.licence, 'veri lisansı sayfasına'), ' bak.'],
    ),
    note(
      'Kişisel verilerle ilgili başvurular için de kanal kurulum aşamasındadır; kanal açılınca KVKK sayfasına yazılacaktır.',
    ),
  ],
  dateModified: date,
};

export const STATIC_PAGES: readonly StaticPage[] = [
  guidesIndex,
  faqPage,
  dataPage,
  licencePage,
  aboutPage,
  privacyPage,
  kvkkPage,
  deletionPage,
  contactPage,
];

export function guideLinks(): readonly { path: string; text: string }[] {
  return GUIDES.map((guide) => ({ path: guide.path, text: guide.h1 }));
}

/** Pages that are not written yet and are reported as open work. */
export const OPEN_PAGES: readonly { path: string; reason: string }[] = [
  {
    path: '/kullanim-kosullari',
    reason: 'Depoda bir kullanım koşulları taslağı yok; metin hukuki işle birlikte yazılacak.',
  },
];
