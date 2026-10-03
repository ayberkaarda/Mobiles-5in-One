import {
  type AdminOpenCall,
  type AdminReview,
  type ListAdminOpenCallsQuery,
  type ListAdminReviewsQuery,
  type OpenCallStatus,
  type Paginated,
  type Position,
  type Level,
} from '@kadro/contracts';
import {
  matches,
  openCallApplications,
  openCalls,
  teams,
  users,
  venueReviews,
  venues,
} from '@kadro/db';
import { and, eq } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { callChain, lockCall } from '../calls/context';
import { defineKeyset, openPage } from '../domain/pagination';
import { ApiError } from '../errors';
import { notifyApplicationDecided } from '../jobs/notify';
import { actorIdOf } from '../teams/context';
import { type AdminRequest } from './step-up';

/**
 * Content moderation (`GET/DELETE admin/reviews`, `GET/DELETE admin/open-calls`; authorization
 * matrix §3.8, spec security item 18, ADR-0064, ADR-0067). Moderators and admins with a valid
 * step-up remove venue reviews and open calls; every removal writes one audit row with ids only.
 */

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

const ADMIN_REVIEWS = defineKeyset('admin.reviews', [
  { column: venueReviews.createdAt, type: 'timestamp', direction: 'desc' },
  { column: venueReviews.id, type: 'uuid', direction: 'desc' },
]);

interface ReviewRow {
  readonly id: string;
  readonly venueId: string;
  readonly venueName: string;
  readonly venueSlug: string;
  readonly authorId: string;
  readonly authorDisplayName: string;
  readonly rating: number;
  readonly text: string | null;
  readonly createdAt: Date;
}

