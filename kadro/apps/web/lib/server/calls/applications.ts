import {
  type Application,
  type CreateApplicationRequest,
  type DecideApplicationRequest,
  type ListApplicationsQuery,
  type Paginated,
} from '@kadro/contracts';
import {
  matches,
  matchRsvps,
  openCallApplications,
  openCalls,
  type Transaction,
  users,
} from '@kadro/db';
import { and, eq, sql } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { defineKeyset, openPage } from '../domain/pagination';
import { loadApplicationRelation, loadOpenCallRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { notifyApplicationDecided, notifyApplicationReceived } from '../jobs/notify';
import { mediaUrlBuilder } from '../uploads/urls';
import {
  actorIdOf,
  type CallRequest,
  callChain,
  confirmedCount,
  isParticipant,
  lockApplication,
  lockCall,
  teamStaffIds,
} from './context';
import { endOpenCall } from './lifecycle';
import { APPLICATION_COLUMNS, loadApplication, toApplication } from './projections';

/**
 * Applications to open calls (authorization matrix §3.5 footnotes 20–22 and 33; ADR-0003,
 * ADR-0010, ADR-0013, ADR-0037, ADR-0041).
 */

/** `GET open-calls/:id/applications`: oldest first, ties by id (ADR-0039, ADR-0041). */
const APPLICATIONS = defineKeyset('open-calls.applications', [
  { column: openCallApplications.createdAt, type: 'timestamp' },
  { column: openCallApplications.id, type: 'uuid' },
]);

interface CallState {
  readonly callStatus: string;
  readonly expiresAt: Date;
  readonly missingCount: number;
  readonly matchStatus: string;
  readonly startsAt: Date;
  readonly slots: number;
}

async function loadCallState(tx: Transaction, openCallId: string): Promise<CallState> {
  const [row] = await tx
    .select({
      callStatus: openCalls.status,
      expiresAt: openCalls.expiresAt,
      missingCount: openCalls.missingCount,
      matchStatus: matches.status,
      startsAt: matches.startsAt,
      slots: matches.slots,
    })
    .from(openCalls)
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .where(eq(openCalls.id, openCallId))
    .limit(1);
  if (row === undefined) {
    throw new ApiError('not_found');
  }
  return row;
}

/** ADR-0003 rule 2: the call is `open` and unexpired. */
function assertCallOpen(state: CallState, now: Date): void {
  if (state.callStatus !== 'open' || state.expiresAt.getTime() <= now.getTime()) {
    throw new ApiError('call_closed');
  }
}

/** ADR-0003 rule 3: the match is `open` and has not started. */
function assertMatchOpen(state: CallState, now: Date): void {
  if (state.matchStatus !== 'open' || state.startsAt.getTime() <= now.getTime()) {
    throw new ApiError('match_not_open');
  }
}

/**
 * `POST open-calls/:id/applications` (verified email, group O; footnote 20). Members of the
 * match's team and match guests get 409 `already_participant` from the policy; any other holder
 * of an RSVP on the match gets the same code from the state check. A second application by the
 * same user to the same call fails on the unique constraint (409 `already_applied`, ADR-0010),
 * whatever the status of the first. The call's staff are notified (coalesced per call and
 * recipient, ADR-0031) in the same transaction.
 */
export async function createApplication(
  { ctx, runtime }: CallRequest,
  openCallId: string,
  body: CreateApplicationRequest,
): Promise<Application> {
  const actorId = actorIdOf(ctx);
  const chain = await callChain(runtime.db, openCallId);
  if (chain === null) {
    throw new ApiError('not_found');
  }
  return runtime.db.transaction(async (tx) => {
    await lockCall(tx, chain);
    const relation = await loadOpenCallRelation(tx, actorId, openCallId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('application.create', relation.facts);

    const now = runtime.now();
    const state = await loadCallState(tx, openCallId);
    assertCallOpen(state, now);
    assertMatchOpen(state, now);
    if (await isParticipant(tx, chain.teamId, chain.matchId, actorId)) {
      throw new ApiError('already_participant');
    }

    const [application] = await tx
      .insert(openCallApplications)
      .values({ openCallId, userId: actorId, message: body.message ?? null, status: 'pending' })
      .returning({ id: openCallApplications.id });
    if (application === undefined) {
      throw new Error('application insert returned no row');
    }
    await notifyApplicationReceived(runtime.jobs, tx, {
      openCallId,
      applicationId: application.id,
      recipientIds: await teamStaffIds(tx, chain.teamId),
      now,
    });
    return loadApplication(tx, application.id, mediaUrlBuilder(runtime.env));
  });
}

/**
 * `GET open-calls/:id/applications` (footnote 33, ADR-0041): staff of the call's team list every
 * application, an applicant only their own row (`rows: 'own'` from the policy), everyone else
 * gets the 404 of an unknown call before any application is read. Allowed in every call state.
 */
export async function listApplications(
  { ctx, runtime }: CallRequest,
  openCallId: string,
  query: ListApplicationsQuery,
): Promise<Paginated<Application>> {
  const actorId = actorIdOf(ctx);
  const db = runtime.db;
  const relation = await loadOpenCallRelation(db, actorId, openCallId);
  if (relation === null) {
    throw new ApiError('not_found');
  }
  // Every fact goes to the policy unchanged: an applicant who is also staff is decided by the
  // policy's precedence, never by the handler dropping one of the two relationships.
  const decision = await ctx.authorize('application.list', relation.facts);
  // Fail closed: anything but an explicit `all` scope lists the actor's own row only.
  const rows = decision.rows === 'all' ? 'all' : 'own';
  const page = openPage(
    APPLICATIONS,
    {
      cursor: query.cursor,
      limit: query.limit,
      filters: {
        openCallId,
        status: query.status,
        rows,
        actor: rows === 'own' ? actorId : null,
      },
    },
    runtime.keyedHash,
  );
  const result = await db
    .select({ ...APPLICATION_COLUMNS, pageKey: page.key })
    .from(openCallApplications)
    .innerJoin(users, eq(users.id, openCallApplications.userId))
    .where(
      and(
        eq(openCallApplications.openCallId, openCallId),
        rows === 'own' ? eq(openCallApplications.userId, actorId) : undefined,
        query.status === undefined ? undefined : eq(openCallApplications.status, query.status),
        page.where,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  const media = mediaUrlBuilder(runtime.env);
  return page.finish(result, (row) => toApplication(row, media));
}

/**
 * `PATCH open-calls/:id/applications/:appId` (footnotes 21, 22; ADR-0003, ADR-0013).
 *
 * Order (matrix §2): the call chain is locked (team, match, call, application); the call is the
 * parent (unknown → 404); the application is loaded inside it by `id` and `open_call_id` together
 * with the actor's relationship in one query; `can()` decides (`application.decide` for
 * `accepted` / `rejected`, `application.withdraw` for `withdrawn`); a missing application answers
 * 404 after authorizing on the parent as an unrelated applicant; then the state preconditions.
 *
 * `accepted` (ADR-0003): application `pending`, call `open` and unexpired, match `open` and in the
 * future, applicant neither a team member nor holding an RSVP, a free slot. It adds the applicant
 * as RSVP `in` (a match guest, never waitlisted, ADR-0035), decrements `missing_count`, and closes
 * the call when it reaches 0 or the match is full, rejecting the remaining pending applications.
 * `rejected`: application `pending`, call `open` and unexpired. `withdrawn`: application `pending`.
 */
export async function decideApplication(
  { ctx, runtime }: CallRequest,
  openCallId: string,
  applicationId: string,
  body: DecideApplicationRequest,
): Promise<Application> {
  const actorId = actorIdOf(ctx);
  const action = body.status === 'withdrawn' ? 'application.withdraw' : 'application.decide';
  const chain = await callChain(runtime.db, openCallId);
  if (chain === null) {
    throw new ApiError('not_found');
  }
  return runtime.db.transaction(async (tx) => {
    await lockCall(tx, chain);
    await lockApplication(tx, openCallId, applicationId);
    const parent = await loadOpenCallRelation(tx, actorId, openCallId);
    if (parent === null) {
      throw new ApiError('not_found');
    }
    const target = await loadApplicationRelation(tx, actorId, openCallId, applicationId);
    if (target === null) {
      await ctx.authorize(action, { ...parent.facts, isApplicant: false });
      throw new ApiError('not_found');
    }
    await ctx.authorize(action, target.facts);

    if (target.status !== 'pending') {
      throw new ApiError('application_not_pending');
    }
    const now = runtime.now();
    const state = await loadCallState(tx, openCallId);

    if (body.status === 'withdrawn') {
      await setStatus(tx, applicationId, 'withdrawn');
      await recordAudit(tx, runtime.keyedHash, {
        actorId,
        action: 'application.withdrawn',
        targetType: 'open_call_application',
        targetId: applicationId,
        ip: ctx.ip,
        metadata: { openCallId },
      });
      return loadApplication(tx, applicationId, mediaUrlBuilder(runtime.env));
    }

    assertCallOpen(state, now);
    if (body.status === 'rejected') {
      await setStatus(tx, applicationId, 'rejected');
      await notifyApplicationDecided(runtime.jobs, tx, {
        applicationId,
        applicantId: target.applicantId,
      });
      await recordAudit(tx, runtime.keyedHash, {
        actorId,
        action: 'application.rejected',
        targetType: 'open_call_application',
        targetId: applicationId,
        ip: ctx.ip,
        metadata: { openCallId },
      });
      return loadApplication(tx, applicationId, mediaUrlBuilder(runtime.env));
    }

    assertMatchOpen(state, now);
    if (await isParticipant(tx, chain.teamId, chain.matchId, target.applicantId)) {
      throw new ApiError('already_participant');
    }
    const confirmed = await confirmedCount(tx, chain.matchId);
    if (confirmed >= state.slots) {
      throw new ApiError('match_full');
    }

    await tx
      .insert(matchRsvps)
      .values({ matchId: chain.matchId, userId: target.applicantId, status: 'in' });
    await setStatus(tx, applicationId, 'accepted');
    const [call] = await tx
      .update(openCalls)
      .set({ missingCount: sql`greatest(${openCalls.missingCount} - 1, 0)` })
      .where(eq(openCalls.id, openCallId))
      .returning({ missingCount: openCalls.missingCount });
    const filled = (call?.missingCount ?? 0) === 0 || confirmed + 1 >= state.slots;
    const closed = filled ? await endOpenCall(tx, runtime.jobs, openCallId, 'closed') : null;
    await notifyApplicationDecided(runtime.jobs, tx, {
      applicationId,
      applicantId: target.applicantId,
    });
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'application.accepted',
      targetType: 'open_call_application',
      targetId: applicationId,
      ip: ctx.ip,
      metadata: {
        openCallId,
        matchId: chain.matchId,
        callClosed: closed?.ended ?? false,
        rejected: closed?.rejected ?? 0,
      },
    });
    return loadApplication(tx, applicationId, mediaUrlBuilder(runtime.env));
  });
}

async function setStatus(
  tx: Transaction,
  applicationId: string,
  status: 'accepted' | 'rejected' | 'withdrawn',
): Promise<void> {
  await tx
    .update(openCallApplications)
    .set({ status })
    .where(
      and(eq(openCallApplications.id, applicationId), eq(openCallApplications.status, 'pending')),
    );
}
