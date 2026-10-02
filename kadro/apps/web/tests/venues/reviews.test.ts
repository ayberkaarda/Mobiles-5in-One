import { venueDetailSchema, type VenueReview, venueReviewSchema } from '@kadro/contracts';
import { auditLogs, venueReviews } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expectProblem } from '../support/http';
import { account, type Account, anonymous, expectJson, insertTeam } from '../teams/support';
import {
  api,
  type CallsHarness,
  insertMatch,
  insertRsvp,
  insertVenue,
  label,
  setupCallsHarness,
  statuses,
} from '../calls/support';

/**
 * Venue reviews (matrix §3.6 footnotes 24 and 32, ADR-0038): only after an `in` RSVP on a
 * `played` match at that venue, one per user, plain text, own deletion only.
 */

let t: CallsHarness;

beforeAll(async () => {
  t = await setupCallsHarness('web_venue_reviews');
});

afterAll(async () => {
  await t.dispose();
});

beforeEach(() => {
  t.harness.setNow(new Date());
});

/** A user with an `in` RSVP on a played match at `venueId` (eligible reviewer). */
async function playedAt(venueId: string, options: { verified?: boolean } = {}): Promise<Account> {
  const player = await account(t, { displayName: `Oyuncu ${label()}`, ...options });
  const owner = await account(t);
  const teamId = await insertTeam(t, owner.id);
  const matchId = await insertMatch(t, teamId, { status: 'played', venueId });
  await insertRsvp(t, matchId, player.id, 'in');
  return player;
}

async function reviewsOf(venueId: string) {
  return t.db.select().from(venueReviews).where(eq(venueReviews.venueId, venueId));
}