function toAdminReview(row: ReviewRow): AdminReview {
  return {
    id: row.id,
    venue: { id: row.venueId, name: row.venueName, slug: row.venueSlug },
    author: { id: row.authorId, displayName: row.authorDisplayName },
    rating: row.rating,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `GET admin/reviews` (`admin.read`): newest first, optionally one venue. */
export async function listAdminReviews(
  { ctx, runtime }: AdminRequest,
  query: ListAdminReviewsQuery,
): Promise<Paginated<AdminReview>> {
  await ctx.authorize('admin.read');
  const page = openPage(
    ADMIN_REVIEWS,
    { cursor: query.cursor, limit: query.limit, filters: { venue: query.venue } },
    runtime.keyedHash,
  );
  const rows = await runtime.db
    .select({
      id: venueReviews.id,
      venueId: venues.id,
      venueName: venues.name,
      venueSlug: venues.slug,
      authorId: users.id,
      authorDisplayName: users.displayName,
      rating: venueReviews.rating,
      text: venueReviews.text,
      createdAt: venueReviews.createdAt,
      pageKey: page.key,
    })
    .from(venueReviews)
    .innerJoin(venues, eq(venues.id, venueReviews.venueId))
    .innerJoin(users, eq(users.id, venueReviews.userId))
    .where(
      and(
        eq(users.isTombstone, false),
        query.venue === undefined ? undefined : eq(venueReviews.venueId, query.venue),
        page.where,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, toAdminReview);
}

/**
 * `DELETE admin/reviews/:id` (`review.delete`, staff + step-up): removes the review (the venue's
 * rating aggregate is computed on read, so it follows at once). Unknown id → 404. One
 * `review.removed` audit row with the venue and author ids.
 */
export async function deleteAdminReview(
  { ctx, runtime }: AdminRequest,
  reviewId: string,
): Promise<void> {
  await ctx.authorize('review.delete');
  const actorId = actorIdOf(ctx);
  await runtime.db.transaction(async (tx) => {
    const [removed] = await tx.delete(venueReviews).where(eq(venueReviews.id, reviewId)).returning({
      id: venueReviews.id,
      venueId: venueReviews.venueId,
      userId: venueReviews.userId,
      rating: venueReviews.rating,
    });
    if (removed === undefined) {
      throw new ApiError('not_found');
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'review.removed',
      targetType: 'venue_review',
      targetId: removed.id,
      ip: ctx.ip,
      metadata: { venueId: removed.venueId, authorId: removed.userId, rating: removed.rating },
    });
  });
}

// ---------------------------------------------------------------------------
// Open calls
// ---------------------------------------------------------------------------

const ADMIN_OPEN_CALLS = defineKeyset('admin.open-calls', [
  { column: openCalls.createdAt, type: 'timestamp', direction: 'desc' },
  { column: openCalls.id, type: 'uuid', direction: 'desc' },
]);

interface OpenCallRow {
  readonly id: string;
  readonly matchId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly districtId: string;
  readonly startsAt: Date;
  readonly missingCount: number;
  readonly position: Position | null;
  readonly level: Level;
  readonly status: OpenCallStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

function toAdminOpenCall(row: OpenCallRow): AdminOpenCall {
  return {
    id: row.id,
    matchId: row.matchId,
    team: { id: row.teamId, name: row.teamName },
    districtId: row.districtId,
    startsAt: row.startsAt.toISOString(),
    missingCount: row.missingCount,
    position: row.position,
    level: row.level,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** `GET admin/open-calls` (`admin.read`): newest first, optionally one status. */
export async function listAdminOpenCalls(
  { ctx, runtime }: AdminRequest,
  query: ListAdminOpenCallsQuery,
): Promise<Paginated<AdminOpenCall>> {
  await ctx.authorize('admin.read');
  const page = openPage(
    ADMIN_OPEN_CALLS,
    { cursor: query.cursor, limit: query.limit, filters: { status: query.status } },
    runtime.keyedHash,
  );
  const rows = await runtime.db
    .select({
      id: openCalls.id,
      matchId: openCalls.matchId,
      teamId: teams.id,
      teamName: teams.name,
      districtId: openCalls.districtId,
      startsAt: matches.startsAt,
      missingCount: openCalls.missingCount,
      position: openCalls.position,
      level: openCalls.level,
      status: openCalls.status,
      expiresAt: openCalls.expiresAt,
      createdAt: openCalls.createdAt,
      pageKey: page.key,
    })
    .from(openCalls)
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .where(
      and(query.status === undefined ? undefined : eq(openCalls.status, query.status), page.where),
    )
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, toAdminOpenCall);
}

/**
 * `DELETE admin/open-calls/:id` (`opencall.remove`, staff + step-up): sets status `removed` from
 * any status under the call chain locks (team, match, call; ADR-0037 lock order), rejects the
 * call's pending applications in the same transaction with one `application.decided` push each,
 * and writes one `opencall.removed` audit row. An already removed call answers 204 again; that
 * request is audited too, with `changed: false`. Unknown id → 404.
 */
export async function removeAdminOpenCall(
  { ctx, runtime }: AdminRequest,
  openCallId: string,
): Promise<void> {
  await ctx.authorize('opencall.remove');
  const actorId = actorIdOf(ctx);
  const chain = await callChain(runtime.db, openCallId);
  if (chain === null) {
    throw new ApiError('not_found');
  }
  await runtime.db.transaction(async (tx) => {
    await lockCall(tx, chain);
    const [call] = await tx
      .select({ status: openCalls.status })
      .from(openCalls)
      .where(eq(openCalls.id, chain.openCallId));
    if (call === undefined) {
      throw new ApiError('not_found');
    }
    const now = runtime.now();
    const changed = call.status !== 'removed';
    let rejected = 0;
    if (changed) {
      await tx
        .update(openCalls)
        .set({ status: 'removed', updatedAt: now })
        .where(eq(openCalls.id, chain.openCallId));
      const applications = await tx
        .update(openCallApplications)
        .set({ status: 'rejected', updatedAt: now })
        .where(
          and(
            eq(openCallApplications.openCallId, chain.openCallId),
            eq(openCallApplications.status, 'pending'),
          ),
        )
        .returning({ id: openCallApplications.id, userId: openCallApplications.userId });
      for (const application of applications) {
        await notifyApplicationDecided(runtime.jobs, tx, {
          applicationId: application.id,
          applicantId: application.userId,
        });
      }
      rejected = applications.length;
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'opencall.removed',
      targetType: 'open_call',
      targetId: chain.openCallId,
      ip: ctx.ip,
      metadata: { matchId: chain.matchId, previousStatus: call.status, changed, rejected },
    });
  });
}
