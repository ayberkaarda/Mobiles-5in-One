import {
  type MatchStatus,
  type MatchStatusTarget,
  type RsvpChoice,
  type RsvpStatus,
  type TeamRole,
} from './contracts';

/**
 * What the app offers per team role and match state (authorization matrix §3.4 footnotes
 * 10–17, ADR-0004, ADR-0035, ADR-0036). These only decide which controls are shown; the server
 * enforces the same rules and its answer wins. `role` is `null` for a match guest or while the
 * team role is unknown: such a viewer gets no staff control.
 */
export type ViewerRole = TeamRole | null;

export function isStaff(role: ViewerRole): boolean {
  return role === 'captain' || role === 'co_captain';
}

/** Footnote 10: staff of a team that is not read-only after a lapsed Pro plan. */
export function canCreateMatch(team: { myRole: TeamRole; isProLocked: boolean }): boolean {
  return isStaff(team.myRole) && !team.isProLocked;
}

/** `starts_at` and the venue stay editable in `draft`, `open` and `locked` (ADR-0004). */
export function canEditMatch(role: ViewerRole, status: MatchStatus): boolean {
  return isStaff(role) && (status === 'draft' || status === 'open' || status === 'locked');
}

/** Fee, slots and format are frozen from the first lock on, whatever the status is now. */
export function termsFrozen(match: { lockedAt: string | null; status: MatchStatus }): boolean {
  return match.lockedAt !== null || (match.status !== 'draft' && match.status !== 'open');
}

/** Footnote 12 transitions offered as buttons; cancelling goes through `DELETE` instead. */
export function statusTargets(
  role: ViewerRole,
  match: { status: MatchStatus; startsAt: string },
  now: number = Date.now(),
): MatchStatusTarget[] {
  if (!isStaff(role)) {
    return [];
  }
  const started = Date.parse(match.startsAt) <= now;
  switch (match.status) {
    case 'draft':
      return ['open'];
    case 'open':
      return started ? ['locked', 'played'] : ['locked'];
    case 'locked':
      return started ? ['open', 'played'] : ['open'];
    case 'played':
    case 'cancelled':
      return [];
  }
}

/** Footnote 13: a `draft` is deleted, `open` / `locked` is cancelled, `played` stays. */
export function removalKind(role: ViewerRole, status: MatchStatus): 'delete' | 'cancel' | null {
  if (!isStaff(role)) {
    return null;
  }
  if (status === 'draft') {
    return 'delete';
  }
  return status === 'open' || status === 'locked' ? 'cancel' : null;
}

/**
 * Footnote 14: every choice while the match is `open` and has not started; in `locked` only
 * `out` before the start; nothing otherwise.
 */
export function rsvpChoices(
  match: { status: MatchStatus; startsAt: string },
  now: number = Date.now(),
): RsvpChoice[] {
  if (Date.parse(match.startsAt) <= now) {
    return [];
  }
  if (match.status === 'open') {
    return ['in', 'maybe', 'out'];
  }
  return match.status === 'locked' ? ['out'] : [];
}

/** Whether a choice would change anything: `in` while already confirmed or waitlisted does not. */
export function rsvpChanges(current: RsvpStatus | null, choice: RsvpChoice): boolean {
  if (choice === 'in') {
    return current !== 'in' && current !== 'waitlist';
  }
  return current !== choice;
}

/** Footnote 15: staff, while the match is `open` or `locked`. */
export function canSetLineup(role: ViewerRole, status: MatchStatus): boolean {
  return isStaff(role) && (status === 'open' || status === 'locked');
}

/** Payment flags are writable in `locked` and `played` matches (ADR-0006, ADR-0036). */
export function paymentsWritable(status: MatchStatus): boolean {
  return status === 'locked' || status === 'played';
}

/**
 * Footnote 16: staff mark confirmed players; the captain may mark themselves, a co-captain may
 * not.
 */
export function canMarkPayment(
  role: ViewerRole,
  status: MatchStatus,
  target: { status: RsvpStatus; isSelf: boolean },
): boolean {
  if (!isStaff(role) || !paymentsWritable(status) || target.status !== 'in') {
    return false;
  }
  return !(target.isSelf && role === 'co_captain');
}

/** Whether the 24-hour MVP window is open now (ADR-0036). */
export function mvpWindowOpen(
  match: { status: MatchStatus; mvpVoteClosesAt: string | null },
  now: number = Date.now(),
): boolean {
  return (
    match.status === 'played' &&
    match.mvpVoteClosesAt !== null &&
    now < Date.parse(match.mvpVoteClosesAt)
  );
}

/** Footnote 17: a confirmed player votes once while the window is open. */
export function canVoteMvp(
  match: { status: MatchStatus; mvpVoteClosesAt: string | null },
  myStatus: RsvpStatus | null,
  myVoteeId: string | null,
  now: number = Date.now(),
): boolean {
  return mvpWindowOpen(match, now) && myStatus === 'in' && myVoteeId === null;
}
