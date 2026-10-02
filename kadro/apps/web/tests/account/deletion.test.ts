import { randomBytes } from 'node:crypto';

import { deleteAccountResponseSchema, LIMITS, mobileAuthResponseSchema } from '@kadro/contracts';
import {
  auditLogs,
  deletionRequests,
  districts,
  matches,
  matchRsvps,
  type MatchStatus,
  openCallApplications,
  openCalls,
  pushTokens,
  refreshTokens,
  type RsvpStatus,
  teamMembers,
  teams,
  users,
} from '@kadro/db';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type JobSender } from '../../lib/server/jobs/enqueue';
import { POST as googleRoute } from '../../app/api/v1/auth/google/route';
import { POST as loginRoute } from '../../app/api/v1/auth/login/route';
import { POST as refreshRoute } from '../../app/api/v1/auth/refresh/route';
import { DELETE as deleteMe, GET as getMe } from '../../app/api/v1/me/route';
import {
  type AuthHarness,
  createUser,
  GOOGLE_CLIENT_ID,
  mobile,
  mobileLogin,
  parseSetCookies,
  post,
  setupAuthHarness,
  signProviderToken,
  uniqueEmail,
  userRow,
  web,
} from '../auth/support';
import { call, expectProblem } from '../support/http';
import { storedJobs } from '../support/jobs';

/**
 * `DELETE me` (security checklist item 21, ADR-0032, matrix §3.2 footnotes 4 and 5): proof of
 * re-authentication, staff step-up, immediate deactivation, jobs and email in the same
 * transaction, cancellation by signing in, idempotency and rate limit D.
 */

let auth: AuthHarness;
let districtId: string;
const DAY_MS = 86_400_000;
const GRACE_MS = LIMITS.accountDeletionGraceSeconds * 1_000;

beforeAll(async () => {
  auth = await setupAuthHarness('web_account_deletion', { RATE_LIMIT_AUTH_MAX: '100' });
  const [district] = await auth.database.client.db
    .insert(districts)
    .values({
      il: 'İstanbul',
      ilce: 'Üsküdar',
      ilSlug: 'istanbul',
      slug: 'uskudar',
      centroid: { lng: 29.02, lat: 41.02 },
    })
    .returning({ id: districts.id });
  districtId = district?.id ?? '';
});

afterAll(async () => {
  await auth.database.dispose();
});

const db = () => auth.database.client.db;

function bearer(accessToken: string): Record<string, string> {
  return mobile(undefined, { authorization: `Bearer ${accessToken}` });
}

function requestDeletion(headers: Record<string, string>, json: unknown): Promise<Response> {
  return call(deleteMe, { method: 'DELETE', headers, json, path: '/api/v1/me' });
}

function readMe(headers: Record<string, string>): Promise<Response> {
  return call(getMe, { method: 'GET', headers, path: '/api/v1/me' });
}

interface SignedIn {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly headers: Record<string, string>;
}

async function signedIn(values: Parameters<typeof createUser>[1] = {}): Promise<SignedIn> {
  const user = await createUser(auth, values);
  const session = await mobileLogin(loginRoute, user.email, user.password);
  return {
    ...user,
    accessToken: session.tokens.accessToken,
    refreshToken: session.tokens.refreshToken,
    headers: bearer(session.tokens.accessToken),
  };
}

async function webSession(email: string, password: string) {
  const response = await post(loginRoute, web(), { email, password });
  expect(response.status).toBe(200);
  const cookies = parseSetCookies(response);
  const session = cookies.get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '';
  const csrf = cookies.get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '';
  const cookie = `${auth.harness.env.SESSION_COOKIE_NAME}=${session}; ${auth.harness.env.CSRF_COOKIE_NAME}=${csrf}`;
  return web(undefined, { cookie, 'x-csrf-token': csrf });
}

