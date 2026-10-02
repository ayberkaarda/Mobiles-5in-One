import { randomBytes } from 'node:crypto';

import {
  type ApplicationStatus,
  createDbClient,
  type DbClient,
  districts,
  type MatchStatus,
  matches,
  matchRsvps,
  openCallApplications,
  openCalls,
  type OpenCallStatus,
  type PlayerLevel,
  type PlayerPosition,
  type RsvpStatus,
  users,
  venues,
} from '@kadro/db';
import { foldTr } from '@kadro/contracts';
import { and, eq } from 'drizzle-orm';

import { type RouteHandler } from '../../lib/server/http';
import { createMigratedDatabase } from '../support/db';
import { call } from '../support/http';
import {
  bootstrapJobQueues,
  createRoleLogins,
  type RoleLogins,
  type StoredJob,
  storedJobs,
} from '../support/jobs';
import { installTestRuntime } from '../support/runtime';
import { DAY_MS, type TeamsHarness } from '../teams/support';
import { GET as listOpenCallsRoute } from '../../app/api/v1/open-calls/route';
import {
  GET as listApplicationsRoute,
  POST as createApplicationRoute,
} from '../../app/api/v1/open-calls/[id]/applications/route';
import { PATCH as decideApplicationRoute } from '../../app/api/v1/open-calls/[id]/applications/[appId]/route';
import {
  PATCH as closeOpenCallRoute,
  POST as publishOpenCallRoute,
} from '../../app/api/v1/matches/[id]/open-call/route';
import { PUT as setRsvpRoute } from '../../app/api/v1/matches/[id]/rsvp/route';
import { GET as listVenuesRoute, POST as createVenueRoute } from '../../app/api/v1/venues/route';
import { GET as getVenueRoute } from '../../app/api/v1/venues/[slug]/route';
import { POST as createReviewRoute } from '../../app/api/v1/venues/[slug]/reviews/route';
import { DELETE as deleteReviewRoute } from '../../app/api/v1/venues/[slug]/reviews/mine/route';

/**
 * Shared fixtures of the open-call, application, venue and review suites. The database is a
 * disposable migrated PostgreSQL + PostGIS database with the worker's job queues; the API runs as
 * a `kadro_app` login (the production web role), fixtures are inserted as the superuser. Names,
 * identifiers and credentials are generated at run time; fixture venues carry the `[ÖRNEK]` prefix
 * or a `Deneme` (test) name and never name a real pitch.
 */

export interface CallsHarness extends TeamsHarness {
  readonly logins: RoleLogins;
  readonly app: DbClient;
  dispose(): Promise<void>;
}

