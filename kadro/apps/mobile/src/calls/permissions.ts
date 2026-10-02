import { type Application, type MatchMemberView, type TeamRole } from './contracts';
import { type ApplicationsPage } from './queries';

/**
 * What the open-call screens offer per relationship and state (authorization matrix §3.5
 * footnotes 18–22, 30, 33; ADR-0003, ADR-0010, ADR-0037, ADR-0041). These only decide which
 * controls are shown; the server enforces the same rules and its answer wins.
 */

/** `expires_at ≥ now() + 15 min` (`LIMITS.openCallMinLifetimeSeconds`, ADR-0037). */
export const CALL_MIN_LIFETIME_MS = 15 * 60 * 1000;
/**
 * Slack on top of the 15-minute minimum, so a form left open for a moment (and the request's
 * travel time) does not turn a valid choice into `invalid_call_expiry`.
 */
export const EXPIRY_SLACK_MS = 2 * 60 * 1000;
/**
 * Earliest instant a call may end, seen from `now`. Both the publish gate and the expiry choices
 * use it, so the form is offered only when at least one expiry (the kick-off) can be chosen.
 */
export function earliestExpiry(now: number): number {
  return now + CALL_MIN_LIFETIME_MS + EXPIRY_SLACK_MS;
}
/** Largest missing count of a call (`LIMITS.missingCount.max`). */
export const MISSING_COUNT_MAX = 29;

export function isStaffRole(role: TeamRole | null): boolean {
  return role === 'captain' || role === 'co_captain';
}

/**
 * Whether a call can still take applications and decisions: before `expires_at` and before the
 * match starts (footnotes 20, 21). A listed call is open by definition (footnote 18); the time
 * may have passed since the list was loaded.
 */
export function callActive(call: { expiresAt: string; startsAt?: string }, now: number): boolean {
  if (Date.parse(call.expiresAt) <= now) {
    return false;
  }
  return call.startsAt === undefined || Date.parse(call.startsAt) > now;
}

/** Free places of a match: `slots − confirmed`, the upper bound of `missingCount` (footnote 19). */
export function freeSlots(match: Pick<MatchMemberView, 'slots' | 'counts'>): number {
  return Math.max(0, match.slots - match.counts.in);
}

export function maxMissingCount(match: Pick<MatchMemberView, 'slots' | 'counts'>): number {
  return Math.min(MISSING_COUNT_MAX, freeSlots(match));
}

export type PublishBlocker =
  /** Not captain or co-captain of the match's team (or the role is not known yet). */
  | 'notStaff'
  /** The team is read-only after a lapsed Pro plan. */
  | 'proLocked'
  /** The match is not `open` (draft, locked, played, cancelled). */
  | 'notOpen'
  /** The match starts before the earliest possible end of a call (`earliestExpiry`). */
  | 'tooLate'
  /** No free place left. */
  | 'full';

/**
 * Footnote 19: staff of a team that is not read-only, for an `open` match that starts later than
 * now + 15 min and still has a free place. `null` when publishing is possible.
 */
export function publishBlocker(
  role: TeamRole | null,
  isProLocked: boolean,
  match: Pick<MatchMemberView, 'status' | 'startsAt' | 'slots' | 'counts'>,
  now: number,
): PublishBlocker | null {
  if (!isStaffRole(role)) {
    return 'notStaff';
  }
  if (isProLocked) {
    return 'proLocked';
  }
  if (match.status !== 'open') {
    return 'notOpen';
  }
  if (Date.parse(match.startsAt) < earliestExpiry(now)) {
    return 'tooLate';
  }
  return freeSlots(match) < 1 ? 'full' : null;
}

/** How the viewer relates to a call, from what `GET open-calls/:id/applications` returned. */
export type CallRelation =
  | { readonly kind: 'none' }
  | { readonly kind: 'applicant'; readonly application: Application }
  | { readonly kind: 'staff' };

/**
 * Footnote 33: staff of the call's team read every application (possibly none), an applicant
 * reads only their own row, anyone else gets 404 (`related: false`). Team members cannot apply,
 * so a row of the viewer means "applicant"; any other answer with a relationship means staff.
 */
export function callRelation(firstPage: ApplicationsPage, myUserId: string): CallRelation {
  if (!firstPage.related) {
    return { kind: 'none' };
  }
  const own = firstPage.items.find((application) => application.applicant.id === myUserId);
  return own === undefined ? { kind: 'staff' } : { kind: 'applicant', application: own };
}

/** Footnote 21: staff accept or reject a `pending` application while the call is active. */
export function canDecide(application: Pick<Application, 'status'>, active: boolean): boolean {
  return active && application.status === 'pending';
}

/** Footnote 22: the applicant withdraws their own `pending` application. */
export function canWithdraw(application: Pick<Application, 'status'>): boolean {
  return application.status === 'pending';
}
