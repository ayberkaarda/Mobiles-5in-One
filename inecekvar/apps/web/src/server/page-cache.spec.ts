// @vitest-environment node
import { loadWebServerConfig } from './config';
import {
  LayeredPageCache,
  MemoryLruPageCache,
  pageCacheKey,
  RedisPageCache,
  renderPath,
  type CachedPage,
  type RedisLikeClient,
} from './page-cache';

function page(body: string, storedAt = 0): CachedPage {
  return { status: 200, contentType: 'text/html', body, storedAt };
}

describe('memory page cache', () => {
  it('evicts the least recently read entry by count', async () => {
    const cache = new MemoryLruPageCache({ maxEntries: 2, maxBytes: 100 });
    await cache.set('a', page('first'), 1000);
    await cache.set('b', page('second'), 1000);
    expect(await cache.get('a')).toEqual(page('first'));
    await cache.set('c', page('third'), 1000);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toEqual(page('first'));
    expect(await cache.get('c')).toEqual(page('third'));
  });

  it('accounts for UTF-8 bytes and skips an oversized entry', async () => {
    const cache = new MemoryLruPageCache({ maxEntries: 10, maxBytes: 6 });
    await cache.set('a', page('şş'), 1000);
    await cache.set('b', page('abc'), 1000);
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('b')).toEqual(page('abc'));
    await cache.set('huge', page('şşşş'), 1000);
    expect(await cache.get('huge')).toBeUndefined();
    expect(await cache.get('b')).toEqual(page('abc'));
  });

  it('releases bytes when replacing an entry', async () => {
    const cache = new MemoryLruPageCache({ maxEntries: 10, maxBytes: 6 });
    await cache.set('a', page('abcd'), 1000);
    await cache.set('a', page('a'), 1000);
    await cache.set('b', page('bcdef'), 1000);
    expect(await cache.get('a')).toEqual(page('a'));
    expect(await cache.get('b')).toEqual(page('bcdef'));
  });

  it('expires entries at their deadline with an injected clock', async () => {
    let now = 10;
    const cache = new MemoryLruPageCache({ maxEntries: 2, maxBytes: 100, now: () => now });
    await cache.set('a', page('first'), 100);
    now = 109;
    expect(await cache.get('a')).toEqual(page('first'));
    now = 110;
    expect(await cache.get('a')).toBeUndefined();
  });

  it('removes expired entries before evicting live entries', async () => {
    let now = 0;
    const cache = new MemoryLruPageCache({ maxEntries: 2, maxBytes: 100, now: () => now });
    await cache.set('live', page('live'), 1000);
    await cache.set('expired', page('expired'), 10);
    now = 10;
    await cache.set('new', page('new'), 1000);
    expect(await cache.get('live')).toEqual(page('live'));
    expect(await cache.get('expired')).toBeUndefined();
  });
});

describe('page cache keys', () => {
  const config = loadWebServerConfig({ IV_WEB_CACHE_QUERY_ALLOWLIST: 'sayfa,sort' });
  function key(overrides: Partial<Parameters<typeof pageCacheKey>[0]> = {}): string | undefined {
    return pageCacheKey(
      {
        method: 'GET',
        hostname: 'inecekvar.app',
        path: '/istanbul',
        query: new URLSearchParams(),
        headers: {},
        ...overrides,
      },
      config,
    );
  }

  it.each([{ cookie: '' }, { cookie: 'session=x' }, { Authorization: '' }])(
    'bypasses requests with private headers: %s',
    (headers) => {
      expect(key({ headers })).toBeUndefined();
    },
  );

  it.each([
    '/admin',
    '/Admin/x',
    '/%61dmin',
    '/%41dmin/x',
    '//x',
    '/a/../b',
    '/a/./b',
    '/istanbul/',
    '/a\\b',
    '/a%2fb',
    '/a%5Cb',
    '/a/%2e%2e/b',
    '/%ff',
    '/%C3%28',
    '/%',
    '/%1',
    '/x y',
    'relative',
    '/' + 'a'.repeat(512),
  ])('bypasses a private or unnormalized path: %s', (path) => {
    expect(key({ path })).toBeUndefined();
  });

  it('permits root and valid UTF-8 percent escapes', () => {
    expect(key({ path: '/' })).toBe('v1|inecekvar.app|/|');
    expect(key({ path: '/%C5%9F' })).toBe('v1|inecekvar.app|/%C5%9F|');
  });

  it('ignores unlisted query parameters and sorts listed ones', () => {
    expect(key({ query: new URLSearchParams('utm_source=x') })).toBe(key());
    const query = new URLSearchParams('sort=a+b&sayfa=2&utm_source=x');
    expect(key({ query })).toBe('v1|inecekvar.app|/istanbul|sayfa=2&sort=a+b');
    expect(renderPath('/istanbul', query, config.cacheQueryAllowlist)).toBe(
      '/istanbul?sayfa=2&sort=a+b',
    );
  });

  it.each(['sayfa=1&sayfa=2', 'x=1&x=2', 'sayfa=1&%73ayfa=2'])(
    'bypasses repeated parameters: %s',
    (query) => {
      expect(key({ query: new URLSearchParams(query) })).toBeUndefined();
    },
  );

  it('limits only listed values to 64 characters', () => {
    expect(key({ query: new URLSearchParams({ sayfa: 'a'.repeat(65) }) })).toBeUndefined();
    expect(key({ query: new URLSearchParams({ sayfa: 'a'.repeat(64) }) })).toBeDefined();
    expect(key({ query: new URLSearchParams({ x: 'a'.repeat(65) }) })).toBe(key());
  });

  it('shares GET and HEAD entries but bypasses other methods', () => {
    expect(key({ method: 'HEAD' })).toBe(key());
    expect(key({ method: 'POST' })).toBeUndefined();
  });

  it('keeps different hosts separate', () => {
    expect(key({ hostname: 'www.inecekvar.app' })).not.toBe(key());
  });
});

