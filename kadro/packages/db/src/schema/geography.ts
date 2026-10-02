import { type SQL, sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

/** WGS 84 longitude/latitude pair in decimal degrees. */
export interface GeoPoint {
  readonly lng: number;
  readonly lat: number;
}

export const WGS84_SRID = 4326;

const EWKB_POINT_TYPE = 1;
const EWKB_FLAG_Z = 0x80000000;
const EWKB_FLAG_M = 0x40000000;
const EWKB_FLAG_SRID = 0x20000000;

/** Throws a RangeError unless the point is a finite WGS 84 coordinate. */
export function assertGeoPoint(point: GeoPoint): GeoPoint {
  const { lng, lat } = point;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RangeError('longitude must be a finite number between -180 and 180');
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError('latitude must be a finite number between -90 and 90');
  }
  return point;
}

/** SQL expression for a geography point. Coordinates are sent as bound parameters. */
export function geographyPointSql(point: GeoPoint): SQL {
  const { lng, lat } = assertGeoPoint(point);
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), ${WGS84_SRID})::geography`;
}

/**
 * Decodes the hex (E)WKB text PostgreSQL returns for a `geography(Point)` column.
 * Accepts both byte orders and an optional SRID header; rejects every non-point geometry.
 */
export function parseEwkbPoint(hex: string): GeoPoint {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new TypeError('geography value is not hex-encoded WKB');
  }
  const bytes = Buffer.from(hex, 'hex');
  const littleEndian = bytes.readUInt8(0) === 1;
  const readUInt32 = (offset: number): number =>
    littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const readDouble = (offset: number): number =>
    littleEndian ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);

  const typeWord = readUInt32(1);
  if ((typeWord & 0x0fffffff) !== EWKB_POINT_TYPE) {
    throw new TypeError('geography value is not a point');
  }
  if ((typeWord & EWKB_FLAG_Z) !== 0 || (typeWord & EWKB_FLAG_M) !== 0) {
    throw new TypeError('geography point must be two-dimensional');
  }
  let offset = 5;
  if ((typeWord & EWKB_FLAG_SRID) !== 0) {
    const srid = readUInt32(offset);
    if (srid !== WGS84_SRID) {
      throw new TypeError(`geography point has unexpected SRID ${String(srid)}`);
    }
    offset += 4;
  }
  if (bytes.length !== offset + 16) {
    throw new TypeError('geography point has an unexpected length');
  }
  const point = { lng: readDouble(offset), lat: readDouble(offset + 8) };
  if (Number.isNaN(point.lng) || Number.isNaN(point.lat)) {
    throw new TypeError('geography point is empty');
  }
  return assertGeoPoint(point);
}

/** PostGIS `geography(Point, 4326)` column mapped to `{ lng, lat }`. */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return `geography(Point, ${String(WGS84_SRID)})`;
  },
  toDriver(value) {
    return geographyPointSql(value);
  },
  fromDriver(value) {
    return parseEwkbPoint(value);
  },
});
