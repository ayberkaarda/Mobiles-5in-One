import { z } from 'zod';

import { LIMITS } from './limits.js';

/** Page size from a query string: digits only, 1..100, defaults to 20 when absent. */
const pageSizeSchema = z
  .string()
  .regex(/^[0-9]{1,3}$/, 'must be a positive integer')
  .transform(Number)
  .pipe(z.number().int().min(LIMITS.pageSize.min).max(LIMITS.pageSize.max))
  .default(LIMITS.pageSize.default);

/** Opaque, server-issued cursor (base64url). Clients pass it back unchanged. */
export const cursorSchema = z
  .string()
  .min(1)
  .max(LIMITS.cursor.max)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be an opaque cursor');

/** Query parameters accepted by every cursor-paginated list endpoint. */
export const paginationQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: pageSizeSchema,
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Wraps an item schema into the shared list envelope `{ items, nextCursor }`. */
export function paginatedResponseSchema<TItem extends z.ZodType>(item: TItem) {
  return z.strictObject({
    items: z.array(item).max(LIMITS.pageSize.max),
    nextCursor: cursorSchema.nullable(),
  });
}
export interface Paginated<TItem> {
  items: TItem[];
  nextCursor: string | null;
}
