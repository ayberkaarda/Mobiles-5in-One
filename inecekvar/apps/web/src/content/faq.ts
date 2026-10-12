import { FACTS } from './facts';

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

/**
 * The single source of the /sss page. The page text and the FAQPage JSON-LD are both built from
 * this list, so they cannot differ.
 */
export const FAQ: readonly FaqItem[] = [
  {
    question: 'İnecek Var nedir?',
    answer: `${FACTS.description} ${FACTS.tagline}`,
  },
  {
    question: 'İnecek Var resmî bir kurum mu, bilgiler resmî mi?',
    answer:
      'Hayır. İnecek Var resmî bir kurum değildir ve resmî tarife yayımlamaz. Hat bilgisi mahalleli katkıcılardan gelir, moderatörlerin onayından geçer ve her bilginin yanında tarihi görünür.',
  },
  {
    question: 'Hat bilgileri nereden geliyor ve nasıl doğrulanıyor?',
    answer:
      'Katkıcılar hat, durak, ücret ve saat önerir; bir moderatör öneriyi onaylayınca hat yeni bir sürüm olur. Kimse kendi önerisini onaylayamaz, eski sürümler silinmez ve sayfada son doğrulama tarihi, katkıcı sayısı ve sürüm görünür.',
  },
  {
    question: 'Ücretler güncel mi?',
    answer:
      'Ücret ve güzergâh hat sayfasında tarihiyle yazılır. Tarih eskiyse ücret değişmiş olabilir; bu durumda binerken şoföre sor ve biliyorsan sayfadaki düzeltme bağlantısıyla güncelini yaz.',
  },
  {
    question: 'Hangi şehirler var?',
    answer: `Hedef şehirler ${FACTS.targetCities.join(', ')}. Bir şehrin kapsamı, o şehrin sayfasında yazan yayımlanmış hat sayısı kadardır; sayı sıfırsa o şehirde henüz yayımlanmış hat yoktur.`,
  },
  {
    question: 'Ücretsiz mi, reklam var mı?',
    answer:
      'Hat arama, hat ve durak sayfaları ve bir şehir paketi ücretsizdir. Birden fazla şehir paketi için Plus adıyla ücretli bir plan hazırlanıyor ve henüz satışa açık değil. Uygulamada reklam yoktur.',
  },
  {
    question: 'İnternet olmadan çalışır mı?',
    answer:
      'Şehir paketini indirdiysen hat arama, hat ve durak sayfaları ve yakındaki duraklar internetsiz çalışır. Bir noktadan öbürüne yol planlama ise sunucu gerektirdiği için internet ister.',
  },
  {
    question: 'Konumumu kullanıyor mu?',
    answer:
      'Konum yalnızca uygulama açıkken, yakındaki durakları göstermek ve istersen yolculuk kaydı almak için kullanılır. Şehir paketi kuruluysa yakındaki duraklar cihazda hesaplanır; paket yoksa konum yalnızca o sorgu için sunucuya gider ve günlüğe yazılmaz. Konum arka planda izlenmez.',
  },
  {
    question: 'Hat okumak için hesap açmam gerekir mi?',
    answer:
      'Hayır. Hat arama, hat ve durak sayfaları ve şehir paketi hesapsız kullanılır. Hesap yalnızca katkı göndermek, favorileri cihazlar arasında eşitlemek ve Plus için gerekir.',
  },
  {
    question: 'Nasıl katkı veririm?',
    answer:
      'Hat sayfasındaki "Bu hattı düzelt" bağlantısıyla uygulamada bir düzeltme önerebilir, yeni hat ya da durak ekleyebilir, ücret güncelleyebilir ve istersen yolculuğunu kayda alabilirsin. İlk katkıdan önce katkı lisansını kabul edersin.',
  },
  {
    question: 'Sürüş kaydım herkese açık mı?',
    answer: `Hayır. Ham iz kaydı özeldir; yalnızca sen ve moderatörler görebilir. Hat izine kayıttan türetilen geometri girer ve bunda ilk ile son ${FACTS.trace.trimMetres} metre kesilir. Ham kayıt, türetilen sürüm yayımlandıktan ${FACTS.trace.retentionDays} gün sonra silinir.`,
  },
  {
    question: 'Hesabımı nasıl silerim?',
    answer: `Uygulamada Ayarlar bölümündeki Hesap sayfasından, şifreni ya da yakın zamanlı bir girişi doğrulayarak silebilirsin. Hesap hemen devre dışı kalır, ${FACTS.deletion.graceDays} günlük bekleme süresinde giriş yaparsan silme iptal olur, süre dolunca kişisel kayıtların silinir.`,
  },
  {
    question: 'Veriyi kendi projemde kullanabilir miyim?',
    answer: `Şehir başına haftalık ${FACTS.export.format} dışa aktarımı yayımlanır. Lisans olarak ${FACTS.licence.proposed} önerilmiştir; hukuki onay beklendiği için henüz verilmiş bir lisans yoktur. Onay çıkana kadar kullanım koşulları belli değildir.`,
  },
  {
    question: 'Bir hat bilgisi yanlışsa ne yapmalıyım?',
    answer:
      'Hat sayfasındaki "Bu hattı düzelt" bağlantısından uygulamada düzeltme öner. Önerin moderatör kuyruğuna düşer, onaylanırsa hat yeni bir sürüm olarak yayımlanır ve sayfadaki tarih güncellenir.',
  },
  {
    question: 'Kişisel verilerim ve izleme konusunda ne yapılıyor?',
    answer:
      'Reklam yok, üçüncü taraf reklam ya da izleme aracı kullanılmıyor ve herkese açık sayfalarda çerez konmuyor; yalnızca moderatörlerin kullandığı yönetim paneli giriş için oturum ve CSRF çerezleri koyar.Neyin toplandığı Gizlilik sayfasında, KVKK aydınlatma metni ise taslak olarak yayımlanır ve hukuki inceleme bekler.',
  },
];
