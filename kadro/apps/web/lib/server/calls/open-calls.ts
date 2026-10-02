import {
  type ListOpenCallsQuery,
  LIMITS,
  type OpenCall,
  type OpenCallPublic,
  type Paginated,
  type PublishOpenCallRequest,
} from '@kadro/contracts';
import { districts, matches, openCalls, teams, venues } from '@kadro/db';
import { and, eq, exists, gt, gte, isNull, lte, or, type SQL } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { defineKeyset, openPage } from '../domain/pagination';
import { type DbReader, loadMatchRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { assertDistrictExists } from '../teams/projections';
import { validationError } from '../validate';
import { actorIdOf, type CallRequest, confirmedCount, lockMatch, matchTeamId } from './context';
import { endOpenCall } from './lifecycle';
import { loadOpenCall, OPEN_CALL_COLUMNS, toOpenCall } from './projections';

/**
 * Open calls ("Eksik Var", product spec §3 story 6; authorization matrix §3.5 footnotes 18, 19,
 * 30; ADR-0037). Writes follow matrix §2: the call chain is locked (team, then match), the
 * relationship is loaded under the locks, `ctx.authorize()` decides, then the state preconditions
 * (409) are checked and the write, its audit row and its jobs commit in one transaction.
 */

/** `GET open-calls`: sorted by the match start, ties by call id (ADR-0039). */
const OPEN_CALLS = defineKeyset('open-calls', [
  { column: matches.startsAt, type: 'timestamp' },
  { column: openCalls.id, type: 'uuid' },
]);

/** A district id of a list filter must exist (ADR-0039); `field` names the query parameter. */
async function assertQueryDistrict(db: DbReader, districtId: string): Promise<void> {
  const [row] = await db
    .select({ id: districts.id })
    .from(districts)
    .where(eq(districts.id, districtId))
    .limit(1);
  if (row === undefined) {
    throw validationError('query', 'not_found', 'district');
  }
}

/** A province (il slug) of a list filter must exist. */
async function assertQueryProvince(db: DbReader, province: string): Promise<void> {
  const [row] = await db
    .select({ id: districts.id })
    .from(districts)
    .where(eq(districts.ilSlug, province))
    .limit(1);
  if (row === undefined) {
    throw validationError('query', 'not_found', 'province');
  }
}

/**
 * District condition shared by the public lists: one district id, or every district of a
 * province.
 */
export async function districtFilter(
  db: DbReader,
  column: typeof openCalls.districtId | typeof venues.districtId,
  query: { readonly district?: string | undefined; readonly province?: string | undefined },
): Promise<SQL | undefined> {
  if (query.district !== undefined) {
    await assertQueryDistrict(db, query.district);
    return eq(column, query.district);
  }
  if (query.province !== undefined) {
    await assertQueryProvince(db, query.province);
    const province = query.province;
    return exists(
      db
        .select({ id: districts.id })
        .from(districts)
        .where(and(eq(districts.id, column), eq(districts.ilSlug, province))),
    );
  }
  return undefined;
}

interface PublicCallRow {
  readonly id: string;
  readonly districtId: string;
  readonly startsAt: Date;
  readonly format: OpenCallPublic['format'];
  readonly missingCount: number;
  readonly position: OpenCallPublic['position'];
  readonly level: OpenCallPublic['level'];
  readonly venueName: string | null;
  readonly venueSlug: string | null;
  readonly teamName: string;
  readonly expiresAt: Date;
  readonly pageKey: (string | null)[];
}

function toPublicCall(row: PublicCallRow): OpenCallPublic {
  return {
    id: row.id,
    districtId: row.districtId,
    startsAt: row.startsAt.toISOString(),
    format: row.format,
    missingCount: row.missingCount,
    position: row.position,
    level: row.level,
    venue:
      row.venueName === null || row.venueSlug === null
        ? null
        : { name: row.venueName, slug: row.venueSlug },
    teamName: row.teamName,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * `GET open-calls` (public, footnote 18): only calls that are `open` and unexpired on matches that
 * are `open` and still in the future, whatever the expiry job has stored so far. The projection
 * names the team and, for verified directory venues only, the venue; never a person, the RSVP
 * list, the fee or a free-text venue address. A `position` filter also returns calls open to any
 * position (`position: null`).
 */
export async function listOpenCalls(
  { ctx, runtime }: CallRequest,
  query: ListOpenCallsQuery,
): Promise<Paginated<OpenCallPublic>> {
  await ctx.authorize('opencall.list');
  const db = runtime.db;
  const now = runtime.now();
  const page = openPage(
    OPEN_CALLS,
    {
      cursor: query.cursor,
      limit: query.limit,
      filters: {
        district: query.district,
        province: query.province,
        level: query.level,
        position: query.position,
        from: query.from,
        to: query.to,
      },
    },
    runtime.keyedHash,
  );
  const conditions: (SQL | undefined)[] = [
    eq(openCalls.status, 'open'),
    gt(openCalls.expiresAt, now),
    eq(matches.status, 'open'),
    gt(matches.startsAt, now),
    await districtFilter(db, openCalls.districtId, query),
    query.level === undefined ? undefined : eq(openCalls.level, query.level),
    query.position === undefined
      ? undefined
      : or(eq(openCalls.position, query.position), isNull(openCalls.position)),
    query.from === undefined ? undefined : gte(matches.startsAt, new Date(query.from)),
    query.to === undefined ? undefined : lte(matches.startsAt, new Date(query.to)),
    page.where,
  ];
  const rows = await db
    .select({
      id: openCalls.id,
      districtId: openCalls.districtId,
      startsAt: matches.startsAt,
      format: matches.format,
      missingCount: openCalls.missingCount,
      position: openCalls.position,
      level: openCalls.level,
      venueName: venues.name,
      venueSlug: venues.slug,
      teamName: teams.name,
      expiresAt: openCalls.expiresAt,
      pageKey: page.key,
    })
    .from(openCalls)
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .leftJoin(venues, and(eq(venues.id, matches.venueId), eq(venues.verified, true)))
    .where(and(...conditions))
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, toPublicCall);
}

const MIN_LIFETIME_MS = LIMITS.openCallMinLifetimeSeconds * 1_000;

/**
 * `POST matches/:id/open-call` (captain, co-captain; footnote 19, ADR-0037). Preconditions, in
 * this order: match `open` and in the future (409 `match_not_open`); no other live call
 * (409 `open_call_exists`; a call still stored as `open` whose `expires_at` passed is ended as
 * `expired` first, so its applicants are answered and a new call may follow);
 * `1 ≤ missingCount ≤ slots − confirmed` (409 `invalid_missing_count`);
 * `now + 15 min ≤ expiresAt ≤ starts_at` (409 `invalid_call_expiry`). The district defaults to the
 * directory venue's, else the team's. Two concurrent publishes are serialized by the match lock,
 * and the partial unique index `open_calls_one_open_per_match_key` backs the rule (409).
 */
export async function publishOpenCall(
  { ctx, runtime }: CallRequest,
  matchId: string,
  body: PublishOpenCallRequest,
): Promise<OpenCall> {
  const actorId = actorIdOf(ctx);
  const teamId = await matchTeamId(runtime.db, matchId);
  if (teamId === null) {
    throw new ApiError('not_found');
  }
  return runtime.db.transaction(async (tx) => {
    await lockMatch(tx, teamId, matchId);
    const relation = await loadMatchRelation(tx, actorId, matchId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('opencall.publish', relation.facts);

    const now = runtime.now();
    const [match] = await tx
      .select({
        status: matches.status,
        startsAt: matches.startsAt,
        slots: matches.slots,
        venueDistrictId: venues.districtId,
        teamDistrictId: teams.districtId,
      })
      .from(matches)
      .innerJoin(teams, eq(teams.id, matches.teamId))
      .leftJoin(venues, eq(venues.id, matches.venueId))
      .where(eq(matches.id, matchId))
      .limit(1);
    if (match === undefined) {
      throw new ApiError('not_found');
    }
    if (match.status !== 'open' || match.startsAt.getTime() <= now.getTime()) {
      throw new ApiError('match_not_open');
    }

    const [live] = await tx
      .select({ id: openCalls.id, expiresAt: openCalls.expiresAt })
      .from(openCalls)
      .where(and(eq(openCalls.matchId, matchId), eq(openCalls.status, 'open')))
      .for('update');
    if (live !== undefined) {
      if (live.expiresAt.getTime() > now.getTime()) {
        throw new ApiError('open_call_exists');
      }
      await endOpenCall(tx, runtime.jobs, live.id, 'expired');
    }

    const free = match.slots - (await confirmedCount(tx, matchId));
    if (body.missingCount < 1 || body.missingCount > free) {
      throw new ApiError('invalid_missing_count');
    }
    const expiresAt = new Date(body.expiresAt);
    if (
      expiresAt.getTime() < now.getTime() + MIN_LIFETIME_MS ||
      expiresAt.getTime() > match.startsAt.getTime()
    ) {
      throw new ApiError('invalid_call_expiry');
    }

    let districtId = match.venueDistrictId ?? match.teamDistrictId;
    if (body.districtId !== undefined) {
      await assertDistrictExists(tx, body.districtId);
      districtId = body.districtId;
    }

    const [call] = await tx
      .insert(openCalls)
      .values({
        matchId,
        missingCount: body.missingCount,
        position: body.position,
        level: body.level,
        districtId,
        status: 'open',
        expiresAt,
      })
      .returning(OPEN_CALL_COLUMNS);
    if (call === undefined) {
      throw new Error('open call insert returned no row');
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'opencall.published',
      targetType: 'open_call',
      targetId: call.id,
      ip: ctx.ip,
      metadata: { matchId, missingCount: call.missingCount },
    });
    return toOpenCall(call);
  });
}

/**
 * `PATCH matches/:id/open-call` with `status: 'closed'` (captain, co-captain; footnote 30). Ends
 * the match's `open` call and rejects its pending applications in the same transaction, with one
 * `application.decided` push per applicant. No open call → 404.
 */
export async function closeMatchOpenCall(
  { ctx, runtime }: CallRequest,
  matchId: string,
): Promise<OpenCall> {
  const actorId = actorIdOf(ctx);
  const teamId = await matchTeamId(runtime.db, matchId);
  if (teamId === null) {
    throw new ApiError('not_found');
  }
  return runtime.db.transaction(async (tx) => {
    await lockMatch(tx, teamId, matchId);
    const relation = await loadMatchRelation(tx, actorId, matchId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('opencall.close', relation.facts);
    const [call] = await tx
      .select({ id: openCalls.id })
      .from(openCalls)
      .where(and(eq(openCalls.matchId, matchId), eq(openCalls.status, 'open')))
      .for('update');
    if (call === undefined) {
      throw new ApiError('not_found');
    }
    const ended = await endOpenCall(tx, runtime.jobs, call.id, 'closed');
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'opencall.closed',
      targetType: 'open_call',
      targetId: call.id,
      ip: ctx.ip,
      metadata: { matchId, rejected: ended.rejected },
    });
    return loadOpenCall(tx, call.id);
  });
}