describe('POST venues/:slug/reviews', () => {
  it('an eligible player reviews once; the text stays plain and comes back verbatim', async () => {
    const venue = await insertVenue(t);
    const player = await playedAt(venue.id);
    const text = 'Zemin iyi <img src=x onerror=alert(1)>\nIşıklar yeterli';
    const body: VenueReview = venueReviewSchema.parse(
      await expectJson(await api.review(player.headers, venue.slug, { rating: 4, text }), 201),
    );
    expect(body).toMatchObject({ rating: 4, text });
    expect(Object.keys(body).sort()).toEqual(
      ['authorDisplayName', 'createdAt', 'id', 'rating', 'text'].sort(),
    );
    const [row] = await reviewsOf(venue.id);
    expect(row).toMatchObject({ userId: player.id, rating: 4, text });
    const detail = venueDetailSchema.parse(
      await expectJson(await api.getVenue(anonymous(), venue.slug), 200),
    );
    expect(detail.recentReviews.map((review) => review.id)).toEqual([body.id]);
    expect(JSON.stringify(detail)).not.toContain(player.id);
    await expectProblem(
      await api.review(player.headers, venue.slug, { rating: 5 }),
      409,
      'already_reviewed',
    );
  });

  it('only an `in` RSVP on a played match at this venue qualifies (403 review_not_eligible)', async () => {
    const venue = await insertVenue(t);
    const elsewhere = await insertVenue(t);
    const owner = await account(t);
    const teamId = await insertTeam(t, owner.id);
    const cases: Account[] = [];
    // Never played anywhere.
    cases.push(await account(t));
    // `out` on a played match here.
    const out = await account(t);
    await insertRsvp(
      t,
      await insertMatch(t, teamId, { status: 'played', venueId: venue.id }),
      out.id,
      'out',
    );
    cases.push(out);
    // `in` on matches here that were not played.
    for (const status of ['open', 'locked', 'cancelled'] as const) {
      const notPlayed = await account(t);
      await insertRsvp(
        t,
        await insertMatch(t, teamId, { status, venueId: venue.id }),
        notPlayed.id,
        'in',
      );
      cases.push(notPlayed);
    }
    // `in` on a played match at another venue, and on a played free-text match.
    const other = await account(t);
    await insertRsvp(
      t,
      await insertMatch(t, teamId, { status: 'played', venueId: elsewhere.id }),
      other.id,
      'in',
    );
    await insertRsvp(t, await insertMatch(t, teamId, { status: 'played' }), other.id, 'in');
    cases.push(other);
    for (const actor of cases) {
      await expectProblem(
        await api.review(actor.headers, venue.slug, { rating: 3 }),
        403,
        'review_not_eligible',
      );
    }
    expect(await reviewsOf(venue.id)).toEqual([]);
  });

  it('401 anonymous, 403 unverified email, 404 unknown or unreadable venue', async () => {
    const venue = await insertVenue(t);
    const unverified = await playedAt(venue.id, { verified: false });
    await expectProblem(
      await api.review(anonymous(), venue.slug, { rating: 3 }),
      401,
      'unauthenticated',
    );
    await expectProblem(
      await api.review(unverified.headers, venue.slug, { rating: 3 }),
      403,
      'email_unverified',
    );
    const player = await account(t);
    await expectProblem(
      await api.review(player.headers, `yok-${label()}`, { rating: 3 }),
      404,
      'not_found',
    );
    const creator = await account(t);
    const hidden = await insertVenue(t, { verified: false, createdBy: creator.id });
    const playedHidden = await playedAt(hidden.id);
    await expectProblem(
      await api.review(playedHidden.headers, hidden.slug, { rating: 3 }),
      404,
      'not_found',
    );
  });

  it('rating 1..5 integer, text up to 500 characters, no other field', async () => {
    const venue = await insertVenue(t);
    const player = await playedAt(venue.id);
    for (const json of [
      { rating: 0 },
      { rating: 6 },
      { rating: 2.5 },
      { rating: '5' },
      { rating: 3, text: 'x'.repeat(501) },
      { rating: 3, text: 'zil\u0007' },
      { rating: 3, userId: player.id },
      { rating: 3, venueId: venue.id },
      {},
    ]) {
      await expectProblem(
        await api.review(player.headers, venue.slug, json),
        400,
        'validation_failed',
      );
    }
    await expectJson(
      await api.review(player.headers, venue.slug, { rating: 1, text: 'x'.repeat(500) }),
      201,
    );
  });

  it('a double submission stores one review', async () => {
    for (let round = 0; round < 3; round += 1) {
      const venue = await insertVenue(t);
      const player = await playedAt(venue.id);
      const responses = await Promise.all([
        api.review(player.headers, venue.slug, { rating: 5 }),
        api.review(player.headers, venue.slug, { rating: 4 }),
      ]);
      expect(statuses(responses)).toEqual([201, 409]);
      const loser = responses.find((response) => response.status === 409);
      if (loser !== undefined) {
        await expectProblem(loser, 409, 'already_reviewed');
      }
      expect(await reviewsOf(venue.id)).toHaveLength(1);
    }
  });

  it('group W: the 11th review request of a user within a day is 429', async () => {
    const venue = await insertVenue(t);
    const player = await account(t);
    for (let index = 0; index < 10; index += 1) {
      await expectProblem(
        await api.review(player.headers, venue.slug, { rating: 3 }),
        403,
        'review_not_eligible',
      );
    }
    const denied = await api.review(player.headers, venue.slug, { rating: 3 });
    await expectProblem(denied.clone(), 429, 'rate_limited');
    expect(denied.headers.get('retry-after')).not.toBeNull();
  });
});

