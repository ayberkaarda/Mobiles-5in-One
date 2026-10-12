import { isSlug, SLUG_PATTERN, StopPairOut } from './public-types';

export const ROUTE_INDEX_MIN_LINES = 50;

export function resolveRoutePair(
  param: string,
  pairs: StopPairOut[],
): { pair: StopPairOut; canonical: boolean } | null {
  if (param.length > 241 || !SLUG_PATTERN.test(param)) return null;
  const direct = pairs.find((pair) => param === `${pair.from_stop.slug}-${pair.to_stop.slug}`);
  if (direct) return { pair: direct, canonical: true };
  const reverse = pairs.find((pair) => param === `${pair.to_stop.slug}-${pair.from_stop.slug}`);
  return reverse ? { pair: reverse, canonical: false } : null;
}

export function routePairPath(city: string, pair: StopPairOut): string {
  if (!isSlug(city) || !isSlug(pair.from_stop.slug) || !isSlug(pair.to_stop.slug)) {
    throw new Error('Invalid route slug');
  }
  return `/${city}/rota/${pair.from_stop.slug}-${pair.to_stop.slug}`;
}

export function routeIndexable(publishedLineCount: number): boolean {
  return Number.isSafeInteger(publishedLineCount) && publishedLineCount >= ROUTE_INDEX_MIN_LINES;
}
