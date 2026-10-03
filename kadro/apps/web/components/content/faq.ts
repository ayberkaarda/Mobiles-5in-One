/**
 * Turkish copy of the FAQ page `/sss` (product spec §7 GEO). Every answer describes what the MVP
 * scope of product spec §3 builds and what the ADRs decided; nothing claims users, ratings, a
 * store listing or a price. The page renders the same question and answer text that the
 * `FAQPage` structured data carries (`lib/server/seo/site-structured-data.ts`), so the two cannot
 * drift apart.
 */

export interface FaqEntry {
  /** Anchor of the question on the page. */
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export const FAQ_META = {
  title: 'Sık sorulan sorular',
  description:
    'Kadro hakkında sık sorulanlar: takım ve maç kurma, ücret paylaşımı, Eksik Var ilanları, Saha Rehberi, Kadro Pro, hesap silme ve kişisel veriler.',
} as const;

/** Answer-first paragraph of the FAQ page: 40 to 60 words, names Kadro. */
export const FAQ_INTRO =
  'Kadro, halı saha maçını organize etmeye, eksik oyuncuyu mahalleden bulmaya ve saha ücretini takip etmeye yarayan bir mobil uygulamadır. ' +
  'Bu sayfada en sık sorulan soruları kısa yanıtlarla topladık: takım kurma, maç ve katılım, ücret paylaşımı, Eksik Var ilanları, Saha Rehberi, Kadro Pro, hesap silme ve kişisel veriler.';

export const FAQ_NOTE_TITLE = 'Portfolyo projesi';

/** Visible on the FAQ page: what in the answers is a sample or not decided. */
export const FAQ_NOTE_TEXT =
  'Kadro bir portfolyo projesidir. Uygulama henüz App Store ve Google Play’de yayında değildir. ' +
  'Kadro Pro için bir fiyat belirlenmemiştir; fiyatlar yayına girildiğinde mağazalarda belirlenir. ' +
  'Saha Rehberi’ndeki sahalar örnek kayıtlardır; Gizlilik ve KVKK aydınlatma sayfaları örnek metindir.';

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    id: 'kadro-nedir',
    question: 'Kadro nedir?',
    answer:
      'Kadro, halı saha maçlarını organize etmeye yarayan bir mobil uygulamadır. Takımını kurar, maçı oluşturur, kimin geleceğini görür, eksik oyuncuyu Eksik Var ilanıyla bulur ve saha ücretini oyuncu başına bölersin. Uygulama iOS ve Android için hazırlanmaktadır.',
  },
  {
    id: 'kimler-kullanir',
    question: 'Kadro’yu kimler kullanır?',
    answer:
      'Kadro üç tür kullanıcı için tasarlandı: sahayı ayarlayıp maçı kuran organizatör (kaptan), katılımını bildirip kadroyu takip eden takım oyuncusu ve takımı olmadan ilçesindeki Eksik Var ilanlarına başvuran serbest oyuncu.',
  },
  {
    id: 'takim-kurma',
    question: 'Takım nasıl kurulur, oyuncular nasıl eklenir?',
    answer:
      'Takımını adı, il ve ilçesiyle oluşturur, istersen bir arma eklersin. Oyuncular davet bağlantısı ya da QR koduyla takıma katılır. Takımda üç rol vardır: kaptan, yardımcı kaptan ve oyuncu.',
  },
  {
    id: 'mac-ve-katilim',
    question: 'Maç nasıl oluşturulur, katılım nasıl bildirilir?',
    answer:
      'Maçı saha (Saha Rehberi’nden ya da serbest metinle), tarih ve saat, format (5v5, 6v6, 7v7 veya 8v8), toplam saha ücreti ve oyuncu sayısıyla oluşturursun. Oyuncular geliyorum, gelmiyorum ya da belki diye yanıtlar. Kontenjan dolunca yeni yanıtlar bekleme listesine girer; yer açıldığında sıradaki oyuncu otomatik olarak kadroya alınır.',
  },
  {
    id: 'saha-ucreti',
    question: 'Saha ücreti nasıl bölünür, uygulamadan ödeme yapılır mı?',
    answer:
      'Toplam saha ücreti, katılımı kesinleşen oyunculara eşit bölünür; bölünemeyen kuruşlar katılım sırasına göre ilk oyunculara birer kuruş eklenerek dağıtılır ve payların toplamı ücrete eşit kalır. Kaptan her oyuncu için ödendi ya da ödenmedi işaretler. Uygulama içinde para transferi yapılmaz; ödeme oyuncular arasında uygulama dışında kalır.',
  },
  {
    id: 'eksik-var',
    question: 'Eksik Var nedir, eksik oyuncu nasıl bulunur?',
    answer:
      'Eksik Var, kaptanın yaklaşan maçı için açtığı eksik oyuncu ilanıdır. İlanda eksik oyuncu sayısı, gerekiyorsa aranan mevki, seviye ve ilçe yer alır. Serbest oyuncular açık ilanları görüp başvurur; kaptan başvuruyu kabul edince oyuncu maça katılır. Süresi dolan ya da kapanan ilanlar listede gösterilmez.',
  },
  {
    id: 'saha-rehberi',
    question: 'Saha Rehberi’nde neler var, saha yorumunu kim yazabilir?',
    answer:
      'Saha Rehberi sahaları il ve ilçeye göre listeler: konum, kapalı ya da açık olması, özellikler, fiyat aralığı ve telefon. Oyuncular sahaya 1 ile 5 arasında puan verip kısa yorum yazabilir; bunun için o sahada oynanmış bir maçta katılım kaydı gerekir. Doğrulanmış sahalar rozetle gösterilir; kullanıcıların eklediği sahalar doğrulanana kadar genel listede görünmez.',
  },
  {
    id: 'rezervasyon',
    question: 'Kadro saha rezervasyonu yapar mı?',
    answer:
      'Hayır. Saha rezervasyonunu organizatör uygulama dışında, doğrudan sahayla yapar. Kadro maçın organizasyonuna, katılıma, kadroya ve saha ücretinin takibine yardımcı olur.',
  },
  {
    id: 'bildirimler',
    question: 'Hangi bildirimler gönderilir?',
    answer:
      'Maçtan 24 saat ve 2 saat önce hatırlatma gelir. Katılım değişiklikleri takım sorumlularına, Eksik Var başvuruları ilanı açan kaptana bildirilir. Maç oynandıktan sonra 24 saat boyunca maçın oyuncusu (MVP) oylaması açık kalır.',
  },
  {
    id: 'kadro-pro',
    question: 'Kadro ücretsiz mi, Kadro Pro neler ekler?',
    answer:
      'Kadro ücretsiz kullanılır; ücretsiz sürümde sahibi olduğun bir takım kurabilirsin. Kadro Pro aylık ya da yıllık abonelikle sınırsız takım, kadro geçmişi ve gelişmiş istatistikler ekler ve Pro tanıtım bantlarını kaldırır. Abonelik uygulama mağazası üzerinden alınır; bu portfolyo sürümünde bir fiyat belirlenmemiştir.',
  },
  {
    id: 'hesap-silme',
    question: 'Hesabımı nasıl silerim?',
    answer:
      'Hesabını uygulama içinden ya da web sitesindeki Hesabımı sil sayfasından silebilirsin; işlem için kimliğini yeniden doğrularsın. Hesap hemen kapanır ve oturumların sonlandırılır. 7 gün içinde yeniden giriş yaparsan silme iptal olur; süre dolunca kişisel verilerin silinir ve geçmiş maç kayıtlarında adının yerinde silinmiş oyuncu yazar.',
  },
  {
    id: 'kisisel-veriler',
    question: 'Kişisel verilerim nasıl işlenir?',
    answer:
      'Hesap için e-posta ve görünen ad, profil için mevki, seviye ve ilçe, organizasyon için takım ve maç kayıtları işlenir. Uygulama içinde kart ya da banka bilgisi alınmaz. Ayrıntılar Gizlilik ve KVKK aydınlatma sayfalarındadır; bu sayfalar portfolyo projesi için hazırlanmış örnek metinlerdir ve gerçek bir veri sorumlusu belirlenmemiştir.',
  },
];
