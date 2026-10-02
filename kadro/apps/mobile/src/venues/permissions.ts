import { canCreateMatch } from '../matches/permissions';
import { type TeamSummary, type VenueDetail, type VenueReview } from './contracts';

/**
 * What the app offers per viewer on a venue (authorization matrix §3.6, footnotes 23, 24, 32;
 * ADR-0038). These only decide which controls are shown; the server enforces the same rules and
 * its answer wins. Review eligibility (an `in` RSVP on a played match at the venue) is not
 * visible to the app, so the form is offered and a 403 `review_not_eligible` explains it.
 */
export type ReviewerState =
  /** The viewer's review of this venue: delete always, rewrite with a verified email. */
  | { readonly kind: 'own'; readonly review: VenueReview; readonly canRewrite: boolean }
  /** No review yet and a verified email: the form (the server checks eligibility). */
  | { readonly kind: 'write' }
  /** No review yet and the email is not verified (`POST reviews` is a **V** action). */
  | { readonly kind: 'unverified' };

export function reviewerState(
  detail: Pick<VenueDetail, 'myReview'>,
  me: { readonly emailVerified: boolean },
): ReviewerState {
  if (detail.myReview !== null) {
    return { kind: 'own', review: detail.myReview, canRewrite: me.emailVerified };
  }
  return me.emailVerified ? { kind: 'write' } : { kind: 'unverified' };
}

/** `POST venues` is a **V** action (footnote 23). */
export function canAddVenue(me: { readonly emailVerified: boolean }): boolean {
  return me.emailVerified;
}

/** Teams in which the viewer may create a match (footnote 10: staff, team not read-only). */
export function matchTeams(teams: readonly TeamSummary[]): TeamSummary[] {
  return teams.filter((team) => canCreateMatch(team));
}

/**
 * Other users' reviews, newest first. The server sends the newest page, but its order is not
 * part of the contract, so it is sorted here; the viewer's own review is shown on its own.
 */
export function otherReviews(
  detail: Pick<VenueDetail, 'recentReviews' | 'myReview'>,
): VenueReview[] {
  const ownId = detail.myReview?.id ?? null;
  return detail.recentReviews
    .filter((review) => review.id !== ownId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1));
}