export async function setupCallsHarness(prefix: string): Promise<CallsHarness> {
  const database = await createMigratedDatabase(prefix);
  await bootstrapJobQueues(database.url);
  const logins = await createRoleLogins(database.url);
  const app = createDbClient({ connectionString: logins.appUrl, maxConnections: 10 });
  const harness = await installTestRuntime({
    db: app.db,
    env: { DATABASE_URL: logins.appUrl },
  });
  const db = database.client.db;
  const inserted = await db
    .insert(districts)
    .values([
      {
        il: 'İstanbul',
        ilce: 'Kadıköy',
        ilSlug: 'istanbul',
        slug: 'kadikoy',
        centroid: { lng: 29.03, lat: 40.99 },
      },
      {
        il: 'İzmir',
        ilce: 'Karşıyaka',
        ilSlug: 'izmir',
        slug: 'karsiyaka',
        centroid: { lng: 27.11, lat: 38.46 },
      },
    ])
    .returning({ id: districts.id });
  return {
    database,
    db,
    harness,
    logins,
    app,
    districtId: inserted[0]?.id ?? '',
    otherDistrictId: inserted[1]?.id ?? '',
    dispose: async () => {
      await harness.runtime.jobClient.close();
      await app.close();
      await logins.drop();
      await database.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Direct-insert fixtures
// ---------------------------------------------------------------------------

export interface MatchOptions {
  readonly status?: MatchStatus;
  readonly slots?: number;
  readonly startsAt?: Date;
  readonly venueId?: string | null;
}

export async function insertMatch(
  t: CallsHarness,
  teamId: string,
  options: MatchOptions = {},
): Promise<string> {
  const now = t.harness.runtime.now().getTime();
  const status = options.status ?? 'open';
  const [row] = await t.db
    .insert(matches)
    .values({
      teamId,
      startsAt: options.startsAt ?? new Date(status === 'played' ? now - DAY_MS : now + 2 * DAY_MS),
      format: '7v7',
      slots: options.slots ?? 14,
      status,
      lockedAt: status === 'locked' ? new Date(now) : null,
      venueId: options.venueId ?? null,
      venueText: options.venueId ? null : 'Deneme sahası',
    })
    .returning({ id: matches.id });
  if (row === undefined) {
    throw new Error('match insert returned no row');
  }
  return row.id;
}

export interface CallOptions {
  readonly missingCount?: number;
  readonly status?: OpenCallStatus;
  readonly expiresAt?: Date;
  readonly level?: PlayerLevel;
  readonly position?: PlayerPosition | null;
  readonly districtId?: string;
}

export async function insertCall(
  t: CallsHarness,
  matchId: string,
  options: CallOptions = {},
): Promise<string> {
  const now = t.harness.runtime.now().getTime();
  const [row] = await t.db
    .insert(openCalls)
    .values({
      matchId,
      missingCount: options.missingCount ?? 2,
      status: options.status ?? 'open',
      expiresAt: options.expiresAt ?? new Date(now + DAY_MS),
      level: options.level ?? 'regular',
      position: options.position === undefined ? null : options.position,
      districtId: options.districtId ?? t.districtId,
    })
    .returning({ id: openCalls.id });
  if (row === undefined) {
    throw new Error('open call insert returned no row');
  }
  return row.id;
}

export async function insertApplication(
  t: CallsHarness,
  openCallId: string,
  userId: string,
  status: ApplicationStatus = 'pending',
  message: string | null = null,
): Promise<string> {
  const [row] = await t.db
    .insert(openCallApplications)
    .values({ openCallId, userId, status, message })
    .returning({ id: openCallApplications.id });
  if (row === undefined) {
    throw new Error('application insert returned no row');
  }
  return row.id;
}

export async function insertRsvp(
  t: CallsHarness,
  matchId: string,
  userId: string,
  status: RsvpStatus = 'in',
): Promise<void> {
  await t.db.insert(matchRsvps).values({
    matchId,
    userId,
    status,
    waitlistedAt: status === 'waitlist' ? new Date() : null,
  });
}

/** Adds `count` confirmed players without sessions (fresh users, direct inserts). */
export async function fillSlots(t: CallsHarness, matchId: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const [user] = await t.db
      .insert(users)
      .values({
        email: `dolgu-${label()}-${index}@example.test`,
        displayName: `Oyuncu ${label()}`,
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });
    if (user === undefined) {
      throw new Error('user insert returned no row');
    }
    await insertRsvp(t, matchId, user.id, 'in');
  }
}

export interface VenueOptions {
  readonly name?: string;
  readonly verified?: boolean;
  readonly isSample?: boolean;
  readonly createdBy?: string | null;
  readonly districtId?: string;
  readonly phone?: string | null;
  readonly address?: string | null;
}

/** A directory venue. Names default to the `[ÖRNEK]` marker so no real pitch is ever named. */
export async function insertVenue(
  t: CallsHarness,
  options: VenueOptions = {},
): Promise<{ id: string; slug: string; name: string }> {
  const name = options.name ?? `[ÖRNEK] Deneme Sahası ${randomBytes(3).toString('hex')}`;
  const slug = `ornek-${randomBytes(6).toString('hex')}`;
  const [row] = await t.db
    .insert(venues)
    .values({
      name,
      slug,
      searchName: foldTr(name),
      districtId: options.districtId ?? t.districtId,
      point: { lng: 29.03, lat: 40.99 },
      indoor: false,
      features: { lighting: true },
      verified: options.verified ?? true,
      isSample: options.isSample ?? false,
      createdBy: options.createdBy ?? null,
      phone: options.phone === undefined ? '+90 216 000 00 00' : options.phone,
      address: options.address === undefined ? 'Deneme Mahallesi 1' : options.address,
    })
    .returning({ id: venues.id });
  if (row === undefined) {
    throw new Error('venue insert returned no row');
  }
  return { id: row.id, slug, name };
}

export async function applicationStatus(
  t: CallsHarness,
  applicationId: string,
): Promise<ApplicationStatus | null> {
  const [row] = await t.db
    .select({ status: openCallApplications.status })
    .from(openCallApplications)
    .where(eq(openCallApplications.id, applicationId));
  return row?.status ?? null;
}

export async function callRow(t: CallsHarness, openCallId: string) {
  const [row] = await t.db.select().from(openCalls).where(eq(openCalls.id, openCallId));
  return row;
}

export async function rsvpOf(
  t: CallsHarness,
  matchId: string,
  userId: string,
): Promise<RsvpStatus | null> {
  const [row] = await t.db
    .select({ status: matchRsvps.status })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, userId)));
  return row?.status ?? null;
}

