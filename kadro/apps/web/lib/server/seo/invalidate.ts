import { districts, openCalls } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { revalidateTag } from 'next/cache';

import type { Logger } from '../logging';
import type { DbReader } from '../domain/relations';
import { districtTag, SITEMAP_TAG } from './data';

/**
 * Drops the cached public reads of the programmatic SEO pages (ADR-0057) once an open call, or the
 * match it belongs to, has changed: the district listing the call appears on and the sitemap. It
 * runs after the write has committed and only reuses the tags of `./data.ts`. The cache is
 * additionally bounded by the read-time expiry filter, so a failure here is logged, never raised:
 * the committed write must still answer success.
 */

type Revalidate = (tag: string) => void;

/** `expire: 0` makes the next read wait for fresh data instead of serving the stale entry. */
const expireNow: Revalidate = (tag) => {
  revalidateTag(tag, { expire: 0 });
};

export type CallScope = { readonly matchId: string } | { readonly openCallId: string };

/** Tags of every district a call of the scope was listed in, plus the sitemap. */
export async function callPageTags(db: DbReader, scope: CallScope): Promise<string[]> {
  const base = db
    .select({ ilSlug: districts.ilSlug, slug: districts.slug })
    .from(openCalls)
    .innerJoin(districts, eq(districts.id, openCalls.districtId));
  const rows =
    'matchId' in scope
      ? await base.where(eq(openCalls.matchId, scope.matchId))
      : await base.where(eq(openCalls.id, scope.openCallId));
  const tags = new Set(rows.map((row) => districtTag(row.ilSlug, row.slug)));
  tags.add(SITEMAP_TAG);
  return [...tags];
}

/** Revalidates the SEO pages that list the calls of `scope`. */
export async function revalidateCallPages(
  runtime: { readonly db: DbReader; readonly logger: Logger },
  scope: CallScope,
  revalidate: Revalidate = expireNow,
): Promise<void> {
  try {
    for (const tag of await callPageTags(runtime.db, scope)) {
      revalidate(tag);
    }
  } catch (err) {
    runtime.logger.error({ err }, 'seo cache revalidation failed');
  }
}
