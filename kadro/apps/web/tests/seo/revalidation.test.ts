import { districts, openCalls } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { districtTag, SITEMAP_TAG } from '../../lib/server/seo/data';
import { callPageTags, revalidateCallPages } from '../../lib/server/seo/invalidate';
import {
  api,
  type CallsHarness,
  insertApplication,
  insertCall,
  insertMatch,
  label,
  setupCallsHarness,
} from '../calls/support';
import { matchApi } from '../matches/support';
import { account, expectJson, teamFixture } from '../teams/support';

const revalidate = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidateTag: revalidate }));

/**
 * The open-call and match routes drop the cached SEO reads of the district a call is listed in
 * (and the sitemap) once the write has committed (ADR-0057), reusing the tags of
 * `lib/server/seo/data.ts`. Real database, `kadro_app` role; only `revalidateTag` is replaced.
 */

let t: CallsHarness;
const HOUR_MS = 3_600_000;
const KADIKOY = districtTag('istanbul', 'kadikoy');

beforeAll(async () => {
  t = await setupCallsHarness('web_seo_revalidate');
});

afterAll(async () => {
  await t.dispose();
});

beforeEach(() => {
  t.harness.setNow(new Date());
  revalidate.mockClear();
});

function tagsCalled(): string[] {
  return revalidate.mock.calls.map((args) => String(args[0])).sort();
}

describe('revalidation after open-call changes', () => {
  it('publishing a call expires the district listing and the sitemap', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const body = {
      missingCount: 2,
      position: null,
      level: 'regular',
      expiresAt: new Date(t.harness.runtime.now().getTime() + 2 * HOUR_MS).toISOString(),
    };
    await expectJson(await api.publish(team.captain.headers, matchId, body), 201);
    expect(tagsCalled()).toEqual([KADIKOY, SITEMAP_TAG].sort());
    expect(revalidate).toHaveBeenCalledWith(KADIKOY, { expire: 0 });
  });

  it('publishing over a lapsed call (ended as expired) revalidates too', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    await insertCall(t, matchId, {
      expiresAt: new Date(t.harness.runtime.now().getTime() - HOUR_MS),
    });
    const body = {
      missingCount: 1,
      position: null,
      level: 'regular',
      expiresAt: new Date(t.harness.runtime.now().getTime() + 2 * HOUR_MS).toISOString(),
    };
    await expectJson(await api.publish(team.captain.headers, matchId, body), 201);
    expect(tagsCalled()).toContain(KADIKOY);
  });

  it('closing a call expires the listing of the call district', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    await insertCall(t, matchId, { districtId: t.otherDistrictId });
    await expectJson(await api.close(team.captain.headers, matchId), 200);
    const [other] = await t.db
      .select({ ilSlug: districts.ilSlug, slug: districts.slug })
      .from(districts)
      .where(eq(districts.id, t.otherDistrictId));
    expect(tagsCalled()).toEqual(
      [districtTag(other?.ilSlug ?? '', other?.slug ?? ''), SITEMAP_TAG].sort(),
    );
  });

  it('filling the last missing place expires the listing', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const callId = await insertCall(t, matchId, { missingCount: 1 });
    const applicant = await account(t);
    const applicationId = await insertApplication(t, callId, applicant.id);
    await expectJson(
      await api.decide(team.captain.headers, callId, applicationId, 'accepted'),
      200,
    );
    const [row] = await t.db
      .select({ status: openCalls.status })
      .from(openCalls)
      .where(eq(openCalls.id, callId));
    expect(row?.status).toBe('closed');
    expect(tagsCalled()).toContain(KADIKOY);
  });

  it('cancelling the match, which closes its call, expires the listing', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    await insertCall(t, matchId);
    await expectJson(await matchApi.remove(team.captain.headers, matchId), 200);
    expect(tagsCalled()).toContain(KADIKOY);
  });

  it('a rejected request revalidates nothing', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    const outsider = await account(t);
    const response = await api.close(outsider.headers, matchId);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe('revalidateCallPages', () => {
  it('collects every district of a match once, plus the sitemap', async () => {
    const team = await teamFixture(t);
    const matchId = await insertMatch(t, team.id);
    await insertCall(t, matchId, { status: 'closed' });
    await insertCall(t, matchId, { districtId: t.otherDistrictId });
    const tags = await callPageTags(t.app.db, { matchId });
    expect(tags).toHaveLength(3);
    expect(tags).toContain(SITEMAP_TAG);
    expect(tags).toContain(KADIKOY);
  });

  it('logs and swallows a failure instead of failing the committed write', async () => {
    const error = vi.fn();
    const spy = vi.fn(() => {
      throw new Error(`boom-${label()}`);
    });
    await expect(
      revalidateCallPages(
        { db: t.app.db, logger: { error } as never },
        { openCallId: '00000000-0000-4000-8000-000000000000' },
        spy,
      ),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(SITEMAP_TAG);
    expect(error).toHaveBeenCalledOnce();
  });
});
