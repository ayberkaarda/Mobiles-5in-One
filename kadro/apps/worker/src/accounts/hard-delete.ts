import { type AccountHardDeleteJob } from '@kadro/contracts';
import {
  type Database,
  type ExternalCleanupTarget,
  type Transaction,
  auditLogs,
  deletionRequests,
  matchRsvps,
  matches,
  mvpVotes,
  newId,
  openCallApplications,
  subscriptions,
  teamMembers,
  teams,
  users,
  venueReviews,
  venues,
} from '@kadro/db';
import { EmailDeliveryError, type EmailTransport } from '@kadro/emails';
import { and, asc, count, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';

import { type Clock, SECOND_MS } from '../clock.js';
import { enqueue } from '../enqueue.js';
import { insertReceipt } from '../idempotency.js';
import { type JobContext } from '../job-runner.js';
import { type Metrics } from '../metrics.js';
import { type Buckets, type ObjectStorage, deletePrefix } from '../storage/storage.js';
import { avatarPrefixes, badgePrefixes } from '../uploads/keys.js';
import { deletionCompletedMessage } from './completion-email.js';

const QUEUE = 'account.hard_delete';

/** ADR-0033: display name and address shape of a tombstone. */
export const TOMBSTONE_DISPLAY_NAME = 'Silinmiş oyuncu';
export function tombstoneEmail(tombstoneId: string): string {
  return `deleted+${tombstoneId}@deleted.invalid`;
}

/** The confirmation email must not hold the commit longer than this (ADR-0032). */
export const COMPLETION_EMAIL_TIMEOUT_MS = 10 * SECOND_MS;

export interface HardDeleteDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly storage: ObjectStorage;
  readonly buckets: Buckets;
  readonly emailTransport: EmailTransport;
  readonly webOrigin: string;
  readonly clock: Clock;
  readonly metrics: Metrics;
}

export interface HardDeleteSummary {
  readonly teamsDeleted: number;
  readonly teamsTransferred: number;
  readonly objectsDeleted: number;
}

type Eligibility =
  | { readonly due: true; readonly userId: string }
  | { readonly due: false; readonly outcome: string };

/** ADR-0032 preconditions: pending request, grace period over, account still deactivated. */
async function eligibility(
  executor: Database | Transaction,
  deletionRequestId: string,
  now: Date,
  lock: boolean,
): Promise<Eligibility> {
  const query = executor
    .select()
    .from(deletionRequests)
    .where(eq(deletionRequests.id, deletionRequestId));
  const [request] = lock ? await query.for('update') : await query;
  if (request === undefined) {
    return { due: false, outcome: 'skipped_missing' };
  }
  if (request.completedAt !== null) {
    return { due: false, outcome: 'skipped_completed' };
  }
  if (request.graceUntil.getTime() > now.getTime()) {
    return { due: false, outcome: 'skipped_grace_period' };
  }
  if (request.userId === null) {
    return { due: false, outcome: 'skipped_missing' };
  }
  const [user] = await executor
    .select({ deactivatedAt: users.deactivatedAt, isTombstone: users.isTombstone })
    .from(users)
    .where(eq(users.id, request.userId));
  if (user === undefined || user.isTombstone || user.deactivatedAt === null) {
    return { due: false, outcome: 'skipped_cancelled' };
  }
  return { due: true, userId: request.userId };
}

interface CaptainedTeam {
  readonly teamId: string;
  /** No other member: deleted by step 3 of ADR-0032, its badge objects removed first. */
  readonly solo: boolean;
}

/**
 * Locks every team the user captains (`FOR UPDATE`, id order; lock order team → match) and decides
 * solo or shared under that lock. Joining a team takes a key-share lock on its row, so nobody can
 * join a team between this decision and the commit.
 */
