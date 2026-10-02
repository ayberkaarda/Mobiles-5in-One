import { randomBytes } from 'node:crypto';

import {
  type CreateVenueRequest,
  foldTr,
  type ListVenuesQuery,
  LIMITS,
  type Paginated,
  type VenueDetail,
  type VenueSummary,
} from '@kadro/contracts';
import { districts, type Transaction, venues } from '@kadro/db';
import { and, eq, like, or, type SQL } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { districtFilter } from '../calls/open-calls';
import { defineKeyset, openPage } from '../domain/pagination';
import { loadVenueRelation } from '../domain/relations';
import { ApiError, findPgError, SQLSTATE } from '../errors';
import { type RequestContext } from '../http';
import { type ServerRuntime } from '../runtime';
import { actorIdOf } from '../teams/context';
import { validationError } from '../validate';
import { loadVenueDetail, toVenueSummary, venueSummaryColumns } from './projections';

/**
 * Venue directory (Saha Rehberi; product spec §3 story 7, authorization matrix §3.6, §4.5,
 * footnote 23, ADR-0038, ADR-0039). Verified and sample venues are public; an unverified venue is
 * visible to its creator only, in lists and by slug alike.
 */

export interface VenueRequest {
  readonly ctx: RequestContext;
  readonly runtime: ServerRuntime;
}

/** `GET venues`: folded name, ties by id (ADR-0039). */
const VENUES = defineKeyset('venues', [
  { column: venues.searchName, type: 'text' },
  { column: venues.id, type: 'uuid' },
]);

/** Marker of seeded demonstration rows (`[ÖRNEK] `), reserved for `is_sample` venues. */
const SAMPLE_PREFIX = foldTr('[ÖRNEK]');

/** Escapes `LIKE` wildcards so a query is matched literally (backslash is the default escape). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Readable venues (matrix §5): verified or sample for everyone, unverified for the creator. */
function readableBy(actorId: string | null): SQL | undefined {
  return or(
    eq(venues.verified, true),
    eq(venues.isSample, true),
    actorId === null ? undefined : eq(venues.createdBy, actorId),
  );
}

/**
 * `GET venues` (public; credentials optional): `district` or `province`, and `q` folded with
 * `foldTr` and matched as a literal substring of `search_name` (trigram index). The actor id is
 * part of the cursor filters because an actor's own unverified venues change the result set.
 */