describe('Redis page cache', () => {
  function clientFixture() {
    const values = new Map<string, string>();
    const client: RedisLikeClient = {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: string, _mode: 'PX', _ttlMs: number) => {
        values.set(key, value);
        return 'OK';
      }),
    };
    return { client, values, cache: new RedisPageCache(client) };
  }

  it('round trips a validated page using hashed keys and millisecond expiry', async () => {
    const { client, values, cache } = clientFixture();
    const value = page('<p>İnecek Var</p>', 123);
    expect(await cache.get('missing')).toBeUndefined();
    await cache.set('public-page', value, 600_000);
    expect(await cache.get('public-page')).toEqual(value);
    const storedKey = [...values.keys()][0];
    if (!storedKey) {
      throw new Error('Missing Redis key');
    }
    expect(storedKey).toMatch(/^iv:web:page:v1:[a-f0-9]{64}$/);
    expect(client.set).toHaveBeenCalledWith(storedKey, JSON.stringify(value), 'PX', 600_000);
  });

  it.each([
    '{',
    'null',
    '[]',
    '{"status":404,"contentType":"text/html","body":"x","storedAt":1}',
    '{"status":200,"contentType":7,"body":"x","storedAt":1}',
    '{"status":200,"contentType":"text/html","body":7,"storedAt":1}',
    '{"status":200,"contentType":"text/html","body":"x","storedAt":"1"}',
    '{"status":200,"contentType":"text/html","body":"x","storedAt":1e999}',
  ])('treats corrupt or invalid JSON as a miss: %s', async (json) => {
    const { values, cache } = clientFixture();
    await cache.set('key', page('body'), 1000);
    const storedKey = [...values.keys()][0];
    if (!storedKey) {
      throw new Error('Missing Redis key');
    }
    values.set(storedKey, json);
    expect(await cache.get('key')).toBeUndefined();
  });

  it('absorbs client failures and reports only once across reads and writes', async () => {
    const onError = vi.fn();
    const client: RedisLikeClient = {
      get: vi.fn(async () => {
        throw new Error('Unavailable');
      }),
      set: vi.fn(async () => {
        throw new Error('Unavailable');
      }),
    };
    const cache = new RedisPageCache(client, onError);
    expect(await cache.get('a')).toBeUndefined();
    await expect(cache.set('a', page('body'), 1000)).resolves.toBeUndefined();
    expect(await cache.get('b')).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('layered page cache', () => {
  it('writes both stores and consults memory first', async () => {
    const memory = new MemoryLruPageCache({ maxEntries: 2, maxBytes: 100, now: () => 0 });
    const redis = new MemoryLruPageCache({ maxEntries: 2, maxBytes: 100, now: () => 0 });
    const redisGet = vi.spyOn(redis, 'get');
    const cache = new LayeredPageCache(memory, redis, 1000, () => 0);
    await cache.set('a', page('first'), 1000);
    expect(await cache.get('a')).toEqual(page('first'));
    expect(redisGet).not.toHaveBeenCalled();
    expect(await redis.get('a')).toEqual(page('first'));
  });

  it('warms memory from Redis while preserving the original deadline', async () => {
    let now = 0;
    const memory = new MemoryLruPageCache({ maxEntries: 2, maxBytes: 100, now: () => now });
    const redis = new MemoryLruPageCache({ maxEntries: 2, maxBytes: 100, now: () => now });
    const memorySet = vi.spyOn(memory, 'set');
    await redis.set('a', page('first', 0), 1000);
    now = 800;
    const cache = new LayeredPageCache(memory, redis, 1000, () => now);
    expect(await cache.get('a')).toEqual(page('first', 0));
    expect(memorySet).toHaveBeenCalledWith('a', page('first', 0), 200);
    now = 1000;
    expect(await memory.get('a')).toBeUndefined();
  });
});
