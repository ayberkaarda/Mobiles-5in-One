import { type Database, teams, uploads, users } from '@kadro/db';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { HOUR_MS } from '../clock.js';
import { type Buckets, type ObjectStorage } from '../storage/storage.js';

/** Objects younger than this are never treated as orphans (a publish may still be committing). */
export const ORPHAN_MIN_AGE_MS = HOUR_MS;

const MEDIA_PREFIXES = ['avatars/', 'badges/'] as const;

export interface OrphanSweepResult {
  readonly uploadsRetired: number;
  readonly objectsDeleted: number;
}

/**
 * ADR-0030 orphan cleanup. `ready` uploads that no avatar or badge references any more become
 * `deleted`; published objects older than one hour that are neither referenced by `avatar_key` /
 * `badge_key` nor belong to an upload in `processing` are removed from the media bucket. This also
 * covers objects of teams or uploads whose rows are gone.
 */
export async function sweepOrphanMedia(input: {
  readonly db: Database;
  readonly storage: ObjectStorage;
  readonly buckets: Buckets;
  readonly now: Date;
}): Promise<OrphanSweepResult> {
  const { db, storage, buckets, now } = input;

  const retired = await db
    .update(uploads)
    .set({ status: 'deleted', updatedAt: now })
    .where(
      and(
        eq(uploads.status, 'ready'),
        sql`not exists (select 1 from ${users} where ${users.avatarKey} = ${uploads.key} || '.webp')`,
        sql`not exists (select 1 from ${teams} where ${teams.badgeKey} = ${uploads.key} || '.webp')`,
      ),
    )
    .returning({ id: uploads.id });

  let objectsDeleted = 0;
  for (const prefix of MEDIA_PREFIXES) {
    let token: string | undefined;
    do {
      const page = await storage.list(buckets.media, prefix, token);
      const candidates = page.objects.filter(
        (object) => now.getTime() - object.lastModified.getTime() > ORPHAN_MIN_AGE_MS,
      );
      if (candidates.length > 0) {
        const keys = candidates.map((object) => object.key);
        const referenced = new Set<string>();
        const avatarRows = await db
          .select({ key: users.avatarKey })
          .from(users)
          .where(and(isNotNull(users.avatarKey), inArray(users.avatarKey, keys)));
        const badgeRows = await db
          .select({ key: teams.badgeKey })
          .from(teams)
          .where(and(isNotNull(teams.badgeKey), inArray(teams.badgeKey, keys)));
        const processingRows = await db
          .select({ key: uploads.key })
          .from(uploads)
          .where(
            and(
              eq(uploads.status, 'processing'),
              inArray(
                uploads.key,
                keys.map((key) => key.replace(/\.webp$/, '')),
              ),
            ),
          );
        for (const row of [...avatarRows, ...badgeRows]) {
          if (row.key !== null) {
            referenced.add(row.key);
          }
        }
        for (const row of processingRows) {
          referenced.add(`${row.key}.webp`);
        }
        for (const key of keys) {
          if (!referenced.has(key)) {
            await storage.delete(buckets.media, key);
            objectsDeleted += 1;
          }
        }
      }
      token = page.next;
    } while (token !== undefined);
  }
  return { uploadsRetired: retired.length, objectsDeleted };
}