async function lockCaptainedTeams(tx: Transaction, userId: string): Promise<CaptainedTeam[]> {
  const captained = await tx
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.role, 'captain')))
    .orderBy(asc(teamMembers.teamId));
  const result: CaptainedTeam[] = [];
  for (const { teamId } of captained) {
    await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for('update');
    const [others] = await tx
      .select({ value: count() })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.userId, userId)));
    result.push({ teamId, solo: (others?.value ?? 0) === 0 });
  }
  return result;
}

/** Pro entitlement (matrix §7): an active or grace-period subscription that has not expired. */
async function isPro(tx: Transaction, userId: string, now: Date): Promise<boolean> {
  const [row] = await tx
    .select({ value: count() })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, ['active', 'grace_period']),
        or(isNull(subscriptions.expiresAt), gt(subscriptions.expiresAt, now)),
      ),
    );
  return (row?.value ?? 0) > 0;
}

/**
 * Promotes waitlisted RSVPs while confirmed players are fewer than `slots` (ADR-0035), with one
 * `rsvp.promoted` push per promoted player. The caller holds the match row lock.
 */
async function promoteWaitlist(
  tx: Transaction,
  boss: PgBoss,
  match: { readonly id: string; readonly slots: number },
  now: Date,
): Promise<void> {
  const [confirmedRow] = await tx
    .select({ value: count() })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, match.id), eq(matchRsvps.status, 'in')));
  let confirmed = confirmedRow?.value ?? 0;
  while (confirmed < match.slots) {
    const [next] = await tx
      .select({ id: matchRsvps.id, userId: matchRsvps.userId })
      .from(matchRsvps)
      .where(and(eq(matchRsvps.matchId, match.id), eq(matchRsvps.status, 'waitlist')))
      .orderBy(asc(matchRsvps.waitlistedAt), asc(matchRsvps.id))
      .limit(1);
    if (next === undefined) {
      return;
    }
    await tx
      .update(matchRsvps)
      .set({ status: 'in', waitlistedAt: null, updatedAt: now })
      .where(eq(matchRsvps.id, next.id));
    await enqueue(
      boss,
      'push.send',
      {
        type: 'rsvp.promoted',
        userId: next.userId,
        refId: match.id,
        idempotencyKey: `push:promoted:${match.id}:${next.userId}:${Math.floor(now.getTime() / SECOND_MS)}`,
      },
      { tx },
    );
    confirmed += 1;
  }
}

/** ADR-0032 step 3: transfer captaincy of shared teams, delete solo teams. */
async function settleTeams(
  tx: Transaction,
  userId: string,
  now: Date,
  captained: readonly CaptainedTeam[],
): Promise<{ deleted: number; transferred: number }> {
  let deleted = 0;
  let transferred = 0;
  for (const { teamId, solo } of captained) {
    if (solo) {
      await tx.delete(teams).where(eq(teams.id, teamId));
      deleted += 1;
      continue;
    }
    // Oldest co-captain first, else the oldest member (ADR-0008 routine, ADR-0032).
    const [successor] = await tx
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.userId, userId)))
      .orderBy(
        sql`case when ${teamMembers.role} = 'co_captain' then 0 else 1 end`,
        asc(teamMembers.joinedAt),
        asc(teamMembers.id),
      )
      .limit(1);
    if (successor === undefined) {
      // Every other member left after the decision (leaving does not lock the team row): the
      // team goes; its badge objects are unreferenced now and maintenance.sweep removes them.
      await tx.delete(teams).where(eq(teams.id, teamId));
      deleted += 1;
      continue;
    }
    // The leaving captain's row goes first: the partial unique index allows one captain per team.
    await tx
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    await tx
      .update(teamMembers)
      .set({ role: 'captain', updatedAt: now })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, successor.userId)));
    // The free-tier owned-team limit never blocks this transfer; the team is locked instead.
    const [owned] = await tx
      .select({ value: count() })
      .from(teams)
      .where(and(eq(teams.ownerId, successor.userId), ne(teams.id, teamId)));
    const locked = (owned?.value ?? 0) >= 1 && !(await isPro(tx, successor.userId, now));
    await tx
      .update(teams)
      .set({
        ownerId: successor.userId,
        ...(locked ? { isProLocked: true } : {}),
        updatedAt: now,
      })
      .where(eq(teams.id, teamId));
    await tx.insert(auditLogs).values({
      actorId: null,
      action: 'team.captaincyTransfer',
      targetType: 'team',
      targetId: teamId,
      metadata: { reason: 'account_deleted', newCaptainId: successor.userId, proLocked: locked },
    });
    transferred += 1;
  }
  return { deleted, transferred };
}

