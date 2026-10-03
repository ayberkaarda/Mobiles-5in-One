import {
  type AdminVenue,
  foldTr,
  LIMITS,
  type ListAdminVenuesQuery,
  type Paginated,
  type UpdateAdminVenueRequest,
} from '@kadro/contracts';
import { districts, type GeoPoint, venues } from '@kadro/db';
import { and, eq, like, ne } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { defineKeyset, openPage } from '../domain/pagination';
import { type DbReader } from '../domain/relations';
import { ApiError } from '../errors';
import { actorIdOf } from '../teams/context';
import { validationError } from '../validate';
import { toFeatures, toVenueSummary, venueSummaryColumns } from '../venues/projections';
import { escapeLike, SAMPLE_PREFIX, VenueExistsError } from '../venues/venues';
import { type AdminRequest } from './step-up';

/**
 * Venue verification and correction (`GET admin/venues`, `PATCH admin/venues/:id`; authorization
 * matrix §3.8 and §4.5, ADR-0064, ADR-0067). Staff see every stored field of every venue,
 * including unverified contact data. `slug`, `is_sample` and the creator are never written here.
 */

/** Newest first, ties by id (ADR-0039). */
const ADMIN_VENUES = defineKeyset('admin.venues', [
  { column: venues.createdAt, type: 'timestamp', direction: 'desc' },
  { column: venues.id, type: 'uuid', direction: 'desc' },
]);

/** Literal name prefix of seeded sample rows (database check `venues_sample_name_prefix`). */
const SAMPLE_NAME_PREFIX = '[ÖRNEK] ';

function adminVenueColumns(db: DbReader) {
  return {
    ...venueSummaryColumns(db),
    address: venues.address,
    phone: venues.phone,
    features: venues.features,
    creatorId: venues.createdBy,
    createdAt: venues.createdAt,
    updatedAt: venues.updatedAt,
  };
}