describe('DELETE venues/:slug/reviews/mine', () => {
  it("deletes only the caller's own review, writes an audit row, then answers 404", async () => {
    const venue = await insertVenue(t);
    const author = await playedAt(venue.id);
    const other = await playedAt(venue.id);
    const mine = await expectJson<VenueReview>(
      await api.review(author.headers, venue.slug, { rating: 2 }),
      201,
    );
    const theirs = await expectJson<VenueReview>(
      await api.review(other.headers, venue.slug, { rating: 5 }),
      201,
    );
    const response = await api.deleteReview(author.headers, venue.slug);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect((await reviewsOf(venue.id)).map((row) => row.id)).toEqual([theirs.id]);
    const audits = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'review.deletedOwn'), eq(auditLogs.targetId, mine.id)));
    expect(audits.map((audit) => [audit.actorId, audit.metadata])).toEqual([
      [author.id, { venueId: venue.id }],
    ]);
    await expectProblem(await api.deleteReview(author.headers, venue.slug), 404, 'not_found');
    // The author may review again after deleting (no edit endpoint in the MVP).
    await expectJson(await api.review(author.headers, venue.slug, { rating: 3 }), 201);
  });

  it('without an own review, anonymous, unknown or unreadable venue: nothing is deleted', async () => {
    const venue = await insertVenue(t);
    const author = await playedAt(venue.id);
    await expectJson(await api.review(author.headers, venue.slug, { rating: 4 }), 201);
    const stranger = await account(t);
    await expectProblem(await api.deleteReview(stranger.headers, venue.slug), 404, 'not_found');
    await expectProblem(await api.deleteReview(anonymous(), venue.slug), 401, 'unauthenticated');
    await expectProblem(await api.deleteReview(author.headers, `yok-${label()}`), 404, 'not_found');
    const creator = await account(t);
    const hidden = await insertVenue(t, { verified: false, createdBy: creator.id });
    await t.db.insert(venueReviews).values({ venueId: hidden.id, userId: stranger.id, rating: 3 });
    await expectProblem(await api.deleteReview(stranger.headers, hidden.slug), 404, 'not_found');
    expect(await reviewsOf(venue.id)).toHaveLength(1);
    expect(await reviewsOf(hidden.id)).toHaveLength(1);
  });
});

describe('GET venues/:slug myReview', () => {
  async function detailFor(headers: Record<string, string>, slug: string) {
    const response = await api.getVenue(headers, slug);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return venueDetailSchema.parse(await expectJson(response, 200));
  }

  it('is null for anonymous callers, also when the venue has reviews', async () => {
    const venue = await insertVenue(t);
    const author = await playedAt(venue.id);
    await expectJson(await api.review(author.headers, venue.slug, { rating: 4 }), 201);
    const detail = await detailFor(anonymous(), venue.slug);
    expect(detail.recentReviews).toHaveLength(1);
    expect(detail.myReview).toBeNull();
  });

  it('is null for a signed-in caller without a review of this venue', async () => {
    const venue = await insertVenue(t);
    const elsewhere = await insertVenue(t);
    const author = await playedAt(venue.id);
    await expectJson(await api.review(author.headers, venue.slug, { rating: 5 }), 201);
    const reader = await playedAt(elsewhere.id);
    await expectJson(await api.review(reader.headers, elsewhere.slug, { rating: 2 }), 201);
    const detail = await detailFor(reader.headers, venue.slug);
    expect(detail.recentReviews).toHaveLength(1);
    expect(detail.myReview).toBeNull();
  });

  it("is the caller's own review and never another user's", async () => {
    const venue = await insertVenue(t);
    const author = await playedAt(venue.id);
    const other = await playedAt(venue.id);
    const mine = venueReviewSchema.parse(
      await expectJson(
        await api.review(author.headers, venue.slug, { rating: 2, text: 'Dar' }),
        201,
      ),
    );
    const theirs = venueReviewSchema.parse(
      await expectJson(await api.review(other.headers, venue.slug, { rating: 5 }), 201),
    );
    const authorView = await detailFor(author.headers, venue.slug);
    expect(authorView.myReview).toEqual(mine);
    const otherView = await detailFor(other.headers, venue.slug);
    expect(otherView.myReview).toEqual(theirs);
    expect(JSON.stringify(authorView)).not.toContain(author.id);

    expect((await api.deleteReview(author.headers, venue.slug)).status).toBe(204);
    expect((await detailFor(author.headers, venue.slug)).myReview).toBeNull();
    expect((await detailFor(other.headers, venue.slug)).myReview).toEqual(theirs);
  });
});
