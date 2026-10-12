import {
  resolveRoutePair,
  ROUTE_INDEX_MIN_LINES,
  routeIndexable,
  routePairPath,
} from './route-pair';
import { pairData } from './test-data';

describe('route pair', () => {
  it('matches complete known slugs without splitting at an ambiguous hyphen', () => {
    const pair = pairData();
    expect(resolveRoutePair('ilk-uzun-durak-son-uzun-durak', [pair])).toEqual({
      pair,
      canonical: true,
    });
    expect(routePairPath('ornek-sehir', pair)).toBe(
      '/ornek-sehir/rota/ilk-uzun-durak-son-uzun-durak',
    );
  });

  it('resolves reversed order to the API pair with canonical false', () => {
    const pair = pairData();
    expect(resolveRoutePair('son-uzun-durak-ilk-uzun-durak', [pair])).toEqual({
      pair,
      canonical: false,
    });
  });

  it('prefers an API-order match over a reversed match when both exist', () => {
    const pair = pairData();
    const reverse = { ...pair, from_stop: pair.to_stop, to_stop: pair.from_stop };
    expect(resolveRoutePair('ilk-uzun-durak-son-uzun-durak', [reverse, pair])).toEqual({
      pair,
      canonical: true,
    });
  });

  it.each(['unknown-stop-other-stop', '', 'a--b', 'A-b', 'a/b', 'a%20b', 'a'.repeat(242)])(
    'rejects unknown or invalid pairs %s',
    (param) => expect(resolveRoutePair(param, [pairData()])).toBeNull(),
  );

  it('accepts two maximum-length slugs and rejects invalid path slugs', () => {
    const pair = {
      ...pairData(),
      from_stop: { slug: 'a'.repeat(120), name: 'A' },
      to_stop: { slug: 'b'.repeat(120), name: 'B' },
    };
    expect(resolveRoutePair(pair.from_stop.slug + '-' + pair.to_stop.slug, [pair])?.canonical).toBe(
      true,
    );
    expect(() => routePairPath('../a', pair)).toThrow();
    expect(() => routePairPath('a', { ...pair, from_stop: { slug: 'A', name: 'A' } })).toThrow();
  });

  it.each([
    { count: 49, result: false },
    { count: 50, result: true },
    { count: 51, result: true },
    { count: NaN, result: false },
    { count: Infinity, result: false },
    { count: 50.5, result: false },
  ])('uses the publication threshold for $count lines', ({ count, result }) => {
    expect(ROUTE_INDEX_MIN_LINES).toBe(50);
    expect(routeIndexable(count)).toBe(result);
  });
});
