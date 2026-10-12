import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  ResolveFn,
  RouterStateSnapshot,
} from '@angular/router';
import { PublicApiClient, PublicApiResult } from '../data/public-api.client';
import {
  cityHubResolver,
  homeResolver,
  lineListResolver,
  lineResolver,
  PageData,
  routeResolver,
  stopResolver,
} from './page-data';
import {
  isCityDetail,
  isCityList,
  isLine,
  isLineList,
  isStopDetail,
  isStopPairs,
} from './public-types';
import { cityData, lineData, pairData, stopData } from './test-data';

afterEach(() => TestBed.resetTestingModule());
function setup() {
  const get =
    vi.fn<
      (
        path: string,
        query: Readonly<Record<string, string | number>> | undefined,
        guard: (value: unknown) => boolean,
      ) => Promise<PublicApiResult<unknown>>
    >();
  TestBed.configureTestingModule({ providers: [{ provide: PublicApiClient, useValue: { get } }] });
  return get;
}
function read<T>(
  resolver: ResolveFn<PageData<T>>,
  params: Record<string, string> = {},
  query: Record<string, string | string[]> = {},
): Promise<PageData<T>> {
  const route = {
    paramMap: convertToParamMap(params),
    queryParamMap: convertToParamMap(query),
  } as ActivatedRouteSnapshot;
  return TestBed.runInInjectionContext(() => resolver(route, {} as RouterStateSnapshot)) as Promise<
    PageData<T>
  >;
}
const ok = (data: unknown): PublicApiResult<unknown> => ({ ok: true, data });
const missing = { ok: false, kind: 'not_found', status: 404, code: null } as const;
const unavailable = { ok: false, kind: 'unavailable', status: 0, code: null } as const;

