/**
 * Turkish product copy of the marketing pages (product spec §2 tone: short, friendly "sen").
 * Every statement describes the MVP scope of spec §3; nothing here claims users, prices, ratings
 * or availability that do not exist. Each page opens with a 40 to 60 word answer-first paragraph
 * that defines Kadro (spec §7, GEO), checked in `tests/marketing/marketing.test.ts`.
 */

export interface TextItem {
  readonly title: string;
  readonly text: string;
}

export interface FeatureSection {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly points: readonly string[];
}

export const HOME_META = {
  description:
    'Kadro ile halı saha maçını organize et, eksik oyuncuyu mahallenden bul, saha ücretini oyuncu başına böl ve kimin ödediğini takip et.',
} as const;

export const HOME_INTRO =
  'Kadro, halı saha maçı organize eden takımlar için bir mobil uygulamadır. Takımını kurarsın, maçı oluşturursun ve kimin geleceğini tek ekranda görürsün. Eksik oyuncu olduğunda mahallendeki serbest oyunculara Eksik Var ilanı açarsın. Saha ücretini oyuncu başına böler, kimin ödediğini işaretlersin; uygulama içinde para transferi yapılmaz.';

export const HOME_STEPS: readonly TextItem[] = [
  {
    title: 'Kadroyu kur',
    text: 'Takımını oluştur, il ve ilçeni seç. Oyuncularını davet bağlantısı ya da QR koduyla ekle.',
  },
  {
    title: 'Maçı ayarla',
    text: 'Sahayı, saati ve formatı (5v5, 6v6, 7v7 ya da 8v8) gir. Oyuncular geliyorum, gelmiyorum ya da belki der; kontenjan dolunca bekleme listesi sırayla ilerler.',
  },
  {
    title: 'Eksiği bul',
    text: 'Biri son anda çekilirse Eksik Var ilanı aç. Mahallendeki serbest oyuncular başvurur, sen kabul edince maça katılırlar.',
  },
];

export const HOME_HIGHLIGHTS: readonly TextItem[] = [
  {
    title: 'Dengeli takımlar',
    text: 'Oyuncuları iki tarafa dağıt; kaleci, defans, orta saha ve forvet bilgisine göre dengeleme önerisi al.',
  },
  {
    title: 'Saha ücreti paylaşımı',
    text: 'Toplam ücret gelen oyunculara bölünür. Kimin ödediğini sen işaretlersin; para uygulama içinde el değiştirmez.',
  },
  {
    title: 'Saha Rehberi',
    text: 'İl ve ilçeye göre sahaları, kapalı ya da açık olduğunu, özelliklerini, fiyat aralığını ve oyuncu yorumlarını gör.',
  },
  {
    title: 'Hatırlatmalar',
    text: 'Maçtan 24 saat ve 2 saat önce bildirim gelir. Katılım değişiklikleri ve ilan başvuruları kaptana iletilir.',
  },
  {
    title: 'Maçın oyuncusu',
    text: 'Maçtan sonra 24 saat içinde MVP oylaması yapılır; oynadığın maçlar ve MVP sayın profilinde görünür.',
  },
];

export const HOME_AUDIENCES: readonly TextItem[] = [
  {
    title: 'Organizatör',
    text: 'Sahayı ayarlayan, maçı kuran ve kimin ödediğini takip eden kaptan.',
  },
  {
    title: 'Oyuncu',
    text: 'Katılımını bildiren, kadroyu gören, payını ödeyen ve MVP oyu veren takım oyuncusu.',
  },
  {
    title: 'Serbest oyuncu',
    text: 'Takımı olmayan, ilçesindeki Eksik Var ilanlarına başvurup maça katılan oyuncu.',
  },
];

export const DOWNLOAD_TEXT =
  'Kadro iOS ve Android için hazırlanıyor. Mağaza sayfaları yayına girdiğinde bağlantılar burada yer alacak.';

export const FEATURES_META = {
  title: 'Özellikler',
  description:
    'Takım kurma, maç ve katılım, kadro dengeleme, saha ücreti paylaşımı, Eksik Var ilanları, Saha Rehberi, hatırlatmalar ve Kadro Pro.',
} as const;

