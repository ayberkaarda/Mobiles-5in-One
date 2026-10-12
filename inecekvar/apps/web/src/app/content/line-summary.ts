import { clipWords, countWords, formatFare, formatTurkishDate, normalizeText } from './format';
import { LineOut, modeLabel, paymentLabel } from './public-types';

export const SUMMARY_MIN_WORDS = 40;
export const SUMMARY_MAX_WORDS = 60;

const fillers = [
  'Durak sırası, güzergâh çizimi ve hattın nasıl durdurulacağı aşağıda yer alır.',
  'Yanlış bir bilgi görürseniz Bu hattı düzelt bağlantısıyla düzeltme önerebilirsiniz.',
  'İnecek Var, resmî verisi olmayan dolmuş, minibüs ve servis hatlarını mahallelinin birlikte haritaladığı açık bir rehberdir.',
  'Veriler moderatör onayından sonra yayımlanır ve her sürüm tarihiyle saklanır.',
];

export function buildLineSummary(line: LineOut, cityName: string): string {
  const name = (value: string) => clipWords(normalizeText(value), 6);
  const n = line.stops.length;
  const first = line.stops[0];
  const last = line.stops[n - 1];
  const start =
    n >= 2
      ? `${name(line.name)} ${modeLabel(line.mode)} hattı, ${name(cityName)} şehrinde ${n} durak arasında çalışır.`
      : `${name(line.name)} ${modeLabel(line.mode)} hattı ${name(cityName)} şehrinde kayıtlı; durak listesi henüz tamamlanmadı.`;
  const ends =
    n >= 2 && first && last ? `İlk durak ${name(first.name)}, son durak ${name(last.name)}.` : '';
  const fare = formatFare(line.fare_minor);
  const fareDate = line.fare_updated_at ? formatTurkishDate(line.fare_updated_at) : '';
  const price = fare
    ? `Ücret ${fare}${fareDate ? ` (son güncelleme: ${fareDate})` : ''}.`
    : 'Ücret bilgisi henüz paylaşılmadı.';
  const hours = line.hours_text ? normalizeText(line.hours_text) : '';
  const hoursSentence = (limit: number) =>
    hours
      ? `Çalışma saatleri: ${clipWords(hours, limit)}.`
      : 'Çalışma saatleri henüz paylaşılmadı.';
  const labels = line.payment_methods
    .map(paymentLabel)
    .filter((label): label is string => label !== null);
  let payment = labels.length ? `Ödeme: ${labels.join(', ')}.` : '';
  const verified = line.last_verified_at ? formatTurkishDate(line.last_verified_at) : '';
  let credit =
    (line.contributor_count === 0
      ? 'Bilgiler topluluk önerileriyle derlendi'
      : `Bilgiler ${line.contributor_count} katkıcının önerileriyle derlendi`) +
    (verified ? ` ve en son ${verified} tarihinde doğrulandı.` : '; hat henüz doğrulanmadı.');
  let schedule = hoursSentence(10);
  const additions: string[] = [];
  const join = () =>
    [start, ends, price, schedule, payment, credit, ...additions].filter(Boolean).join(' ');
  for (const filler of fillers) {
    if (countWords(join()) >= SUMMARY_MIN_WORDS) break;
    additions.push(filler);
  }
  if (countWords(join()) > SUMMARY_MAX_WORDS) payment = '';
  if (countWords(join()) > SUMMARY_MAX_WORDS) schedule = hoursSentence(4);
  if (countWords(join()) > SUMMARY_MAX_WORDS) schedule = '';
  if (countWords(join()) > SUMMARY_MAX_WORDS) credit = '';
  return clipWords(join(), SUMMARY_MAX_WORDS);
}