export async function listVenues(
  { ctx, runtime }: VenueRequest,
  query: ListVenuesQuery,
): Promise<Paginated<VenueSummary>> {
  await ctx.authorize('venue.list');
  const db = runtime.db;
  const actorId = ctx.principal?.userId ?? null;
  let folded: string | undefined;
  if (query.q !== undefined) {
    folded = foldTr(query.q);
    if (folded.length < LIMITS.searchQuery.min) {
      throw validationError('query', 'too_small', 'q');
    }
  }
  const page = openPage(
    VENUES,
    {
      cursor: query.cursor,
      limit: query.limit,
      filters: { district: query.district, province: query.province, q: folded, actor: actorId },
    },
    runtime.keyedHash,
  );
  const rows = await db
    .select({ ...venueSummaryColumns(db), pageKey: page.key })
    .from(venues)
    .where(
      and(
        readableBy(actorId),
        await districtFilter(db, venues.districtId, query),
        folded === undefined ? undefined : like(venues.searchName, `%${escapeLike(folded)}%`),
        page.where,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, toVenueSummary);
}

/** `GET venues/:slug` (public; credentials optional): unverified → 404 except for the creator. */
export async function getVenue({ ctx, runtime }: VenueRequest, slug: string): Promise<VenueDetail> {
  const actorId = ctx.principal?.userId ?? null;
  const relation = await loadVenueRelation(runtime.db, actorId, { slug });
  if (relation === null) {
    throw new ApiError('not_found');
  }
  await ctx.authorize('venue.read', relation.facts);
  return loadVenueDetail(runtime.db, relation.venueId, {
    isCreator: relation.facts.isCreator,
    actorId,
  });
}

const NAME_SLUG_MAX = 50;
const SLUG_MAX = 80;
const SLUG_ATTEMPTS = 5;

function slugPart(text: string): string {
  return foldTr(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Server-generated slug (matrix §4.5): folded name and district slug (`kadikoy-sahasi-kadikoy`);
 * after a collision a random 16-bit suffix is appended. Never derived from client input other
 * than the name.
 */
export function venueSlug(name: string, districtSlug: string, attempt: number): string {
  const base = slugPart(name).slice(0, NAME_SLUG_MAX).replace(/-+$/g, '') || 'saha';
  const stem = `${base}-${districtSlug}`.slice(0, SLUG_MAX - 5).replace(/-+$/g, '');
  return attempt === 0 ? stem : `${stem}-${randomBytes(2).toString('hex')}`;
}

function isSlugCollision(error: unknown): boolean {
  const pgError = findPgError(error);
  return pgError?.code === SQLSTATE.uniqueViolation && pgError.constraint === 'venues_slug_key';
}

async function insertWithSlug(
  tx: Transaction,
  values: Omit<typeof venues.$inferInsert, 'slug'>,
  name: string,
  districtSlug: string,
): Promise<string> {
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    try {
      // Savepoint per attempt: a slug collision rolls back only this insert.
      const [row] = await tx.transaction(async (savepoint) =>
        savepoint
          .insert(venues)
          .values({ ...values, slug: venueSlug(name, districtSlug, attempt) })
          .returning({ id: venues.id }),
      );
      if (row === undefined) {
        throw new Error('venue insert returned no row');
      }
      return row.id;
    } catch (error) {
      if (!isSlugCollision(error)) {
        throw error;
      }
    }
  }
  throw new ApiError('conflict');
}

/**
 * 409 `venue_exists` with the RFC 9457 extension member `existingSlug` of `@kadro/contracts`
 * (ADR-0038): the slug of the existing venue, only when the caller can read that venue (verified,
 * sample, or created by the caller), so an unverified venue of someone else is never disclosed.
 * Thrown to `route()` like any other `ApiError`, which logs the code and writes the body.
 */
export class VenueExistsError extends ApiError {
  constructor(readonly existingSlug: string | null) {
    super('venue_exists', existingSlug === null ? {} : { extensions: { existingSlug } });
  }
}

/**
 * `POST venues` (verified email, group V; footnote 23, ADR-0038). Always `verified = false`,
 * `is_sample = false`, `created_by = actor`; `slug` and `search_name` are derived server-side.
 * The `[ÖRNEK]` prefix marks seeded sample rows and is refused in client names (400). A venue
 * with the same folded name in the same district → 409 `venue_exists`. Creations in one district
 * are serialized by a `FOR NO KEY UPDATE` lock on the district row, which does not block rows
 * that merely reference the district.
 */
export async function createVenue(
  { ctx, runtime }: VenueRequest,
  body: CreateVenueRequest,
): Promise<VenueDetail> {
  await ctx.authorize('venue.create');
  const actorId = actorIdOf(ctx);
  const searchName = foldTr(body.name);
  if (searchName.startsWith(SAMPLE_PREFIX)) {
    throw validationError('body', 'reserved', 'name');
  }
  return runtime.db.transaction(async (tx) => {
    const [district] = await tx
      .select({ id: districts.id, slug: districts.slug })
      .from(districts)
      .where(eq(districts.id, body.districtId))
      .for('no key update');
    if (district === undefined) {
      throw validationError('body', 'not_found', 'districtId');
    }
    const [duplicate] = await tx
      .select({
        slug: venues.slug,
        verified: venues.verified,
        isSample: venues.isSample,
        createdBy: venues.createdBy,
      })
      .from(venues)
      .where(and(eq(venues.districtId, district.id), eq(venues.searchName, searchName)))
      .limit(1);
    if (duplicate !== undefined) {
      const readable = duplicate.verified || duplicate.isSample || duplicate.createdBy === actorId;
      throw new VenueExistsError(readable ? duplicate.slug : null);
    }
    const venueId = await insertWithSlug(
      tx,
      {
        name: body.name,
        searchName,
        districtId: district.id,
        point: { lng: body.location.longitude, lat: body.location.latitude },
        address: body.address ?? null,
        phone: body.phone ?? null,
        indoor: body.indoor,
        features: body.features,
        priceMinMinor: body.priceMinMinor ?? null,
        priceMaxMinor: body.priceMaxMinor ?? null,
        verified: false,
        isSample: false,
        createdBy: actorId,
      },
      body.name,
      district.slug,
    );
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'venue.created',
      targetType: 'venue',
      targetId: venueId,
      ip: ctx.ip,
      metadata: { districtId: district.id },
    });
    return loadVenueDetail(tx, venueId, { isCreator: true, actorId });
  });
}
