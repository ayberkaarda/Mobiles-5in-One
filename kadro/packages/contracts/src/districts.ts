import { z } from 'zod';

import { idSchema } from './common.js';

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
