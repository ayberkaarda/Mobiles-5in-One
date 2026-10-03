import { listDistrictsResponseSchema } from '@kadro/contracts';
import { districts } from '@kadro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as listDistrictsRoute } from '../../app/api/v1/districts/route';
import { type CallsHarness, label, setupCallsHarness } from '../calls/support';
import { call, expectProblem, MOBILE, WEB } from '../support/http';
import { account, expectJson } from '../teams/support';

/**
 * `GET /api/v1/districts` (matrix §3.7, registry `listDistricts`): public reference data behind
 * the client header, filtered by province slug and sorted by province then district slug.
 */

let t: CallsHarness;

beforeAll(async () => {
  t = await setupCallsHarness('web_districts');
});

afterAll(async () => {
  await t.dispose();
});

function list(headers: Record<string, string>, query = ''): Promise<Response> {
  return call(listDistrictsRoute, {
    path: `/api/v1/districts${query}`,
    headers,
  });
}

describe('GET /api/v1/districts', () => {
  it('lists every district for anonymous clients, sorted, matching the contract', async () => {
    const response = await list(MOBILE);
    const body = listDistrictsResponseSchema.parse(await expectJson(response, 200));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    const sorted = [...body.items].sort(
      (a, b) =>
        (a.provinceSlug < b.provinceSlug ? -1 : a.provinceSlug > b.provinceSlug ? 1 : 0) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
    expect(body.items).toEqual(sorted);
    expect(body.items).toContainEqual({
      id: t.districtId,
      province: 'İstanbul',
      provinceSlug: 'istanbul',
      name: 'Kadıköy',
      slug: 'kadikoy',
      centroid: { latitude: 40.99, longitude: 29.03 },
    });
  });

  it('answers web and signed-in callers the same list', async () => {
    const user = await account(t);
    const anonymousList = await expectJson(await list(WEB), 200);
    expect(await expectJson(await list(user.headers), 200)).toEqual(anonymousList);
  });

  it('narrows the list to one province and returns an empty list for an unknown one', async () => {
    const province = `il-${label()}`;
    await t.db.insert(districts).values([
      {
        il: 'Test Il',
        ilce: 'B',
        ilSlug: province,
        slug: 'b-ilce',
        centroid: { lng: 30, lat: 40 },
      },
      {
        il: 'Test Il',
        ilce: 'A',
        ilSlug: province,
        slug: 'a-ilce',
        centroid: { lng: 31, lat: 41 },
      },
    ]);
    const body = listDistrictsResponseSchema.parse(
      await expectJson(await list(MOBILE, `?province=${province}`), 200),
    );
    expect(body.items.map((item) => item.slug)).toEqual(['a-ilce', 'b-ilce']);
    expect(body.items.every((item) => item.provinceSlug === province)).toBe(true);
    const none = listDistrictsResponseSchema.parse(
      await expectJson(await list(MOBILE, '?province=yok-boyle-bir-il'), 200),
    );
    expect(none.items).toEqual([]);
  });

  it('requires the client header and rejects bad or unknown query input', async () => {
    await expectProblem(await list({}), 400, 'validation_failed');
    await expectProblem(await list({ 'x-kadro-client': 'desktop' }), 400, 'validation_failed');
    await expectProblem(await list(MOBILE, '?province=Not_A_Slug'), 400, 'validation_failed');
    await expectProblem(await list(MOBILE, '?cursor=x'), 400, 'validation_failed');
  });
});