/**
 * ADR-0032 step 4: memberships and RSVPs on matches that are not history yet. Every match the user
 * has an RSVP on is locked first (id order) and its status read under the lock, so a match that
 * becomes `played` concurrently keeps the RSVP for the tombstone.
 */
async function leaveMatches(tx: Transaction, boss: PgBoss, userId: string, now: Date) {
  await tx.delete(teamMembers).where(eq(teamMembers.userId, userId));
  const rsvpMatches = await tx
    .select({ matchId: matchRsvps.matchId })
    .from(matchRsvps)
    .where(eq(matchRsvps.userId, userId));
  if (rsvpMatches.length === 0) {
    return;
  }
  const locked = await tx
    .select({ id: matches.id, slots: matches.slots, status: matches.status })
    .from(matches)
    .where(
      inArray(
        matches.id,
        rsvpMatches.map((row) => row.matchId),
      ),
    )
    .orderBy(asc(matches.id))
    .for('update');
  const live = locked.filter(
    (match) => match.status === 'draft' || match.status === 'open' || match.status === 'locked',
  );
  if (live.length === 0) {
    return;
  }
  const removed = await tx
    .delete(matchRsvps)
    .where(
      and(
        eq(matchRsvps.userId, userId),
        inArray(
          matchRsvps.matchId,
          live.map((match) => match.id),
        ),
      ),
    )
    .returning({ matchId: matchRsvps.matchId, status: matchRsvps.status });
  const freed = new Set(removed.filter((row) => row.status === 'in').map((row) => row.matchId));
  for (const match of live) {
    if (freed.has(match.id) && (match.status === 'open' || match.status === 'locked')) {
      await promoteWaitlist(tx, boss, match, now);
    }
  }
}

/** ADR-0033: one tombstone per deleted account, holding its remaining match history. */
async function repointHistory(tx: Transaction, userId: string, now: Date): Promise<boolean> {
  const [rsvps] = await tx
    .select({ value: count() })
    .from(matchRsvps)
    .where(eq(matchRsvps.userId, userId));
  const [votes] = await tx
    .select({ value: count() })
    .from(mvpVotes)
    .where(or(eq(mvpVotes.voterId, userId), eq(mvpVotes.voteeId, userId)));
  if ((rsvps?.value ?? 0) === 0 && (votes?.value ?? 0) === 0) {
    return false;
  }
  const tombstoneId = newId();
  await tx.insert(users).values({
    id: tombstoneId,
    email: tombstoneEmail(tombstoneId),
    displayName: TOMBSTONE_DISPLAY_NAME,
    passwordHash: null,
    emailVerifiedAt: null,
    deactivatedAt: now,
    isTombstone: true,
  });
  await tx
    .update(matchRsvps)
    .set({ userId: tombstoneId, updatedAt: now })
    .where(eq(matchRsvps.userId, userId));
  await tx
    .update(mvpVotes)
    .set({ voterId: tombstoneId, updatedAt: now })
    .where(eq(mvpVotes.voterId, userId));
  await tx
    .update(mvpVotes)
    .set({ voteeId: tombstoneId, updatedAt: now })
    .where(eq(mvpVotes.voteeId, userId));
  return true;
}

/**
 * `account.hard_delete` (ADR-0032, ADR-0033). One transaction: the request, user and captained
 * team rows are locked and the solo/shared decision is taken under those locks; external objects
 * are deleted next, before any database change; then every personal-data row is removed. The
 * confirmation email goes out before the commit without blocking it. Runs only for a pending
 * request whose grace period is over.
 */
