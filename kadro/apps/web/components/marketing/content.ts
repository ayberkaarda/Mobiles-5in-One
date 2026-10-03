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

/**
 * Home hero (direction §4.4, §4.10): three imperatives, one per line, that keep the meaning of
 * the tagline "Kadron eksik kalmasın." (the tagline stays in the footer and the store copy). The
 * lead is the short version (at most 20 words); the 40 to 60 word definition is {@link HOME_INTRO},
 * shown in the "Kim için" section.
 */
export const HOME_HERO = {
  lines: ['Kadroyu kur,', 'eksiği kapat,', 'ücreti böl.'],
  lead: 'Halı saha maçının takımı, katılımı ve saha ücreti tek ekranda. Eksik kalırsa mahalleden oyuncu çağır.',
} as const;

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

/* ------------------------------------------------------------------------------------------------
 * Sample data of the diagrams and app screens (direction §8). Every team, venue, player and call
 * below is an example and is shown with the ÖRNEK tag or the [ÖRNEK] prefix; the fee is a sample
 * pitch fee, not a Kadro price. Pages never invent a number: counts and fees come from here.
 * --------------------------------------------------------------------------------------------- */

/** Position codes of the lineup (kaleci, defans, orta saha, forvet). */
export type PositionCode = 'KL' | 'DF' | 'OS' | 'FV';

export const POSITION_NAMES: Readonly<Record<PositionCode, string>> = {
  KL: 'Kaleci',
  DF: 'Defans',
  OS: 'Orta saha',
  FV: 'Forvet',
};

export interface SamplePlayer {
  readonly number: number;
  /** `null` for the open slot that the Eksik Var call fills. */
  readonly name: string | null;
  readonly position: PositionCode;
  readonly side: 'A' | 'B';
  /** Place on the landscape pitch, percent of the playing field (0 = left / top). */
  readonly x: number;
  readonly y: number;
}

export interface SampleMatch {
  readonly team: string;
  readonly district: string;
  readonly venue: string;
  readonly weekday: string;
  readonly date: string;
  readonly kickOff: string;
  readonly format: string;
  readonly capacity: number;
  /** Total pitch fee in Turkish lira. */
  readonly fee: number;
  readonly players: readonly SamplePlayer[];
}

export const SAMPLE_MATCH: SampleMatch = {
  team: 'Moda Akşam FK',
  district: 'Kadıköy',
  venue: 'Kadıköy Örnek Halı Saha A',
  weekday: 'Perşembe',
  date: '8 Ekim',
  kickOff: '21:00',
  format: '7v7',
  capacity: 14,
  fee: 2800,
  players: [
    { number: 1, name: 'Emre Kaya', position: 'KL', side: 'A', x: 5, y: 50 },
    { number: 2, name: 'Burak Şahin', position: 'DF', side: 'A', x: 19, y: 23 },
    { number: 3, name: 'Can Yıldız', position: 'DF', side: 'A', x: 19, y: 50 },
    { number: 4, name: 'Mert Aydın', position: 'DF', side: 'A', x: 19, y: 77 },
    { number: 5, name: 'Onur Demir', position: 'OS', side: 'A', x: 33, y: 33 },
    { number: 6, name: 'Kerem Çelik', position: 'OS', side: 'A', x: 33, y: 67 },
    { number: 7, name: 'Barış Öztürk', position: 'FV', side: 'A', x: 44, y: 50 },
    { number: 8, name: 'Selim Arslan', position: 'FV', side: 'B', x: 56, y: 50 },
    { number: 9, name: 'Tolga Koç', position: 'OS', side: 'B', x: 67, y: 33 },
    { number: 10, name: 'Deniz Güneş', position: 'OS', side: 'B', x: 67, y: 67 },
    { number: 11, name: 'Umut Polat', position: 'DF', side: 'B', x: 81, y: 23 },
    { number: 12, name: 'Arda Kurt', position: 'DF', side: 'B', x: 81, y: 50 },
    { number: 13, name: 'Efe Doğan', position: 'DF', side: 'B', x: 81, y: 77 },
    { number: 14, name: null, position: 'KL', side: 'B', x: 95, y: 50 },
  ],
};

/** One row of the match week timeline: a weekday, a clock time and what happened. */
export interface WeekEntry {
  readonly day: string;
  readonly time: string;
  readonly title: string;
  readonly text: string;
  /** The figure of the moment (`11/14`, `14 × 200 ₺`), set in kit numerals. */
  readonly figure: string;
  /** The match itself: the row the week leads to. */
  readonly highlight?: boolean;
}

export const MATCH_WEEK: readonly WeekEntry[] = [
  {
    day: 'Pazartesi',
    time: '20:14',
    title: 'Maç ilanı açıldı',
    text: 'Kaptan Perşembe 21:00 maçını kurar, davet bağlantısını takım grubuna atar.',
    figure: '0/14',
  },
  {
    day: 'Salı',
    time: '09:30',
    title: 'Kadro doluyor',
    text: 'Oyuncular geliyorum, belki ya da gelmiyorum der. Sayı kendiliğinden güncellenir.',
    figure: '11/14',
  },
  {
    day: 'Çarşamba',
    time: '18:40',
    title: 'Eksik kapandı',
    text: 'Kaleci eksikti. Kadıköy’deki Eksik Var ilanına başvuran oyuncuyu kaptan kabul etti.',
    figure: '14/14',
  },
  {
    day: 'Perşembe',
    time: '21:00',
    title: 'Maç',
    text: 'Diziliş hazır: iki taraf, mevkiye göre dengelendi.',
    figure: '7v7',
    highlight: true,
  },
  {
    day: 'Cuma',
    time: '10:05',
    title: 'Ücret bölündü',
    text: '2.800 ₺ saha ücreti 14 oyuncuya bölündü. Kimin ödediği listede işaretli.',
    figure: '14 × 200 ₺',
  },
];

