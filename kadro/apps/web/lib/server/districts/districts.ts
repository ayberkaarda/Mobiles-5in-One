import {
  type DistrictPublic,
  type ListDistrictsQuery,
  type ListDistrictsResponse,
} from '@kadro/contracts';
import { districts } from '@kadro/db';
import { eq } from 'drizzle-orm';

import { type ServerRuntime } from '../runtime';

/**
 * Public reference list of provinces and districts (il / ilçe) for pickers and maps. Not
 * paginated and without a policy action: the rows are static reference data (authorization
 * matrix §3.7, like the health probe).
 */

function compare(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * `GET districts`: every district, or those of one province slug. Sorted by `provinceSlug` then
 * `slug` by plain code-unit order (the slugs are lower-case ASCII), independent of the database
 * collation.
 */
export async function listDistricts(
  runtime: ServerRuntime,
  query: ListDistrictsQuery,
): Promise<ListDistrictsResponse> {
  const rows = await runtime.db
    .select({
      id: districts.id,
      province: districts.il,
      provinceSlug: districts.ilSlug,
      name: districts.ilce,
      slug: districts.slug,
      centroid: districts.centroid,
    })
    .from(districts)
    .where(query.province === undefined ? undefined : eq(districts.ilSlug, query.province));
  const items: DistrictPublic[] = rows
    .map((row) => ({
      id: row.id,
      province: row.province,
      provinceSlug: row.provinceSlug,
      name: row.name,
      slug: row.slug,
      centroid: { latitude: row.centroid.lat, longitude: row.centroid.lng },
    }))
    .sort((a, b) => compare(a.provinceSlug, b.provinceSlug) || compare(a.slug, b.slug));
  return { items };
}
