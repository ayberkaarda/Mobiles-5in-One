import type { VenueFeatures } from '../schema/venues.js';

/**
 * Clearly labeled demo venues. They are NOT real pitches: names are generic, carry the
 * `[ÖRNEK]` prefix, have no phone number, and their points are offsets from the approximate
 * district reference point. Real venues enter production only through the admin CSV import.
 */
export interface SampleVenueSeed {
  readonly ilSlug: string;
  readonly districtSlug: string;
  readonly name: string;
  readonly slug: string;
  /** Offset in degrees from the district reference point. */
  readonly offset: { readonly lat: number; readonly lng: number };
  readonly indoor: boolean;
  readonly features: VenueFeatures;
  readonly priceMinMinor: number;
  readonly priceMaxMinor: number;
}

export const SAMPLE_VENUE_PREFIX = '[ÖRNEK] ';

export const SAMPLE_VENUE_ADDRESS = 'Örnek kayıt: gerçek bir saha değildir.';

export const SAMPLE_VENUE_SEEDS: readonly SampleVenueSeed[] = [
  {
    ilSlug: 'istanbul',
    districtSlug: 'kadikoy',
    name: `${SAMPLE_VENUE_PREFIX}Kadıköy Örnek Halı Saha A`,
    slug: 'ornek-kadikoy-hali-saha-a',
    offset: { lat: 0.004, lng: 0.006 },
    indoor: false,
    features: { lighting: true, changingRoom: true, shower: true, parking: false },
    priceMinMinor: 250_000,
    priceMaxMinor: 350_000,
  },
  {
    ilSlug: 'istanbul',
    districtSlug: 'basaksehir',
    name: `${SAMPLE_VENUE_PREFIX}Başakşehir Örnek Kapalı Saha B`,
    slug: 'ornek-basaksehir-kapali-saha-b',
    offset: { lat: -0.005, lng: 0.004 },
    indoor: true,
    features: { lighting: true, changingRoom: true, shower: true, parking: true },
    priceMinMinor: 300_000,
    priceMaxMinor: 420_000,
  },
  {
    ilSlug: 'ankara',
    districtSlug: 'cankaya',
    name: `${SAMPLE_VENUE_PREFIX}Çankaya Örnek Halı Saha C`,
    slug: 'ornek-cankaya-hali-saha-c',
    offset: { lat: 0.006, lng: -0.004 },
    indoor: false,
    features: { lighting: true, changingRoom: true, shower: false, parking: true },
    priceMinMinor: 200_000,
    priceMaxMinor: 300_000,
  },
  {
    ilSlug: 'ankara',
    districtSlug: 'etimesgut',
    name: `${SAMPLE_VENUE_PREFIX}Etimesgut Örnek Kapalı Saha D`,
    slug: 'ornek-etimesgut-kapali-saha-d',
    offset: { lat: -0.004, lng: -0.006 },
    indoor: true,
    features: { lighting: true, changingRoom: true, shower: true, parking: true },
    priceMinMinor: 220_000,
    priceMaxMinor: 320_000,
  },
  {
    ilSlug: 'izmir',
    districtSlug: 'bornova',
    name: `${SAMPLE_VENUE_PREFIX}Bornova Örnek Halı Saha E`,
    slug: 'ornek-bornova-hali-saha-e',
    offset: { lat: 0.005, lng: 0.005 },
    indoor: false,
    features: { lighting: true, changingRoom: false, shower: false, parking: true },
    priceMinMinor: 180_000,
    priceMaxMinor: 280_000,
  },
  {
    ilSlug: 'izmir',
    districtSlug: 'karsiyaka',
    name: `${SAMPLE_VENUE_PREFIX}Karşıyaka Örnek Halı Saha F`,
    slug: 'ornek-karsiyaka-hali-saha-f',
    offset: { lat: -0.006, lng: 0.003 },
    indoor: false,
    features: { lighting: true, changingRoom: true, shower: true, parking: false },
    priceMinMinor: 200_000,
    priceMaxMinor: 300_000,
  },
];