export function createHardDeleteHandler(dependencies: HardDeleteDependencies) {
  const { db, boss, storage, buckets, emailTransport, webOrigin, clock, metrics } = dependencies;

  return async (job: AccountHardDeleteJob, context: JobContext): Promise<string> => {
    const precheck = await eligibility(db, job.deletionRequestId, clock.now(), false);
    if (!precheck.due) {
      return precheck.outcome;
    }
    const { userId } = precheck;

    const result = await db.transaction(async (tx) => {
      const now = clock.now();
      const check = await eligibility(tx, job.deletionRequestId, now, true);
      if (!check.due) {
        return { done: false as const, outcome: check.outcome };
      }
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (user === undefined) {
        return { done: false as const, outcome: 'skipped_missing' };
      }

      // Decisions under locks (request → user → teams → matches), then object storage before any
      // database change. A storage failure rolls the transaction back and the job retries; the
      // deletes are idempotent.
      const captained = await lockCaptainedTeams(tx, userId);
      let objectsDeleted = 0;
      const avatar = avatarPrefixes(userId);
      objectsDeleted += await deletePrefix(storage, buckets.media, avatar.media);
      objectsDeleted += await deletePrefix(storage, buckets.incoming, avatar.incoming);
      for (const team of captained.filter((entry) => entry.solo)) {
        const badge = badgePrefixes(team.teamId);
        objectsDeleted += await deletePrefix(storage, buckets.media, badge.media);
        objectsDeleted += await deletePrefix(storage, buckets.incoming, badge.incoming);
      }

      const teamsResult = await settleTeams(tx, userId, now, captained);
      await leaveMatches(tx, boss, userId, now);
      const tombstone = await repointHistory(tx, userId, now);

      await tx.delete(venueReviews).where(eq(venueReviews.userId, userId));
      await tx.delete(openCallApplications).where(eq(openCallApplications.userId, userId));
      await tx
        .update(venues)
        .set({ createdBy: null, updatedAt: now })
        .where(eq(venues.createdBy, userId));

      // RevenueCat is reconciled by the Phase 5 job; record that a cleanup is owed.
      const [subscription] = await tx
        .select({ value: count() })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId));
      const externalPending: ExternalCleanupTarget[] =
        (subscription?.value ?? 0) > 0 ? ['revenuecat'] : [];

      // Cascades remove refresh, email and push tokens, subscriptions and uploads; audit actor
      // and deletion request references become NULL.
      await tx.delete(users).where(eq(users.id, userId));

      const summary: HardDeleteSummary = {
        teamsDeleted: teamsResult.deleted,
        teamsTransferred: teamsResult.transferred,
        objectsDeleted,
      };
      await tx
        .update(deletionRequests)
        .set({ completedAt: now, externalPending, updatedAt: now })
        .where(eq(deletionRequests.id, job.deletionRequestId));
      await tx.insert(auditLogs).values({
        actorId: null,
        action: 'account.deleted',
        targetType: 'deletion_request',
        targetId: job.deletionRequestId,
        metadata: { ...summary },
      });
      await insertReceipt(tx, QUEUE, job.idempotencyKey);

      // Confirmation before commit (the address is gone afterwards); never blocks the deletion.
      const message = deletionCompletedMessage({
        origin: webOrigin,
        displayName: user.displayName,
      });
      try {
        await emailTransport.send(
          { kind: 'deletion_completed', to: user.email, ...message },
          AbortSignal.timeout(COMPLETION_EMAIL_TIMEOUT_MS),
        );
      } catch (error) {
        metrics.increment('email_delivery_failed', {
          kind: 'deletion_completed',
          reason: error instanceof EmailDeliveryError ? error.reason : 'unknown',
        });
      }
      return { done: true as const, summary, tombstone };
    });

    if (!result.done) {
      return result.outcome;
    }
    context.logger.info({ ...result.summary, tombstone: result.tombstone }, 'account deleted');
    return 'deleted';
  };
}