describe('public page resolvers', () => {
  it('reads home cities with the shared guard', async () => {
    const get = setup();
    get.mockResolvedValueOnce(ok([cityData()]));
    expect(await read(homeResolver)).toEqual({ state: 'ok', cities: [cityData()] });
    expect(get).toHaveBeenCalledExactlyOnceWith('/cities', undefined, isCityList);
  });
  it('rejects invalid params and page numbers without an API call', async () => {
    const get = setup();
    expect(await read(cityHubResolver, { sehir: 'İstanbul' })).toEqual({ state: 'not_found' });
    expect(await read(lineResolver, { sehir: 'istanbul', slug: '../hat' })).toEqual({
      state: 'not_found',
    });
    expect(await read(stopResolver, { sehir: 'Bad', slug: 'durak' })).toEqual({
      state: 'not_found',
    });
    for (const pair of ['a', 'a--b', 'A-b', 'a/b', 'a'.repeat(242), 'a'.repeat(121) + '-b']) {
      expect(await read(routeResolver, { sehir: 'istanbul', pair })).toEqual({
        state: 'not_found',
      });
    }
    for (const sayfa of ['', '0', '01', '-1', '1.5', '10000', ' 2', ['1', '2']]) {
      expect(await read(lineListResolver, { sehir: 'istanbul' }, { sayfa })).toEqual({
        state: 'not_found',
      });
    }
    expect(get).not.toHaveBeenCalled();
  });
  it.each([missing, unavailable])('maps API failure $kind consistently', async (result) => {
    const get = setup();
    get.mockResolvedValue(result);
    expect(await read(homeResolver)).toEqual({ state: 'unavailable' });
    expect(await read(cityHubResolver, { sehir: 'istanbul' })).toEqual({ state: result.kind });
    expect(await read(lineListResolver, { sehir: 'istanbul' })).toEqual({ state: result.kind });
    expect(await read(lineResolver, { sehir: 'istanbul', slug: 'hat' })).toEqual({
      state: result.kind,
    });
    expect(await read(stopResolver, { sehir: 'istanbul', slug: 'durak' })).toEqual({
      state: result.kind,
    });
    expect(await read(routeResolver, { sehir: 'istanbul', pair: 'ilk-son' })).toEqual({
      state: result.kind,
    });
  });
  it('reads city, line and stop endpoints with encoded path parameters and guards', async () => {
    const get = setup();
    const city = cityData();
    const line = lineData();
    get.mockResolvedValueOnce(ok(city));
    expect(await read(cityHubResolver, { sehir: city.slug })).toEqual({ state: 'ok', city });
    expect(get).toHaveBeenLastCalledWith('/cities/ornek-sehir', undefined, isCityDetail);
    get.mockResolvedValueOnce(ok(city)).mockResolvedValueOnce(ok(line));
    expect(await read(lineResolver, { sehir: city.slug, slug: line.slug })).toEqual({
      state: 'ok',
      city,
      line,
    });
    expect(get).toHaveBeenLastCalledWith('/lines/ornek-hat', { city: city.slug }, isLine);
    const stop = { ...stopData(), lines: [line] };
    get.mockResolvedValueOnce(ok(city)).mockResolvedValueOnce(ok(stop));
    expect(await read(stopResolver, { sehir: city.slug, slug: stop.slug })).toEqual({
      state: 'ok',
      city,
      stop,
    });
    expect(get).toHaveBeenLastCalledWith('/stops/ilk-durak', { city: city.slug }, isStopDetail);
  });
  it('hides unpublished lines and maps detail failures', async () => {
    const get = setup();
    get
      .mockResolvedValueOnce(ok(cityData()))
      .mockResolvedValueOnce(ok(lineData({ status: 'draft' })));
    expect(await read(lineResolver, { sehir: 'ornek-sehir', slug: 'ornek-hat' })).toEqual({
      state: 'not_found',
    });
    get.mockResolvedValueOnce(ok(cityData())).mockResolvedValueOnce(unavailable);
    expect(await read(stopResolver, { sehir: 'ornek-sehir', slug: 'durak' })).toEqual({
      state: 'unavailable',
    });
  });
  it.each([1, 2, 9999])('reads 51 rows with a 50-row offset for page %s', async (page) => {
    const get = setup();
    const lines = Array.from({ length: 51 }, (_, n) => lineData({ slug: 'hat-' + n }));
    get.mockResolvedValueOnce(ok(cityData())).mockResolvedValueOnce(ok(lines));
    const result = await read(
      lineListResolver,
      { sehir: 'ornek-sehir' },
      page === 1 ? {} : { sayfa: String(page) },
    );
    expect(result).toEqual({
      state: 'ok',
      city: cityData(),
      lines: lines.slice(0, 50),
      page,
      hasNext: true,
    });
    expect(get).toHaveBeenLastCalledWith(
      '/lines',
      { city: 'ornek-sehir', limit: 51, offset: (page - 1) * 50 },
      isLineList,
    );
  });
  it('keeps the empty first page and rejects an empty later page', async () => {
    const get = setup();
    get.mockResolvedValueOnce(ok(cityData())).mockResolvedValueOnce(ok([]));
    expect(await read(lineListResolver, { sehir: 'ornek-sehir' })).toEqual({
      state: 'ok',
      city: cityData(),
      lines: [],
      page: 1,
      hasNext: false,
    });
    get.mockResolvedValueOnce(ok(cityData())).mockResolvedValueOnce(ok([]));
    expect(await read(lineListResolver, { sehir: 'ornek-sehir' }, { sayfa: '2' })).toEqual({
      state: 'not_found',
    });
  });
  it('matches API-order pairs and intersects lines in departure-stop order', async () => {
    const get = setup();
    const city = cityData();
    const pair = pairData();
    const a = lineData({ slug: 'a' }),
      b = lineData({ slug: 'b' }),
      c = lineData({ slug: 'c' });
    const from = { ...stopData(pair.from_stop.slug), lines: [b, a, c] };
    const to = { ...stopData(pair.to_stop.slug), lines: [a, b] };
    get
      .mockResolvedValueOnce(ok(city))
      .mockResolvedValueOnce(
        ok({ city: city.slug, basis: 'shared_published_lines', pairs: [pair] }),
      )
      .mockResolvedValueOnce(ok(from))
      .mockResolvedValueOnce(ok(to));
    expect(
      await read(routeResolver, {
        sehir: city.slug,
        pair: pair.to_stop.slug + '-' + pair.from_stop.slug,
      }),
    ).toEqual({ state: 'ok', city, pair, canonical: false, from, to, lines: [b, a] });
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/cities/ornek-sehir/stop-pairs',
      { limit: 200 },
      isStopPairs,
    );
    expect(get).toHaveBeenNthCalledWith(
      3,
      '/stops/' + pair.from_stop.slug,
      { city: city.slug },
      isStopDetail,
    );
    expect(get).toHaveBeenNthCalledWith(
      4,
      '/stops/' + pair.to_stop.slug,
      { city: city.slug },
      isStopDetail,
    );
  });
  it('rejects unknown pairs before requesting their stops', async () => {
    const get = setup();
    get
      .mockResolvedValueOnce(ok(cityData()))
      .mockResolvedValueOnce(
        ok({ city: 'ornek-sehir', basis: 'shared_published_lines', pairs: [pairData()] }),
      );
    expect(await read(routeResolver, { sehir: 'ornek-sehir', pair: 'unknown-other' })).toEqual({
      state: 'not_found',
    });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
