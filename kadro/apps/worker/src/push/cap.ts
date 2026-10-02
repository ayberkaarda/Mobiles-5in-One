import { type Database, rateLimitBuckets } from '@kadro/db';
import { sql } from 'drizzle-orm';

import { HOUR_MS } from '../clock.js';

/** Counter key of the global hourly push cap (ADR-0031); kept when `cost.guard` replaces it. */
export const PUSH_CAP_KEY = 'push:global';

export function hourWindowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * Atomically reserves `messages` sends in the current hour. Returns `false`, without counting,
 * when the reservation would take the hour above `cap`.
 */
export async function reservePushCapacity(
  db: Database,
  input: { readonly messages: number; readonly cap: number; readonly now: Date },
): Promise<boolean> {
  if (input.messages <= 0) {
    return true;
  }
  if (input.messages > input.cap) {
    return false;
  }
  const rows = await db
    .insert(rateLimitBuckets)
    .values({
      key: PUSH_CAP_KEY,
      windowStart: hourWindowStart(input.now),
      count: input.messages,
    })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: {
        count: sql`${rateLimitBuckets.count} + ${input.messages}`,
        updatedAt: input.now,
      },
      setWhere: sql`${rateLimitBuckets.count} + ${input.messages} <= ${input.cap}`,
    })
    .returning({ count: rateLimitBuckets.count });
  return rows.length > 0;
}