/** `push.send` jobs whose `refId` is `refId`, oldest first. */
export async function pushJobs(t: CallsHarness, refId: string): Promise<StoredJob[]> {
  return (await storedJobs(t.database.url, 'push.send')).filter((job) => job.data.refId === refId);
}

/** `application.decided` jobs of one application. */
export async function decidedJobs(t: CallsHarness, applicationId: string): Promise<StoredJob[]> {
  return (await pushJobs(t, applicationId)).filter(
    (job) => job.data.type === 'application.decided',
  );
}

/** Unique id-ish label for names and messages. */
export function label(): string {
  return randomBytes(4).toString('hex');
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface RequestOptions {
  readonly headers: Record<string, string>;
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly json?: unknown;
}

function request(
  handler: RouteHandler,
  method: string,
  pattern: string,
  options: RequestOptions,
): Promise<Response> {
  let pathname = pattern;
  for (const [name, value] of Object.entries(options.params ?? {})) {
    pathname = pathname.replace(`[${name}]`, encodeURIComponent(value));
  }
  const search = new URLSearchParams(options.query ?? {}).toString();
  return call(handler, {
    method,
    path: search === '' ? pathname : `${pathname}?${search}`,
    headers: options.headers,
    ...(options.json === undefined ? {} : { json: options.json }),
    ...(options.params === undefined ? {} : { params: options.params }),
  });
}

type Headers = Record<string, string>;

function decideJson(
  headers: Headers,
  openCallId: string,
  appId: string,
  json: unknown,
): Promise<Response> {
  return request(decideApplicationRoute, 'PATCH', '/api/v1/open-calls/[id]/applications/[appId]', {
    headers,
    params: { id: openCallId, appId },
    json,
  });
}

export const api = {
  listOpenCalls: (headers: Headers, query: Record<string, string> = {}) =>
    request(listOpenCallsRoute, 'GET', '/api/v1/open-calls', { headers, query }),
  publish: (headers: Headers, matchId: string, json: unknown) =>
    request(publishOpenCallRoute, 'POST', '/api/v1/matches/[id]/open-call', {
      headers,
      params: { id: matchId },
      json,
    }),
  close: (headers: Headers, matchId: string, json: unknown = { status: 'closed' }) =>
    request(closeOpenCallRoute, 'PATCH', '/api/v1/matches/[id]/open-call', {
      headers,
      params: { id: matchId },
      json,
    }),
  apply: (headers: Headers, openCallId: string, json: unknown = {}) =>
    request(createApplicationRoute, 'POST', '/api/v1/open-calls/[id]/applications', {
      headers,
      params: { id: openCallId },
      json,
    }),
  listApplications: (headers: Headers, openCallId: string, query: Record<string, string> = {}) =>
    request(listApplicationsRoute, 'GET', '/api/v1/open-calls/[id]/applications', {
      headers,
      params: { id: openCallId },
      query,
    }),
  decide: (headers: Headers, openCallId: string, appId: string, status: unknown) =>
    decideJson(headers, openCallId, appId, { status }),
  decideJson,
  listVenues: (headers: Headers, query: Record<string, string> = {}) =>
    request(listVenuesRoute, 'GET', '/api/v1/venues', { headers, query }),
  getVenue: (headers: Headers, slug: string) =>
    request(getVenueRoute, 'GET', '/api/v1/venues/[slug]', { headers, params: { slug } }),
  createVenue: (headers: Headers, json: unknown) =>
    request(createVenueRoute, 'POST', '/api/v1/venues', { headers, json }),
  review: (headers: Headers, slug: string, json: unknown) =>
    request(createReviewRoute, 'POST', '/api/v1/venues/[slug]/reviews', {
      headers,
      params: { slug },
      json,
    }),
  deleteReview: (headers: Headers, slug: string) =>
    request(deleteReviewRoute, 'DELETE', '/api/v1/venues/[slug]/reviews/mine', {
      headers,
      params: { slug },
    }),
};

/**
 * The caller's own RSVP through the match endpoint (another writer of `match_rsvps`, owned by the
 * match endpoints), for races against the acceptance path.
 */
export function setRsvp(headers: Headers, matchId: string, status: string): Promise<Response> {
  return request(setRsvpRoute, 'PUT', '/api/v1/matches/[id]/rsvp', {
    headers,
    params: { id: matchId },
    json: { status },
  });
}

/** Sorts settled statuses for order-independent assertions of concurrent requests. */
export function statuses(responses: readonly Response[]): number[] {
  return responses.map((response) => response.status).sort((a, b) => a - b);
}