async function pendingRequests(userId: string) {
  return db()
    .select()
    .from(deletionRequests)
    .where(and(eq(deletionRequests.userId, userId), isNull(deletionRequests.completedAt)));
}

async function liveSessions(userId: string): Promise<number> {
  const rows = await db()
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  return rows.length;
}

/** `deletion_scheduled` emails queued for the user. */
async function deletionJobs(userId: string) {
  const emails = (await storedJobs(auth.database.url, 'email.send')).filter(
    (job) => job.data.userId === userId && job.data.kind === 'deletion_scheduled',
  );
  return { emails };
}

async function insertPushToken(userId: string): Promise<void> {
  await db()
    .insert(pushTokens)
    .values({
      userId,
      expoToken: `ExponentPushToken[${randomBytes(12).toString('base64url')}]`,
      platform: 'ios',
    });
}

describe('DELETE me: request', () => {
  it('deactivates at once, revokes every session, drops push tokens and queues job and email', async () => {
    auth.harness.setNow(new Date());
    const user = await signedIn();
    const webHeaders = await webSession(user.email, user.password);
    await insertPushToken(user.id);
    await insertPushToken(user.id);
    expect(await liveSessions(user.id)).toBe(2);
    const now = auth.harness.runtime.now();

    const response = await requestDeletion(user.headers, { password: user.password });
    const text = await response.text();
    expect(response.status, text).toBe(202);
    const body = deleteAccountResponseSchema.parse(JSON.parse(text));
    expect(new Date(body.graceUntil).getTime()).toBe(now.getTime() + GRACE_MS);

    const row = await userRow(auth, user.id);
    expect(row?.deactivatedAt?.getTime()).toBe(now.getTime());
    const [request] = await pendingRequests(user.id);
    expect(request?.graceUntil.getTime()).toBe(now.getTime() + GRACE_MS);
    expect(await liveSessions(user.id)).toBe(0);
    expect(await db().select().from(pushTokens).where(eq(pushTokens.userId, user.id))).toEqual([]);

    const hardDeletes = (await storedJobs(auth.database.url, 'account.hard_delete')).filter(
      (job) => job.data.deletionRequestId === request?.id,
    );
    expect(hardDeletes).toHaveLength(1);
    expect(hardDeletes[0]?.singletonKey).toBe(`delete:${request?.id}`);
    expect(hardDeletes[0]?.data).toEqual({
      deletionRequestId: request?.id,
      idempotencyKey: `delete:${request?.id}`,
    });
    expect(hardDeletes[0]?.startAfter.getTime()).toBe(now.getTime() + GRACE_MS);
    const { emails } = await deletionJobs(user.id);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.singletonKey).toBe(`email:deletion:${request?.id}`);
    expect(Object.keys(emails[0]?.data ?? {}).sort()).toEqual([
      'idempotencyKey',
      'kind',
      'requestId',
      'userId',
    ]);
    expect(JSON.stringify(emails[0]?.data)).not.toContain(user.email);

    const audit = await db()
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, 'account.deletionRequested')),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetType).toBe('deletion_request');
    expect(audit[0]?.targetId).toBe(request?.id);
    expect(audit[0]?.metadata).toEqual({});

    // Every credential stops working on the next request.
    await expectProblem(await readMe(user.headers), 401, 'account_deactivated');
    await expectProblem(await readMe(webHeaders), 401, 'unauthenticated');
    await expectProblem(
      await post(refreshRoute, mobile(), { refreshToken: user.refreshToken }),
      401,
      'unauthenticated',
    );

    const logs = auth.harness.logLines.join('\n');
    expect(logs).not.toContain(user.email);
    expect(logs).not.toContain(user.password);
  });

  it('works from a web session (cookie + CSRF) as well', async () => {
    const user = await createUser(auth);
    const headers = await webSession(user.email, user.password);
    const response = await requestDeletion(headers, { password: user.password });
    expect(response.status, await response.clone().text()).toBe(202);
    await expectProblem(await readMe(headers), 401, 'unauthenticated');
    expect(await liveSessions(user.id)).toBe(0);
  });

  it('refuses without a valid proof: 401 reauth_required, nothing changes', async () => {
    const user = await signedIn();
    await insertPushToken(user.id);
    await expectProblem(
      await requestDeletion(user.headers, { password: `${user.password}x` }),
      401,
      'reauth_required',
    );
    await expectProblem(await requestDeletion(user.headers, {}), 400, 'validation_failed');
    await expectProblem(
      await requestDeletion(user.headers, { password: user.password, userId: user.id }),
      400,
      'validation_failed',
    );
    expect((await userRow(auth, user.id))?.deactivatedAt).toBeNull();
    expect(await pendingRequests(user.id)).toEqual([]);
    expect(await liveSessions(user.id)).toBe(1);
    expect(await deletionJobs(user.id)).toEqual({ emails: [] });
    expect((await readMe(user.headers)).status).toBe(200);
  });

  it('refuses a password for a social-only account', async () => {
    const user = await signedIn({ googleSub: `g.${randomBytes(6).toString('hex')}` });
    await db().update(users).set({ passwordHash: null }).where(eq(users.id, user.id));
    await expectProblem(
      await requestDeletion(user.headers, { password: user.password }),
      401,
      'reauth_required',
    );
    expect((await userRow(auth, user.id))?.deactivatedAt).toBeNull();
  });

  it('requires a fresh TOTP code from staff: 401 step_up_required, nothing changes', async () => {
    for (const role of ['moderator', 'admin'] as const) {
      const staff = await signedIn({ role });
      await expectProblem(
        await requestDeletion(staff.headers, { password: staff.password }),
        401,
        'step_up_required',
      );
      await expectProblem(
        await requestDeletion(staff.headers, { password: staff.password, totpCode: '123456' }),
        401,
        'step_up_required',
      );
      // The proof is checked first: a wrong password is still reauth_required.
      await expectProblem(
        await requestDeletion(staff.headers, {
          password: `${staff.password}x`,
          totpCode: '123456',
        }),
        401,
        'reauth_required',
      );
      expect((await userRow(auth, staff.id))?.deactivatedAt).toBeNull();
      expect(await pendingRequests(staff.id)).toEqual([]);
      expect(await liveSessions(staff.id)).toBe(1);
    }
  });

  it('accepts a fresh provider token of the linked subject exactly once', async () => {
    auth.harness.setNow(new Date());
    const subject = `g.${randomBytes(6).toString('hex')}`;
    const email = uniqueEmail();
    const googleToken = (issuedAt?: Date, sub = subject) =>
      signProviderToken({
        keys: auth.googleKeys,
        issuer: 'https://accounts.google.com',
        audience: GOOGLE_CLIENT_ID,
        subject: sub,
        claims: { email, email_verified: true },
        ...(issuedAt === undefined ? {} : { issuedAt }),
      });
    const signIn = async () => {
      const response = await post(googleRoute, mobile(), { idToken: await googleToken() });
      expect(response.status).toBe(200);
      return mobileAuthResponseSchema.parse(await response.json());
    };
    const session = await signIn();
    const headers = bearer(session.tokens.accessToken);

    const stale = await googleToken(new Date(Date.now() - 10 * 60_000));
    await expectProblem(
      await requestDeletion(headers, { provider: 'google', identityToken: stale }),
      401,
      'reauth_required',
    );
    const otherSubject = await googleToken(undefined, `g.${randomBytes(6).toString('hex')}`);
    await expectProblem(
      await requestDeletion(headers, { provider: 'google', identityToken: otherSubject }),
      401,
      'reauth_required',
    );
    const wrongProvider = await googleToken();
    await expectProblem(
      await requestDeletion(headers, {
        provider: 'apple',
        identityToken: wrongProvider,
        nonce: randomBytes(16).toString('base64url'),
      }),
      401,
      'reauth_required',
    );

    const fresh = await googleToken();
    expect(
      (await requestDeletion(headers, { provider: 'google', identityToken: fresh })).status,
    ).toBe(202);
    // Signing in again cancels; the spent token cannot start a second deletion.
    const again = await signIn();
    expect(again.user.id).toBe(session.user.id);
    await expectProblem(
      await requestDeletion(bearer(again.tokens.accessToken), {
        provider: 'google',
        identityToken: fresh,
      }),
      401,
      'reauth_required',
    );
    expect(await pendingRequests(session.user.id)).toEqual([]);
  });
});

