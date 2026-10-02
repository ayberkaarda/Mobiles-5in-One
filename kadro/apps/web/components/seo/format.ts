import { type Level, type MatchFormat, type Position } from '@kadro/contracts';

/**
 * Turkish copy and formatting of the programmatic SEO pages (ADR-0057). The labels match the
 * mobile app's Turkish strings so a visitor sees the same words on the web and in the app.
 */

/** Match times are shown in Turkey's time zone whatever the server's zone is. */
export const DISPLAY_TIME_ZONE = 'Europe/Istanbul';

export const POSITION_LABELS: Readonly<Record<Position, string>> = {
  GK: 'Kaleci',
  DEF: 'Defans',
  MID: 'Orta saha',
  FWD: 'Forvet',
};

export const LEVEL_LABELS: Readonly<Record<Level, string>> = {
  casual: 'Keyfine',
  regular: 'Düzenli',
  competitive: 'Rekabetçi',
};

export const FEATURE_LABELS = {
  lighting: 'Aydınlatma',
  changingRoom: 'Soyunma odası',
  shower: 'Duş',
  parking: 'Otopark',
} as const;

export type FeatureKey = keyof typeof FEATURE_LABELS;

export const FEATURE_KEYS: readonly FeatureKey[] = [
  'lighting',
  'changingRoom',
  'shower',
  'parking',
];

export interface FeatureRow {
  readonly key: FeatureKey;
  readonly label: string;
  readonly present: boolean;
}

/** The features a venue states, in a fixed order; unknown keys never leave the server. */
export function featureRows(
  features: Readonly<Partial<Record<FeatureKey, boolean>>>,
): FeatureRow[] {
  return FEATURE_KEYS.flatMap((key) => {
    // eslint-disable-next-line security/detect-object-injection -- key iterates a literal tuple
    const present = features[key];
    // eslint-disable-next-line security/detect-object-injection -- key iterates a literal tuple
    return present === undefined ? [] : [{ key, label: FEATURE_LABELS[key], present }];
  });
}

/** Shown on every sample venue: seeded demonstration rows are not real pitches (spec rule 6). */
export const SAMPLE_NOTICE = 'Bu kayıt örnek veridir; gerçek bir halı saha değildir.';

export function formatLabel(format: MatchFormat): string {
  return format.replace('v', ' vs ');
}

export function positionLabel(position: Position | null): string {
  // eslint-disable-next-line security/detect-object-injection -- typed enum key of a literal map
  return position === null ? 'Her mevki' : POSITION_LABELS[position];
}

const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: DISPLAY_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** "4 Ekim Pazar 20:00" style match time in Turkey's time zone. */
export function formatMatchTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

const PRICE = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 0,
});

/** Price range from minor units (kuruş); `null` when the venue states no price. */
export function formatPriceRange(minMinor: number | null, maxMinor: number | null): string | null {
  const values = [minMinor, maxMinor].filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }
  const low = PRICE.format(Math.min(...values) / 100);
  const high = PRICE.format(Math.max(...values) / 100);
  return low === high ? low : `${low} – ${high}`;
}

/** At most `max` characters, cut at a word boundary with an ellipsis. */
export function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

/** Product spec §7: the page title without the ` · Kadro` suffix of the title template. */
export const PAGE_TITLE_MAX = 52;
export const DESCRIPTION_MAX = 155;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** Shortened venue name for titles and the answer-first paragraph (names allow 120 characters). */
export function shortVenueName(name: string): string {
  return clampText(name, 48);
}

export interface VenueFacts {
  readonly name: string;
  readonly il: string;
  readonly ilce: string;
  readonly indoor: boolean;
}

/**
 * The 40 to 60 word answer-first paragraph of a venue page (spec §7 GEO): what the place is, what
 * Kadro is, and what the page holds.
 */
export function venueIntro(venue: VenueFacts): string {
  const kind = venue.indoor ? 'kapalı' : 'açık';
  return (
    `${shortVenueName(venue.name)}, ${venue.il} ili ${venue.ilce} ilçesinde ${kind} bir halı ` +
    'sahadır. Kadro, halı saha maçı organize etmeye, eksik oyuncu bulmaya ve saha ücretini ' +
    'takip etmeye yarayan uygulamadır. Bu sayfada sahanın ilçesini, olanaklarını, fiyat ' +
    'aralığını ve oyuncu yorumlarını görebilir, uygulamayı indirip bu sahada maç kurabilirsin.'
  );
}

export interface DistrictFacts {
  readonly il: string;
  readonly ilce: string;
}

/** The 40 to 60 word answer-first paragraph of a district open-call page. */
export function districtIntro(district: DistrictFacts): string {
  return (
    `Bu sayfa ${district.il} ${district.ilce} için açık eksik oyuncu ilanlarını listeler. ` +
    'Kadro, halı saha maçı organize eden takımların eksik oyuncuyu mahalleden bulmasını ve ' +
    'saha ücretini takip etmesini sağlayan uygulamadır. Her ilanda maç saati, format, aranan ' +
    'mevki ve seviye yer alır; başvuruyu uygulamadan gönderirsin. Liste yaklaşık beş dakikada ' +
    'bir yenilenir.'
  );
}

export function venueTitle(name: string): string {
  return clampText(`${shortVenueName(name)} halı saha`, PAGE_TITLE_MAX);
}

export function venueDescription(venue: VenueFacts, price: string | null): string {
  const kind = venue.indoor ? 'Kapalı' : 'Açık';
  const priceText = price === null ? '' : ` Fiyat aralığı ${price}.`;
  return clampText(
    `${venue.ilce}, ${venue.il}: ${kind} halı saha. Olanaklar, yorumlar ve Kadro ile bu sahada maç kurma.${priceText}`,
    DESCRIPTION_MAX,
  );
}

export function districtTitle(district: DistrictFacts): string {
  return clampText(`${district.ilce}, ${district.il} eksik oyuncu ilanları`, PAGE_TITLE_MAX);
}

export function districtDescription(district: DistrictFacts, callCount: number): string {
  const lead =
    callCount === 0
      ? `${district.ilce} (${district.il}) için şu an açık eksik oyuncu ilanı yok.`
      : `${district.ilce} (${district.il}) halı saha maçlarında ${callCount} açık eksik oyuncu ilanı.`;
  return clampText(
    `${lead} Maç saati, format, mevki ve seviyeyi gör, Kadro ile başvur.`,
    DESCRIPTION_MAX,
  );
}

export function venuePath(slug: string): `/saha/${string}` {
  return `/saha/${slug}`;
}

export function districtPath(ilSlug: string, slug: string): `/eksik-var/${string}` {
  return `/eksik-var/${ilSlug}/${slug}`;
}
