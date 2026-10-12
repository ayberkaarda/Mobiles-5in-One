import { countWords } from './format';
import { buildLineSummary, SUMMARY_MAX_WORDS, SUMMARY_MIN_WORDS } from './line-summary';
import { LineOut } from './public-types';
import { lineData, stopData } from './test-data';

interface SummaryCase {
  label: string;
  change: Partial<LineOut>;
  city?: string;
  contains?: string[];
  absent?: string[];
}

const longName = Array.from({ length: 60 }, (_, i) => `İsim${i}`).join(' ');
const cases: SummaryCase[] = [
  {
    label: 'full data',
    change: {},
    contains: [
      '₺27,50 (son güncelleme: 12 Ekim 2026)',
      'Çalışma saatleri: Her gün 06:00–23:00.',
      'Ödeme: nakit, kart.',
      '3 katkıcının',
    ],
  },
  {
    label: 'no fare',
    change: { fare_minor: null },
    contains: ['Ücret bilgisi henüz paylaşılmadı.'],
    absent: ['₺', 'son güncelleme'],
  },
  {
    label: 'fare without date',
    change: { fare_updated_at: null },
    contains: ['Ücret ₺27,50.'],
    absent: ['son güncelleme'],
  },
  {
    label: 'no hours',
    change: { hours_text: null },
    contains: ['Çalışma saatleri henüz paylaşılmadı.'],
  },
  {
    label: 'blank hours',
    change: { hours_text: ' \n\t ' },
    contains: ['Çalışma saatleri henüz paylaşılmadı.'],
  },
  {
    label: 'long hours',
    change: { hours_text: 'saat '.repeat(300) },
    contains: ['Çalışma saatleri: saat saat saat saat saat saat saat saat saat saat….'],
  },
  { label: 'no payment', change: { payment_methods: [] }, absent: ['Ödeme:'] },
  {
    label: 'unknown payments',
    change: { payment_methods: ['bilinmeyen-ödeme', '<script>ödeme</script>'] },
    absent: ['bilinmeyen-ödeme', '<script>ödeme', 'Ödeme:'],
  },
  {
    label: 'mixed payments',
    change: { payment_methods: ['istanbulkart', 'bilinmeyen-ödeme'] },
    contains: ['Ödeme: İstanbulkart.'],
    absent: ['bilinmeyen-ödeme'],
  },
  {
    label: 'zero stops',
    change: { stops: [] },
    contains: ['durak listesi henüz tamamlanmadı.'],
    absent: ['İlk durak', 'son durak'],
  },
  {
    label: 'one stop',
    change: { stops: [stopData()] },
    contains: ['durak listesi henüz tamamlanmadı.'],
    absent: ['İlk durak', 'son durak'],
  },
  {
    label: 'two stops',
    change: {},
    contains: ['2 durak arasında çalışır.', 'İlk durak İlk Durak, son durak Son Durak.'],
  },
  {
    label: 'zero contributors',
    change: { contributor_count: 0 },
    contains: ['Bilgiler topluluk önerileriyle derlendi'],
    absent: ['0 katkıcının'],
  },
  {
    label: 'unverified',
    change: { last_verified_at: null },
    contains: ['hat henüz doğrulanmadı.'],
    absent: ['tarihinde doğrulandı'],
  },
  {
    label: 'long names',
    change: { name: longName, stops: [stopData('ilk', longName), stopData('son', longName)] },
    city: longName,
    contains: ['İsim0 İsim1 İsim2 İsim3 İsim4 İsim5…'],
    absent: ['İsim6'],
  },
  {
    label: 'Turkish letters',
    change: { name: 'İı şğ çö ü', stops: [stopData('ilk', 'İı şğ'), stopData('son', 'çö ü')] },
    city: 'İı şğ çö ü',
    contains: ['İı şğ çö ü minibüs hattı, İı şğ çö ü', 'İlk durak İı şğ, son durak çö ü.'],
  },
  {
    label: 'hostile names',
    change: {
      name: '</script> <b> "İş"\u2028\u0000',
      stops: [stopData('ilk', '<b>\u0001 İlk'), stopData('son', '"Son"\u007f')],
    },
    city: 'Örnek\u2028Şehir',
    contains: ['</script> <b> "İş"', 'İlk durak <b> İlk, son durak "Son".'],
    absent: ['\u2028', '\u0000', '\u0001', '\u007f'],
  },
  {
    label: 'minimal data',
    change: {
      name: 'A',
      stops: [],
      fare_minor: null,
      fare_updated_at: null,
      hours_text: null,
      payment_methods: [],
      contributor_count: 0,
      last_verified_at: null,
    },
    city: 'B',
    contains: ['Durak sırası, güzergâh çizimi', 'Yanlış bir bilgi'],
  },
  {
    label: 'unknown mode',
    change: { mode: '<script>araç</script>' },
    contains: ['Örnek Hat hat hattı'],
    absent: ['<script>araç'],
  },
];

describe('line summary', () => {
  it.each(cases)(
    'keeps $label deterministic and within the word budget',
    ({ change, city, contains, absent }) => {
      const line = lineData(change);
      const text = buildLineSummary(line, city ?? 'Örnek Şehir');
      expect(countWords(text)).toBeGreaterThanOrEqual(SUMMARY_MIN_WORDS);
      expect(countWords(text)).toBeLessThanOrEqual(SUMMARY_MAX_WORDS);
      expect(buildLineSummary(line, city ?? 'Örnek Şehir')).toBe(text);
      for (const part of contains ?? []) expect(text).toContain(part);
      for (const part of absent ?? []) expect(text).not.toContain(part);
    },
  );

  it('never attaches case suffixes to arbitrary names', () => {
    const line = lineData({ name: 'İş', stops: [stopData('ilk', 'Üç'), stopData('son', 'Öz')] });
    const text = buildLineSummary(line, 'Çığ');
    expect(text).toContain('İş minibüs hattı, Çığ şehrinde');
    expect(text).toContain('İlk durak Üç, son durak Öz.');
  });

  it('drops payment before shortening hours and preserves the opening', () => {
    const text = buildLineSummary(
      lineData({
        name: 'Bir İki Üç Dört Beş Altı',
        stops: [stopData('ilk', 'İlk Uzun Durak'), stopData('son', 'Son Uzun Durak')],
        hours_text: 'bir iki üç dört beş altı yedi sekiz dokuz on onbir',
        payment_methods: Array.from({ length: 10 }, () => 'nakit'),
      }),
      'Bir İki Üç Dört Beş Altı',
    );
    expect(text.startsWith('Bir İki Üç Dört Beş Altı minibüs hattı,')).toBe(true);
    expect(text).not.toContain('Ödeme:');
    expect(text).toContain('Çalışma saatleri: bir iki üç dört….');
    expect(countWords(text)).toBeLessThanOrEqual(60);
  });
});