export interface SampleCall {
  readonly missing: number;
  readonly format: string;
  readonly day: string;
  readonly time: string;
  readonly team: string;
  readonly venue: string;
  readonly position: string;
  readonly level: string;
}

/** Open Eksik Var calls of the sample district (all examples). */
export const SAMPLE_CALLS: readonly SampleCall[] = [
  {
    missing: 2,
    format: '7v7',
    day: 'Pazar 4 Ekim',
    time: '20:00',
    team: '[ÖRNEK] Moda Akşam FK',
    venue: 'Kadıköy Örnek Halı Saha A',
    position: 'Kaleci',
    level: 'Düzenli',
  },
  {
    missing: 1,
    format: '6v6',
    day: 'Pazartesi 5 Ekim',
    time: '21:30',
    team: '[ÖRNEK] Yeldeğirmeni Pazartesi',
    venue: 'Kadıköy Örnek Halı Saha B',
    position: 'Defans',
    level: 'Keyfine',
  },
  {
    missing: 3,
    format: '8v8',
    day: 'Çarşamba 7 Ekim',
    time: '22:00',
    team: '[ÖRNEK] Göztepe Gece Maçı',
    venue: 'Kadıköy Örnek Halı Saha A',
    position: 'Forvet',
    level: 'Rekabetçi',
  },
];

/** Districts of the filter row on the Eksik Var screen; the first one is selected. */
export const SAMPLE_DISTRICTS: readonly string[] = ['Kadıköy', 'Üsküdar', 'Ataşehir'];

/** Kit numbers of the players marked as paid on the fee screen (the rest are still open). */
export const SAMPLE_PAID_NUMBERS: readonly number[] = [1, 2, 3, 5, 6, 8, 9, 11, 12];

/** A fact of a feature row: a term, an optional figure and one sentence. */
export interface FeatureFact {
  readonly term: string;
  readonly figure?: string;
  /** Draw the figure as the eksik outline (an empty kit number). */
  readonly empty?: boolean;
  readonly text: string;
}

export interface HomeFeatureRow {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly facts: readonly FeatureFact[];
}

/** Section 3 of the home page: "Düdüğe kadar her iş tek yerde" (direction §4.10). */
export const HOME_FEATURES_TITLE = 'Düdüğe kadar her iş tek yerde';

export const HOME_FEATURE_ROWS: readonly HomeFeatureRow[] = [
  {
    id: 'katilim',
    title: 'Katılım ve saha ücreti',
    text: 'Herkes maç için yanıt verir, sayı kendiliğinden güncellenir. Kontenjan dolunca bekleme listesi sırayla ilerler.',
    facts: [
      {
        term: 'Katılım',
        figure: '13/14',
        text: 'Geliyorum, belki ya da gelmiyorum. Maçtan 24 saat ve 2 saat önce hatırlatma gelir.',
      },
      {
        term: 'Saha ücreti',
        figure: '2.800 ₺',
        text: 'Toplam ücret gelen oyunculara bölünür. Kimin ödediğini sen işaretlersin; para uygulamada el değiştirmez.',
      },
    ],
  },
  {
    id: 'eksik-var-ilani',
    title: 'Eksik Var',
    text: 'Biri son anda çekilirse ilçendeki serbest oyunculara ilan aç. Başvuranı sen kabul edersin, oyuncu maça katılır.',
    facts: [
      {
        term: 'Eksik',
        figure: '2',
        empty: true,
        text: 'Kaç kişi eksik, hangi mevki, hangi seviye: ilan bunlarla açılır.',
      },
      {
        term: 'Saha Rehberi',
        text: 'Sahaları il ve ilçeye göre bul; kapalı ya da açık, fiyat aralığı ve oyuncu yorumları.',
      },
    ],
  },
  {
    id: 'dizilis',
    title: 'Diziliş',
    text: 'Gelen oyuncuları mevkiye göre iki tarafa dağıt, sonra elle düzelt. Maçtan sonra 24 saat boyunca maçın oyuncusu oylanır.',
    facts: [],
  },
];

/** A group of the features page: a title and the ids of {@link FEATURE_SECTIONS} it lists. */
export interface FeatureGroup {
  readonly id: string;
  readonly title: string;
  readonly sectionIds: readonly string[];
}

/**
 * The four groups of `/ozellikler` (direction §4.4), then Kadro Pro and Hesap as a two-column text
 * block ({@link FEATURE_CLOSING_IDS}). Every section of {@link FEATURE_SECTIONS} appears once.
 */
export const FEATURE_GROUPS: readonly FeatureGroup[] = [
  { id: 'grup-takim', title: 'Takım', sectionIds: ['takim', 'kadro'] },
  {
    id: 'grup-mac',
    title: 'Maç ve katılım',
    sectionIds: ['mac', 'bildirimler', 'mac-sonrasi'],
  },
  { id: 'grup-eksik-var', title: 'Eksik Var', sectionIds: ['eksik-var'] },
  { id: 'grup-saha', title: 'Saha ve ücret', sectionIds: ['saha-rehberi', 'ucret'] },
];

export const FEATURE_CLOSING_IDS: readonly string[] = ['kadro-pro', 'hesap'];