export const FEATURES_INTRO =
  'Kadro, halı saha maçının hazırlığını tek uygulamada toplar: takımı kurarsın, maçı oluşturursun, katılımı ve kadroyu yönetirsin. Eksik oyuncuyu Eksik Var ilanıyla mahallenden bulursun, sahayı Saha Rehberi’nde seçersin, saha ücretini oyuncu başına bölüp ödemeleri işaretlersin. Bu sayfada her özelliğin ne yaptığını bulabilirsin.';

export const FEATURE_SECTIONS: readonly FeatureSection[] = [
  {
    id: 'takim',
    title: 'Takım ve roller',
    text: 'Takımını adı, il ve ilçesi ve armasıyla oluştur. Oyuncular davet bağlantısı ya da QR koduyla katılır.',
    points: ['Üç rol: kaptan, yardımcı kaptan ve oyuncu.'],
  },
  {
    id: 'mac',
    title: 'Maç ve katılım',
    text: 'Maçı saha, tarih ve saat, format, toplam saha ücreti ve oyuncu sayısıyla oluştur.',
    points: [
      'Oyuncular geliyorum, gelmiyorum ya da belki diye yanıtlar.',
      'Kontenjan dolunca bekleme listesi başlar; yer açılınca sıradaki oyuncu otomatik olarak kadroya girer.',
    ],
  },
  {
    id: 'kadro',
    title: 'Kadro ve dengeleme',
    text: 'Kaptan oyuncuları iki tarafa yerleştirir. Mevkiler (kaleci, defans, orta saha, forvet) üzerinden otomatik dengeleme önerisi alınabilir.',
    points: ['Her oyuncu kendi mevkisini profilinde belirtir.'],
  },
  {
    id: 'ucret',
    title: 'Saha ücreti',
    text: 'Toplam saha ücreti, katılımı kesinleşen oyunculara eşit bölünür. Kaptan her oyuncu için ödendi ya da ödenmedi işaretler.',
    points: [
      'Uygulama içinde oyuncular arasında para transferi yapılmaz; ödeme sizin aranızda kalır.',
    ],
  },
  {
    id: 'eksik-var',
    title: 'Eksik Var',
    text: 'Kaptan, maç için kaç oyuncu eksik olduğunu, aranan mevkiyi, seviyeyi ve ilçeyi belirterek ilan açar.',
    points: [
      'Serbest oyuncular ilanları liste ya da harita üzerinde görür ve başvurur.',
      'Kaptan başvuruyu kabul edince oyuncu maça katılır.',
    ],
  },
  {
    id: 'saha-rehberi',
    title: 'Saha Rehberi',
    text: 'Sahaları il ve ilçeye göre bul: konum, kapalı ya da açık, özellikler, fiyat aralığı ve telefon.',
    points: [
      'Oyuncular sahaları 1 ile 5 arasında puanlar ve kısa yorum yazar.',
      'Doğrulanmış sahalar rozetle gösterilir.',
    ],
  },
  {
    id: 'bildirimler',
    title: 'Hatırlatmalar ve bildirimler',
    text: 'Maçtan 24 saat ve 2 saat önce hatırlatma gelir.',
    points: ['Kaptan, katılım değişikliklerinden ve Eksik Var başvurularından haberdar olur.'],
  },
  {
    id: 'mac-sonrasi',
    title: 'Maç sonrası',
    text: 'Maç bitince 24 saat boyunca maçın oyuncusu (MVP) oylanır.',
    points: ['Profilinde oynadığın maç sayısı ve MVP sayın görünür.'],
  },
  {
    id: 'kadro-pro',
    title: 'Kadro Pro',
    text: 'Kadro ücretsiz kullanılır; ücretsiz sürümde sahibi olduğun bir takım kurabilirsin. Kadro Pro aylık ya da yıllık abonelikle şunları ekler:',
    points: [
      'Sınırsız takım.',
      'Kadro geçmişi.',
      'Gelişmiş istatistikler.',
      'Pro tanıtım bantları gösterilmez.',
    ],
  },
  {
    id: 'hesap',
    title: 'Hesap ve gizlilik',
    text: 'E-posta ve şifre, Apple ile giriş ya da Google ile giriş kullanabilirsin.',
    points: [
      'Hesabını uygulama içinden ya da web sitesindeki Hesabımı sil sayfasından silebilirsin.',
    ],
  },
];

export const PRO_PRICE_NOTE = 'Kadro Pro fiyatları uygulama mağazalarında belirlenir.';