describe('DELETE me: transaction', () => {
  it('rolls the request, deactivation and the queued hard delete back when the email cannot be queued', async () => {
    const user = await signedIn();
    await insertPushToken(user.id);
    const hardDeletesBefore = (await storedJobs(auth.database.url, 'account.hard_delete')).length;
    const runtime = auth.harness.runtime as { jobs: JobSender };
    const real = runtime.jobs;
    const failing: JobSender = {
      enqueue: (tx, queue, payload, options) =>
        queue === 'email.send'
          ? Promise.reject(new Error('queue unavailable'))
          : real.enqueue(tx, queue, payload, options),
    };
    runtime.jobs = failing;
    try {
      await expectProblem(
        await requestDeletion(user.headers, { password: user.password }),
        500,
        'internal_error',
      );
    } finally {
      runtime.jobs = real;
    }
    expect((await userRow(auth, user.id))?.deactivatedAt).toBeNull();
    expect(await pendingRequests(user.id)).toEqual([]);
    expect(await liveSessions(user.id)).toBe(1);
    expect(await db().select().from(pushTokens).where(eq(pushTokens.userId, user.id))).toHaveLength(
      1,
    );
    expect((await deletionJobs(user.id)).emails).toEqual([]);
    // The hard-delete job was inserted inside the transaction and rolled back with it.
    expect((await storedJobs(auth.database.url, 'account.hard_delete')).length).toBe(
      hardDeletesBefore,
    );
    expect(
      await db()
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, 'account.deletionRequested')),
        ),
    ).toEqual([]);
    expect((await readMe(user.headers)).status).toBe(200);
  });

  it('is cancelled by signing in during the grace period; the queued job then finds nothing', async () => {
    auth.harness.setNow(new Date());
    const user = await signedIn();
    expect((await requestDeletion(user.headers, { password: user.password })).status).toBe(202);
    const [request] = await pendingRequests(user.id);

    auth.harness.advance(3 * DAY_MS);
    const session = await mobileLogin(loginRoute, user.email, user.password);
    expect((await userRow(auth, user.id))?.deactivatedAt).toBeNull();
    expect(await pendingRequests(user.id)).toEqual([]);
    const cancelled = await db()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, user.id), eq(auditLogs.action, 'auth.deletionCancelled')));
    expect(cancelled).toHaveLength(1);
    expect(
      (await storedJobs(auth.database.url, 'account.hard_delete')).filter(
        (job) => job.data.deletionRequestId === request?.id,
      ),
    ).toHaveLength(1);
    // The old access token belongs to a revoked family; the new session works.
    await expectProblem(await readMe(user.headers), 401, 'unauthenticated');
    expect((await readMe(bearer(session.tokens.accessToken))).status).toBe(200);

    // After the grace period a sign-in no longer cancels.
    const late = await signedIn();
    expect((await requestDeletion(late.headers, { password: late.password })).status).toBe(202);
    auth.harness.advance(GRACE_MS + 60_000);
    await expectProblem(
      await post(loginRoute, mobile(), { email: late.email, password: late.password }),
      401,
      'account_deactivated',
    );
    auth.harness.setNow(new Date());
  });

  it('answers a second request: 401 with the dead session, 409 deletion_pending when one is pending', async () => {
    const user = await signedIn();
    const responses = await Promise.all([
      requestDeletion(user.headers, { password: user.password }),
      requestDeletion(user.headers, { password: user.password }),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([202, 409]);
    const conflict = responses.find((response) => response.status === 409);
    if (conflict !== undefined) {
      await expectProblem(conflict, 409, 'deletion_pending');
    }
    expect(await pendingRequests(user.id)).toHaveLength(1);
    expect((await deletionJobs(user.id)).emails).toHaveLength(1);

    await expectProblem(
      await requestDeletion(user.headers, { password: user.password }),
      401,
      'account_deactivated',
    );

    // A pending request on an active account (for example reactivated by an operator) is kept.
    const other = await signedIn();
    await db()
      .insert(deletionRequests)
      .values({
        userId: other.id,
        graceUntil: new Date(auth.harness.runtime.now().getTime() + DAY_MS),
      });
    await expectProblem(
      await requestDeletion(other.headers, { password: other.password }),
      409,
      'deletion_pending',
    );
    expect((await userRow(auth, other.id))?.deactivatedAt).toBeNull();
    expect(await liveSessions(other.id)).toBe(1);
  });

  it('allows 5 attempts per 15 minutes (group D), the sixth is 429', async () => {
    const user = await signedIn();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectProblem(
        await requestDeletion(user.headers, { password: `${user.password}${attempt}` }),
        401,
        'reauth_required',
      );
    }
    await expectProblem(
      await requestDeletion(user.headers, { password: user.password }),
      429,
      'rate_limited',
    );
    expect((await userRow(auth, user.id))?.deactivatedAt).toBeNull();
  });

  it('answers 401 to anonymous callers', async () => {
    await expectProblem(
      await requestDeletion(mobile(), { password: 'irrelevant-1' }),
      401,
      'unauthenticated',
    );
  });
});

