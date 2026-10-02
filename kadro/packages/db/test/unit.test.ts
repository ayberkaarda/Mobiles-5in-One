import { describe, expect, it } from 'vitest';

import { assertGeoPoint, parseEwkbPoint } from '../src/schema/geography.js';
import {
  DISTRICT_SEEDS,
  SAMPLE_VENUE_PREFIX,
  SAMPLE_VENUE_SEEDS,
  slugify,
} from '../src/seed/index.js';

function ewkbPoint(lng: number, lat: number, littleEndian: boolean, srid?: number): string {
  const header = Buffer.alloc(srid === undefined ? 5 : 9);
  header.writeUInt8(littleEndian ? 1 : 0, 0);
  const type = srid === undefined ? 1 : 0x20000001 >>> 0;
  if (littleEndian) header.writeUInt32LE(type, 1);
  else header.writeUInt32BE(type, 1);
  if (srid !== undefined) {
    if (littleEndian) header.writeUInt32LE(srid, 5);
    else header.writeUInt32BE(srid, 5);
  }
  const coords = Buffer.alloc(16);
  if (littleEndian) {
    coords.writeDoubleLE(lng, 0);
    coords.writeDoubleLE(lat, 8);
  } else {
    coords.writeDoubleBE(lng, 0);
    coords.writeDoubleBE(lat, 8);
  }
  return Buffer.concat([header, coords]).toString('hex');
}

describe('parseEwkbPoint', () => {
  it('decodes little- and big-endian points with and without SRID', () => {
    expect(parseEwkbPoint(ewkbPoint(29.029, 40.99, true, 4326))).toEqual({
      lng: 29.029,
      lat: 40.99,
    });
    expect(parseEwkbPoint(ewkbPoint(27.129, 38.418, false, 4326))).toEqual({
      lng: 27.129,
      lat: 38.418,
    });
    expect(parseEwkbPoint(ewkbPoint(32.86, 39.9, true))).toEqual({ lng: 32.86, lat: 39.9 });
  });

  it('rejects other SRIDs, non-points and malformed input', () => {
    expect(() => parseEwkbPoint(ewkbPoint(1, 1, true, 3857))).toThrow(/SRID/);
    expect(() => parseEwkbPoint('0102000000')).toThrow(/not a point/);
    expect(() => parseEwkbPoint('zz')).toThrow(/hex/);
    expect(() => parseEwkbPoint(ewkbPoint(Number.NaN, Number.NaN, true, 4326))).toThrow(/empty/);
  });
});

describe('assertGeoPoint', () => {
  it('rejects out-of-range and non-finite coordinates', () => {
    expect(() => assertGeoPoint({ lng: 181, lat: 0 })).toThrow(RangeError);
    expect(() => assertGeoPoint({ lng: 0, lat: -91 })).toThrow(RangeError);
    expect(() => assertGeoPoint({ lng: Number.POSITIVE_INFINITY, lat: 0 })).toThrow(RangeError);
    expect(assertGeoPoint({ lng: -180, lat: 90 })).toEqual({ lng: -180, lat: 90 });
  });
});

describe('slugify', () => {
  it('folds Turkish letters to ASCII', () => {
    expect(slugify('İstanbul')).toBe('istanbul');
    expect(slugify('İzmir')).toBe('izmir');
    expect(slugify('Kadıköy')).toBe('kadikoy');
    expect(slugify('Şereflikoçhisar')).toBe('sereflikochisar');
    expect(slugify('Güzelbahçe')).toBe('guzelbahce');
    expect(slugify('  Çiğli / Karşıyaka  ')).toBe('cigli-karsiyaka');
  });
});

describe('seed data', () => {
  it('has unique district slugs per province', () => {
    const keys = DISTRICT_SEEDS.map((seed) => `${slugify(seed.il)}/${slugify(seed.ilce)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('labels every sample venue and points it at a seeded district', () => {
    const districtKeys = new Set(
      DISTRICT_SEEDS.map((seed) => `${slugify(seed.il)}/${slugify(seed.ilce)}`),
    );
    for (const venue of SAMPLE_VENUE_SEEDS) {
      expect(venue.name.startsWith(SAMPLE_VENUE_PREFIX)).toBe(true);
      expect(venue.slug.startsWith('ornek-')).toBe(true);
      expect(districtKeys.has(`${venue.ilSlug}/${venue.districtSlug}`)).toBe(true);
      expect(venue.priceMinMinor).toBeLessThanOrEqual(venue.priceMaxMinor);
    }
  });
});
