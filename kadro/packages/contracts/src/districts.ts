import { z } from 'zod';

import { idSchema } from './common.js';
import { LIMITS } from './limits.js';

/** URL slug used by SEO pages (`/sahalar/[il]/[ilce]`): lower-case ASCII words joined by dashes. */
export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) => value.split('-').every((part) => /^[a-z0-9]+$/.test(part)),
    'must be a lower-case slug',
  );

export const geoPointSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

/** Public projection of a `districts` row (il / ilçe). */
export const districtPublicSchema = z.strictObject({
  id: idSchema,
  province: z.string().min(1).max(60),
  provinceSlug: slugSchema,
  name: z.string().min(1).max(60),
  slug: slugSchema,
  centroid: geoPointSchema,
});
export type DistrictPublic = z.infer<typeof districtPublicSchema>;

/**
 * `GET /api/v1/districts` query: `province` (il slug) narrows the list to one province; without
 * it every district is returned. Reference data, so the list is not paginated.
 */
export const listDistrictsQuerySchema = z.strictObject({
  province: slugSchema.optional(),
});
export type ListDistrictsQuery = z.infer<typeof listDistrictsQuerySchema>;

/**
 * `GET /api/v1/districts` response, sorted by `provinceSlug` then `slug`. The server may answer
 * with `Cache-Control: public, max-age=86400`: districts change only through a migration or seed.
 */
export const listDistrictsResponseSchema = z.strictObject({
  items: z.array(districtPublicSchema).max(LIMITS.districtsList.max),
});
export type ListDistrictsResponse = z.infer<typeof listDistrictsResponseSchema>;
