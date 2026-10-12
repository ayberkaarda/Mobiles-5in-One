import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { apiPath, PublicApiClient, PublicApiResult } from '../data/public-api.client';
import {
  CityDetail,
  CityList,
  isCityDetail,
  isCityList,
  isLine,
  isLineList,
  isSlug,
  isStopDetail,
  isStopPairs,
  LineList,
  LineOut,
  LineSummary,
  StopDetail,
  StopPairOut,
} from './public-types';
import { isRoutePairParam, resolveRoutePair } from './route-pair';

export type PageData<T> = ({ state: 'ok' } & T) | { state: 'not_found' } | { state: 'unavailable' };
export interface HomeData {
  cities: CityList;
}
export interface CityData {
  city: CityDetail;
}
export interface LineListData extends CityData {
  lines: LineList;
  page: number;
  hasNext: boolean;
}
export interface LineData extends CityData {
  line: LineOut;
}
export interface StopData extends CityData {
  stop: StopDetail;
}
export interface RouteData extends CityData {
  pair: StopPairOut;
  canonical: boolean;
  from: StopDetail;
  to: StopDetail;
  lines: LineSummary[];
}

const missing = { state: 'not_found' } as const;
function failure(result: { kind: 'not_found' | 'unavailable' }): PageData<never> {
  return { state: result.kind };
}
function cityRequest(api: PublicApiClient, slug: string): Promise<PublicApiResult<CityDetail>> {
  return api.get(apiPath('/cities/{slug}', { slug }), undefined, isCityDetail);
}

export const homeResolver: ResolveFn<PageData<HomeData>> = async () => {
  const result = await inject(PublicApiClient).get('/cities', undefined, isCityList);
  return result.ok ? { state: 'ok', cities: result.data } : { state: 'unavailable' };
};

export const cityHubResolver: ResolveFn<PageData<CityData>> = async (route) => {
  const slug = route.paramMap.get('sehir');
  if (!isSlug(slug)) return missing;
  const result = await cityRequest(inject(PublicApiClient), slug);
  return result.ok ? { state: 'ok', city: result.data } : failure(result);
};

export const lineListResolver: ResolveFn<PageData<LineListData>> = async (route) => {
  const slug = route.paramMap.get('sehir');
  const pages = route.queryParamMap.getAll('sayfa');
  const raw = pages[0];
  if (!isSlug(slug) || pages.length > 1 || (raw !== undefined && !/^[1-9][0-9]{0,3}$/.test(raw))) {
    return missing;
  }
  const page = raw === undefined ? 1 : Number(raw);
  const api = inject(PublicApiClient);
  const city = await cityRequest(api, slug);
  if (!city.ok) return failure(city);
  const lines = await api.get(
    '/lines',
    { city: slug, limit: 51, offset: (page - 1) * 50 },
    isLineList,
  );
  if (!lines.ok) return failure(lines);
  if (page > 1 && lines.data.length === 0) return missing;
  return {
    state: 'ok',
    city: city.data,
    lines: lines.data.slice(0, 50),
    page,
    hasNext: lines.data.length > 50,
  };
};

export const lineResolver: ResolveFn<PageData<LineData>> = async (route) => {
  const citySlug = route.paramMap.get('sehir');
  const slug = route.paramMap.get('slug');
  if (!isSlug(citySlug) || !isSlug(slug)) return missing;
  const api = inject(PublicApiClient);
  const city = await cityRequest(api, citySlug);
  if (!city.ok) return failure(city);
  const line = await api.get(apiPath('/lines/{slug}', { slug }), { city: citySlug }, isLine);
  if (!line.ok) return failure(line);
  return line.data.status === 'published'
    ? { state: 'ok', city: city.data, line: line.data }
    : missing;
};

export const stopResolver: ResolveFn<PageData<StopData>> = async (route) => {
  const citySlug = route.paramMap.get('sehir');
  const slug = route.paramMap.get('slug');
  if (!isSlug(citySlug) || !isSlug(slug)) return missing;
  const api = inject(PublicApiClient);
  const city = await cityRequest(api, citySlug);
  if (!city.ok) return failure(city);
  const stop = await api.get(apiPath('/stops/{slug}', { slug }), { city: citySlug }, isStopDetail);
  return stop.ok ? { state: 'ok', city: city.data, stop: stop.data } : failure(stop);
};

export const routeResolver: ResolveFn<PageData<RouteData>> = async (route) => {
  const citySlug = route.paramMap.get('sehir');
  const param = route.paramMap.get('pair');
  if (!isSlug(citySlug) || !isRoutePairParam(param)) return missing;
  const api = inject(PublicApiClient);
  const city = await cityRequest(api, citySlug);
  if (!city.ok) return failure(city);
  const pairs = await api.get(
    apiPath('/cities/{slug}/stop-pairs', { slug: citySlug }),
    { limit: 200 },
    isStopPairs,
  );
  if (!pairs.ok) return failure(pairs);
  const match = resolveRoutePair(param, pairs.data.pairs);
  if (!match) return missing;
  const [from, to] = await Promise.all([
    api.get(
      apiPath('/stops/{slug}', { slug: match.pair.from_stop.slug }),
      { city: citySlug },
      isStopDetail,
    ),
    api.get(
      apiPath('/stops/{slug}', { slug: match.pair.to_stop.slug }),
      { city: citySlug },
      isStopDetail,
    ),
  ]);
  if (!from.ok) return failure(from);
  if (!to.ok) return failure(to);
  const toSlugs = new Set(to.data.lines.map((line) => line.slug));
  return {
    state: 'ok',
    city: city.data,
    ...match,
    from: from.data,
    to: to.data,
    lines: from.data.lines.filter((line) => toSlugs.has(line.slug)),
  };
};