// ---------------------------------------------------------------------------
// Participation released at request time (ADR-0032 §1 step 4)
// ---------------------------------------------------------------------------

async function insertTeam(ownerId: string): Promise<string> {
  const [team] = await db()
    .insert(teams)
    .values({
      name: `Kadro ${randomBytes(3).toString('hex')}`,
      slug: `kadro-${randomBytes(6).toString('hex')}`,
      districtId,
      ownerId,
    })
    .returning({ id: teams.id });
  if (team === undefined) {
    throw new Error('team insert returned no row');
  }
  await db().insert(teamMembers).values({ teamId: team.id, userId: ownerId, role: 'captain' });
  return team.id;
}

async function insertMatch(teamId: string, status: MatchStatus, slots = 2): Promise<string> {
  const now = auth.harness.runtime.now().getTime();
  const [match] = await db()
    .insert(matches)
    .values({
      teamId,
      startsAt: new Date(status === 'played' ? now - DAY_MS : now + DAY_MS),
      format: '5v5',
      slots,
      status,
      lockedAt: status === 'locked' ? new Date(now) : null,
      venueText: 'Deneme sahası',
    })
    .returning({ id: matches.id });
  if (match === undefined) {
    throw new Error('match insert returned no row');
  }
  return match.id;
}

async function rsvp(
  matchId: string,
  userId: string,
  status: RsvpStatus,
  values: { paid?: boolean; waitlistedAt?: Date } = {},
): Promise<void> {
  await db()
    .insert(matchRsvps)
    .values({
      matchId,
      userId,
      status,
      paid: values.paid ?? false,
      waitlistedAt: status === 'waitlist' ? (values.waitlistedAt ?? new Date()) : null,
    });
}