interface AdminVenueRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly districtId: string;
  readonly point: GeoPoint;
  readonly indoor: boolean;
  readonly priceMinMinor: number | null;
  readonly priceMaxMinor: number | null;
  readonly verified: boolean;
  readonly isSample: boolean;
  readonly reviewCount: number;
  readonly reviewAverage: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly features: Readonly<Record<string, unknown>>;
  readonly creatorId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function toAdminVenue(row: AdminVenueRow): AdminVenue {
  const summary = toVenueSummary(row);
  return {
    id: summary.id,
    name: summary.name,
    slug: summary.slug,
    districtId: summary.districtId,
    location: summary.location,
    address: row.address,
    phone: row.phone,
    indoor: summary.indoor,
    features: toFeatures(row.features),
    priceMinMinor: summary.priceMinMinor,
    priceMaxMinor: summary.priceMaxMinor,
    verified: summary.verified,
    isSample: summary.isSample,
    creatorId: row.creatorId,
    rating: summary.rating,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadAdminVenue(db: DbReader, venueId: string): Promise<AdminVenue> {
  const [row] = await db
    .select(adminVenueColumns(db))
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  if (row === undefined) {
    throw new ApiError('not_found');
  }
  return toAdminVenue(row);
}

/** `GET admin/venues` (`admin.read`): newest first; `verified`, `district` and `q` filters. */
export async function listAdminVenues(
  { ctx, runtime }: AdminRequest,
  query: ListAdminVenuesQuery,
): Promise<Paginated<AdminVenue>> {
  await ctx.authorize('admin.read');
  let folded: string | undefined;
  if (query.q !== undefined) {
    folded = foldTr(query.q);
    if (folded.length < LIMITS.adminSearchQuery.min) {
      throw validationError('query', 'too_small', 'q');
    }
  }
  const page = openPage(
    ADMIN_VENUES,
    {
      cursor: query.cursor,
      limit: query.limit,
      filters: { verified: query.verified, district: query.district, q: folded },
    },
    runtime.keyedHash,
  );
  const db = runtime.db;
  const rows = await db
    .select({ ...adminVenueColumns(db), pageKey: page.key })
    .from(venues)
    .where(
      and(
        query.verified === undefined ? undefined : eq(venues.verified, query.verified),
        query.district === undefined ? undefined : eq(venues.districtId, query.district),
        folded === undefined ? undefined : like(venues.searchName, `%${escapeLike(folded)}%`),
        page.where,
      ),
    )
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, toAdminVenue);
}

type VenueChanges = Partial<typeof venues.$inferInsert>;

/** The written field names, sorted, for the audit row (no values). */
function changedFields(body: UpdateAdminVenueRequest): string {
  return Object.keys(body).sort().join(',');
}

/**
 * `PATCH admin/venues/:id` (`venue.verify`, staff + step-up): verification (`verified`) and
 * corrections. Under the venue row lock:
 *
 * - a rename or a district change refuses a venue with the same folded name in the target
 *   district (409 `venue_exists` with its slug; staff can read every venue), serialized with
 *   `POST venues` by the same district row lock;
 * - a sample venue keeps its `[ÖRNEK] ` prefix and no other venue may take it (400);
 * - the price range is checked after merging with the stored values (400).
 *
 * One `venue.verified`, `venue.unverified` or `venue.corrected` audit row names the changed
 * fields, never their values.
 */
export async function updateAdminVenue(
  { ctx, runtime }: AdminRequest,
  venueId: string,
  body: UpdateAdminVenueRequest,
): Promise<AdminVenue> {
  await ctx.authorize('venue.verify');
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: venues.id,
        name: venues.name,
        searchName: venues.searchName,
        districtId: venues.districtId,
        verified: venues.verified,
        isSample: venues.isSample,
        priceMinMinor: venues.priceMinMinor,
        priceMaxMinor: venues.priceMaxMinor,
      })
      .from(venues)
      .where(eq(venues.id, venueId))
      .for('update');
    if (current === undefined) {
      throw new ApiError('not_found');
    }

    const changes: VenueChanges = {};
    if (body.name !== undefined) {
      const searchName = foldTr(body.name);
      if (current.isSample && !body.name.startsWith(SAMPLE_NAME_PREFIX)) {
        throw validationError('body', 'sample_prefix_required', 'name');
      }
      if (!current.isSample && searchName.startsWith(SAMPLE_PREFIX)) {
        throw validationError('body', 'reserved', 'name');
      }
      changes.name = body.name;
      changes.searchName = searchName;
    }
    const districtId = body.districtId ?? current.districtId;
    const searchName = changes.searchName ?? current.searchName;
    if (districtId !== current.districtId || searchName !== current.searchName) {
      const [district] = await tx
        .select({ id: districts.id })
        .from(districts)
        .where(eq(districts.id, districtId))
        .for('no key update');
      if (district === undefined) {
        throw validationError('body', 'not_found', 'districtId');
      }
      const [duplicate] = await tx
        .select({ slug: venues.slug })
        .from(venues)
        .where(
          and(
            eq(venues.districtId, districtId),
            eq(venues.searchName, searchName),
            ne(venues.id, current.id),
          ),
        )
        .limit(1);
      if (duplicate !== undefined) {
        throw new VenueExistsError(duplicate.slug);
      }
      changes.districtId = districtId;
    }

    const priceMin = body.priceMinMinor === undefined ? current.priceMinMinor : body.priceMinMinor;
    const priceMax = body.priceMaxMinor === undefined ? current.priceMaxMinor : body.priceMaxMinor;
    if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
      throw validationError('body', 'too_big', 'priceMinMinor');
    }
    if (body.priceMinMinor !== undefined) {
      changes.priceMinMinor = body.priceMinMinor;
    }
    if (body.priceMaxMinor !== undefined) {
      changes.priceMaxMinor = body.priceMaxMinor;
    }
    if (body.verified !== undefined) {
      changes.verified = body.verified;
    }
    if (body.location !== undefined) {
      changes.point = { lng: body.location.longitude, lat: body.location.latitude };
    }
    if (body.address !== undefined) {
      changes.address = body.address;
    }
    if (body.phone !== undefined) {
      changes.phone = body.phone;
    }
    if (body.indoor !== undefined) {
      changes.indoor = body.indoor;
    }
    if (body.features !== undefined) {
      changes.features = body.features;
    }

    const now = runtime.now();
    await tx
      .update(venues)
      .set({ ...changes, updatedAt: now })
      .where(eq(venues.id, current.id));

    const verifiedChanged = body.verified !== undefined && body.verified !== current.verified;
    const action = verifiedChanged
      ? body.verified
        ? 'venue.verified'
        : 'venue.unverified'
      : 'venue.corrected';
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action,
      targetType: 'venue',
      targetId: current.id,
      ip: ctx.ip,
      metadata: { fields: changedFields(body), verified: body.verified ?? current.verified },
    });
    return loadAdminVenue(tx, current.id);
  });
}
