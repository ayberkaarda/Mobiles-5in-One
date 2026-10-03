import { type NotificationType, type PushSendJob } from '@kadro/contracts';
import {
  type Database,
  type MatchStatus,
  type RsvpStatus,
  type TeamRole,
  matchRsvps,
  matches,
  openCallApplications,
  openCalls,
  teamMembers,
  teams,
  users,
} from '@kadro/db';
import { and, count, eq, inArray } from 'drizzle-orm';

import { type PushTemplateInput } from './templates.js';

/**
 * Resolves, at send time, whether the recipient still has the relationship that justifies the
 * notification (ADR-0031) and the template variables. A recipient who lost access is skipped.
 */

export type Resolution =
  | {
      readonly deliver: true;
      readonly input: PushTemplateInput;
      /**
       * Ids added to the notification `data` next to the type's reference: the call's match id of
       * an application notification (ADR-0079). Read from the same row as the access check.
       */
      readonly data?: { readonly matchId: string };
    }
  | { readonly deliver: false; readonly reason: string };

const ACTIVE_MATCH: readonly MatchStatus[] = ['open', 'locked'];
const STAFF: readonly TeamRole[] = ['captain', 'co_captain'];

/** RSVP statuses that receive each match notification (ADR-0031 table). */
export const MATCH_RECIPIENT_STATUSES: Partial<Record<NotificationType, readonly RsvpStatus[]>> = {
  'match.reminder_24h': ['in', 'maybe'],
  'match.reminder_2h': ['in'],
  'match.updated': ['in', 'maybe', 'waitlist'],
  'rsvp.promoted': ['in'],
};

async function activeUser(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ deactivatedAt: users.deactivatedAt, isTombstone: users.isTombstone })
    .from(users)
    .where(eq(users.id, userId));
  return row !== undefined && row.deactivatedAt === null && !row.isTombstone;
}

async function loadMatch(db: Database, matchId: string) {
  const [row] = await db
    .select({
      id: matches.id,
      teamId: matches.teamId,
      status: matches.status,
      startsAt: matches.startsAt,
      teamName: teams.name,
    })
    .from(matches)
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .where(eq(matches.id, matchId));
  return row;
}

async function rsvpStatus(db: Database, matchId: string, userId: string) {
  const [row] = await db
    .select({ status: matchRsvps.status })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, userId)));
  return row?.status;
}

async function teamRole(db: Database, teamId: string, userId: string) {
  const [row] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return row?.role;
}

async function confirmedCount(db: Database, matchId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.status, 'in')));
  return row?.value ?? 0;
}

async function resolveMatchNotification(
  db: Database,
  job: PushSendJob,
  now: Date,
): Promise<Resolution> {
  const match = await loadMatch(db, job.refId);
  if (match === undefined) {
    return { deliver: false, reason: 'target_missing' };
  }
  const base = { teamName: match.teamName, startsAt: match.startsAt };

  if (job.type === 'match.updated') {
    if (match.status === 'draft') {
      return { deliver: false, reason: 'not_allowed' };
    }
    const status = await rsvpStatus(db, match.id, job.userId);
    if (status === undefined || !MATCH_RECIPIENT_STATUSES[job.type]?.includes(status)) {
      return { deliver: false, reason: 'not_allowed' };
    }
    return {
      deliver: true,
      input: { ...base, variant: match.status === 'cancelled' ? 'cancelled' : 'default' },
    };
  }

  if (!ACTIVE_MATCH.includes(match.status)) {
    return { deliver: false, reason: 'match_inactive' };
  }
  if (match.startsAt.getTime() <= now.getTime()) {
    return { deliver: false, reason: 'stale' };
  }

  const statuses = MATCH_RECIPIENT_STATUSES[job.type];
  if (statuses !== undefined) {
    const status = await rsvpStatus(db, match.id, job.userId);
    return status !== undefined && statuses.includes(status)
      ? { deliver: true, input: base }
      : { deliver: false, reason: 'not_allowed' };
  }

  const role = await teamRole(db, match.teamId, job.userId);
  if (job.type === 'rsvp.changed') {
    return role !== undefined && STAFF.includes(role)
      ? { deliver: true, input: { ...base, count: await confirmedCount(db, match.id) } }
      : { deliver: false, reason: 'not_allowed' };
  }
  // lineup.slot_free: the captain only.
  return role === 'captain'
    ? { deliver: true, input: base }
    : { deliver: false, reason: 'not_allowed' };
}

async function resolveApplicationNotification(db: Database, job: PushSendJob): Promise<Resolution> {
  const [row] = await db
    .select({
      applicantId: openCallApplications.userId,
      applicationStatus: openCallApplications.status,
      openCallId: openCalls.id,
      matchId: matches.id,
      teamId: matches.teamId,
      startsAt: matches.startsAt,
      teamName: teams.name,
    })
    .from(openCallApplications)
    .innerJoin(openCalls, eq(openCalls.id, openCallApplications.openCallId))
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .where(eq(openCallApplications.id, job.refId));
  if (row === undefined) {
    return { deliver: false, reason: 'target_missing' };
  }
  const base = { teamName: row.teamName, startsAt: row.startsAt };
  const data = { matchId: row.matchId };

  if (job.type === 'application.decided') {
    if (row.applicantId !== job.userId) {
      return { deliver: false, reason: 'not_allowed' };
    }
    if (row.applicationStatus !== 'accepted' && row.applicationStatus !== 'rejected') {
      return { deliver: false, reason: 'not_decided' };
    }
    return { deliver: true, input: { ...base, variant: row.applicationStatus }, data };
  }

  // application.received: captain and co-captains of the call's team, summarising pending ones.
  const role = await teamRole(db, row.teamId, job.userId);
  if (role === undefined || !STAFF.includes(role)) {
    return { deliver: false, reason: 'not_allowed' };
  }
  const [pending] = await db
    .select({ value: count() })
    .from(openCallApplications)
    .where(
      and(
        eq(openCallApplications.openCallId, row.openCallId),
        inArray(openCallApplications.status, ['pending']),
      ),
    );
  const pendingCount = pending?.value ?? 0;
  return pendingCount === 0
    ? { deliver: false, reason: 'nothing_pending' }
    : { deliver: true, input: { ...base, count: pendingCount }, data };
}

async function resolveTeamNotification(db: Database, job: PushSendJob): Promise<Resolution> {
  const [teamRow] = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.id, job.refId));
  if (teamRow === undefined) {
    return { deliver: false, reason: 'target_missing' };
  }
  if ((await teamRole(db, job.refId, job.userId)) !== 'captain') {
    return { deliver: false, reason: 'not_allowed' };
  }
  const [members] = await db
    .select({ value: count() })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, job.refId));
  return { deliver: true, input: { teamName: teamRow.name, count: members?.value ?? 0 } };
}

export async function resolveRecipient(
  db: Database,
  job: PushSendJob,
  now: Date,
): Promise<Resolution> {
  if (!(await activeUser(db, job.userId))) {
    return { deliver: false, reason: 'recipient_inactive' };
  }
  switch (job.type) {
    case 'application.received':
    case 'application.decided':
      return resolveApplicationNotification(db, job);
    case 'team.member_joined':
      return resolveTeamNotification(db, job);
    default:
      return resolveMatchNotification(db, job, now);
  }
}