async function rsvpOf(matchId: string, userId: string) {
  const [row] = await db()
    .select({ status: matchRsvps.status, paid: matchRsvps.paid })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, userId)));
  return row;
}

describe('DELETE me: upcoming matches and applications', () => {
  it('drops upcoming RSVPs to out with promotion and notifications, withdraws applications, keeps history', async () => {
    auth.harness.setNow(new Date());
    const captain = await createUser(auth);
    const leaver = await signedIn();
    const waiting = await createUser(auth);
    const filler = await createUser(auth);
    const teamId = await insertTeam(captain.id);
    for (const member of [leaver, waiting, filler]) {
      await db().insert(teamMembers).values({ teamId, userId: member.id, role: 'player' });
    }
    const openMatch = await insertMatch(teamId, 'open', 2);
    await rsvp(openMatch, leaver.id, 'in');
    await rsvp(openMatch, filler.id, 'in');
    await rsvp(openMatch, waiting.id, 'waitlist');
    const lockedMatch = await insertMatch(teamId, 'locked', 2);
    await rsvp(lockedMatch, leaver.id, 'in', { paid: true });
    const maybeMatch = await insertMatch(teamId, 'open', 4);
    await rsvp(maybeMatch, leaver.id, 'maybe');
    const playedMatch = await insertMatch(teamId, 'played', 2);
    await rsvp(playedMatch, leaver.id, 'in', { paid: true });

    const otherCaptain = await createUser(auth);
    const otherTeam = await insertTeam(otherCaptain.id);
    const otherMatch = await insertMatch(otherTeam, 'open', 10);
    const [call] = await db()
      .insert(openCalls)
      .values({
        matchId: otherMatch,
        missingCount: 2,
        status: 'open',
        expiresAt: new Date(auth.harness.runtime.now().getTime() + DAY_MS),
        level: 'regular',
        districtId,
      })
      .returning({ id: openCalls.id });
    const [application] = await db()
      .insert(openCallApplications)
      .values({ openCallId: call?.id ?? '', userId: leaver.id, status: 'pending' })
      .returning({ id: openCallApplications.id });

    expect((await requestDeletion(leaver.headers, { password: leaver.password })).status).toBe(202);

    expect(await rsvpOf(openMatch, leaver.id)).toEqual({ status: 'out', paid: false });
    expect((await rsvpOf(openMatch, waiting.id))?.status).toBe('in');
    expect(await rsvpOf(lockedMatch, leaver.id)).toEqual({ status: 'out', paid: false });
    expect((await rsvpOf(maybeMatch, leaver.id))?.status).toBe('out');
    expect(await rsvpOf(playedMatch, leaver.id)).toEqual({ status: 'in', paid: true });
    const [withdrawn] = await db()
      .select({ status: openCallApplications.status })
      .from(openCallApplications)
      .where(eq(openCallApplications.id, application?.id ?? ''));
    expect(withdrawn?.status).toBe('withdrawn');
    // Membership and roles are untouched during the grace period.
    expect(
      await db()
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, leaver.id))),
    ).toEqual([{ role: 'player' }]);

    const pushes = await storedJobs(auth.database.url, 'push.send');
    const of = (type: string, userId: string, refId: string) =>
      pushes.filter(
        (job) => job.data.type === type && job.data.userId === userId && job.data.refId === refId,
      );
    expect(of('rsvp.promoted', waiting.id, openMatch)).toHaveLength(1);
    expect(of('lineup.slot_free', captain.id, lockedMatch)).toHaveLength(1);
    expect(of('rsvp.changed', captain.id, openMatch)).toHaveLength(1);
    expect(pushes.filter((job) => job.data.userId === leaver.id)).toEqual([]);

    const paidCleared = await db()
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, leaver.id), eq(auditLogs.action, 'payment.mark')));
    expect(paidCleared).toEqual([
      {
        metadata: {
          matchId: lockedMatch,
          targetUserId: leaver.id,
          paid: false,
          selfMark: true,
          reason: 'rsvp_left',
        },
      },
    ]);
    expect(JSON.stringify(paidCleared)).not.toContain(leaver.email);
  });
});
