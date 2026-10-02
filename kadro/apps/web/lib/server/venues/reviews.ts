import { type CreateReviewRequest, type VenueReview } from '@kadro/contracts';
import { users, venueReviews } from '@kadro/db';
import { and, eq } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { loadVenueRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { actorIdOf } from '../teams/context';
import { REVIEW_COLUMNS, toVenueReview } from './projections';
import { type VenueRequest } from './venues';

/**
 * Venue reviews (authorization matrix §3.6 footnotes 24 and 32, ADR-0038). The venue is resolved
 * by slug through the readable-venue scope; the relationship query also says whether the actor
 * played a `played` match there with RSVP `in` (`playedAtVenue`) and whether an own review exists.
 */

/**
 * `POST venues/:slug/reviews` (verified email, group W). Not eligible → 403
 * `review_not_eligible`; a second review by the same user fails on the unique constraint (409
 * `already_reviewed`), so two concurrent submissions store one row. Text is stored as plain text
 * exactly as validated (no markup is interpreted by the API; clients render it as text).
 */
export async function createReview(
  { ctx, runtime }: VenueRequest,
  slug: string,
  body: CreateReviewRequest,
): Promise<VenueReview> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    const relation = await loadVenueRelation(tx, actorId, { slug });
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('review.create', relation.facts);
    const [review] = await tx
      .insert(venueReviews)
      .values({
        venueId: relation.venueId,
        userId: actorId,
        rating: body.rating,
        text: body.text ?? null,
      })
      .returning({ id: venueReviews.id });
    if (review === undefined) {
      throw new Error('review insert returned no row');
    }
    const [row] = await tx
      .select(REVIEW_COLUMNS)
      .from(venueReviews)
      .innerJoin(users, eq(users.id, venueReviews.userId))
      .where(eq(venueReviews.id, review.id))
      .limit(1);
    if (row === undefined) {
      throw new Error('review is not visible after its insert');
    }
    return toVenueReview(row);
  });
}

/**
 * `DELETE venues/:slug/reviews/mine` (footnote 32): deletes only
 * `venue_reviews(venue_id = venue.id, user_id = actor)`; no own review → 404. One audit row
 * without personal data records it.
 */
export async function deleteOwnReview({ ctx, runtime }: VenueRequest, slug: string): Promise<void> {
  const actorId = actorIdOf(ctx);
  await runtime.db.transaction(async (tx) => {
    const relation = await loadVenueRelation(tx, actorId, { slug });
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('review.deleteOwn', relation.facts);
    const deleted = await tx
      .delete(venueReviews)
      .where(and(eq(venueReviews.venueId, relation.venueId), eq(venueReviews.userId, actorId)))
      .returning({ id: venueReviews.id });
    const [review] = deleted;
    if (review === undefined) {
      throw new ApiError('not_found');
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'review.deletedOwn',
      targetType: 'venue_review',
      targetId: review.id,
      ip: ctx.ip,
      metadata: { venueId: relation.venueId },
    });
  });
}
