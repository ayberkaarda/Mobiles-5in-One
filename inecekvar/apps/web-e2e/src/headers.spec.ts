import { expect, test } from '@playwright/test';

const production = 'http://127.0.0.1:57993';
const publicHost = { host: 'inecekvar.app' };
const noncePlaceholder = 'ivcspnonce0placeholder0value';

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((entry) => {
      const [name, ...values] = entry.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

function checkNonces(policy: string, body: string): string {
  const scripts = directives(policy).get('script-src') ?? [];
  const nonces = scripts.filter((value) => /^'nonce-[^']+'$/.test(value));
  expect(nonces).toHaveLength(1);
  const nonce = nonces[0].slice("'nonce-".length, -1);
  const scriptTags = [...body.matchAll(/<script\b([^>]*)>/gi)];
  const inlineScripts = scriptTags.filter((match) => {
    const attributes = match[1] ?? '';
    const type = attributes.match(/\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const value = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim().toLowerCase();
    return (
      !/\ssrc(?:\s*=|\s|$)/i.test(attributes) && ['', 'text/javascript', 'module'].includes(value)
    );
  });
  for (const script of inlineScripts) {
    expect(script[1].match(/\bnonce="([^"]*)"/i)?.[1]).toBe(nonce);
  }
  const dataScripts = scriptTags.filter((match) =>
    /\stype="application\/(?:json|ld\+json)"/i.test(match[1] ?? ''),
  );
  expect(dataScripts.length).toBeGreaterThan(0);
  for (const script of dataScripts) {
    expect(script[1]).not.toMatch(/\snonce(?:\s*=|\s|$)/i);
  }
  const roots = [...body.matchAll(/\bngcspnonce="([^"]*)"/gi)];
  expect(roots.length).toBeGreaterThan(0);
  for (const root of roots) {
    expect(root[1]).toBe(nonce);
  }
  expect(body).not.toMatch(new RegExp(`\\s(?:nonce|ngcspnonce)="${noncePlaceholder}"`, 'i'));
  return nonce;
}

test('test environment robots and page cache keys', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');

  const first = await request.get('/');
  expect(first.status()).toBe(200);
  expect(first.headers()['x-cache']).toBe('MISS');
  const tracked = await request.get('/?utm_source=x');
  expect(tracked.status()).toBe(200);
  expect(tracked.headers()['x-cache']).toBe('HIT');
  const paged = await request.get('/?sayfa=2');
  expect(paged.status()).toBe(200);
  expect(paged.headers()['x-cache']).toBe('MISS');
  const privateRequest = await request.get('/', { headers: { cookie: 'visit=e2e' } });
  expect(privateRequest.status()).toBe(200);
  expect(privateRequest.headers()['x-cache']).toBe('BYPASS');

  const firstNonce = checkNonces(first.headers()['content-security-policy'], await first.text());
  const hitNonce = checkNonces(tracked.headers()['content-security-policy'], await tracked.text());
  expect(hitNonce).not.toBe(firstNonce);
});

test('production security headers and per-response script nonces', async ({ request }) => {
  const first = await request.get(production + '/', { headers: publicHost });
  expect(first.status()).toBe(200);
  const headers = first.headers();
  expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
  const policy = headers['content-security-policy'];
  const csp = directives(policy);
  expect(csp.get('default-src')).toEqual(["'self'"]);
  expect(csp.get('script-src')).toContain("'self'");
  expect(csp.get('object-src')).toEqual(["'none'"]);
  expect(csp.get('base-uri')).toEqual(["'self'"]);
  expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  expect(csp.get('img-src')).toEqual(["'self'", 'data:', 'https://tiles.inecekvar.app']);
  expect(csp.get('connect-src')).toEqual([
    "'self'",
    'https://api.inecekvar.app',
    'https://tiles.inecekvar.app',
  ]);
  expect(csp.get('upgrade-insecure-requests')).toEqual([]);
  expect(policy).not.toMatch(/\bwss?:/i);
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toBe('geolocation=(self), camera=(), microphone=()');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-powered-by']).toBeUndefined();
  expect(headers['x-cache']).toBeUndefined();
  expect(headers['cache-control']).toContain('no-cache');
  expect(headers['cache-control']).not.toContain('public');

  const firstNonce = checkNonces(policy, await first.text());
  const second = await request.get(production + '/', { headers: publicHost });
  expect(second.status()).toBe(200);
  const secondNonce = checkNonces(second.headers()['content-security-policy'], await second.text());
  expect(secondNonce).not.toBe(firstNonce);
});

test('production host, method, robots and health guards', async ({ request }) => {
  const refused = await request.get(production + '/', { headers: { host: 'evil.example' } });
  expect(refused.status()).toBe(400);
  const alias = await request.get(production + '/', {
    headers: { host: 'www.inecekvar.app' },
    maxRedirects: 0,
  });
  expect(alias.status()).toBe(301);
  expect(alias.headers()['location']).toBe('https://inecekvar.app/');
  const post = await request.post(production + '/', { headers: publicHost });
  expect(post.status()).toBe(405);
  expect(post.headers()['allow']).toBe('GET, HEAD');
  const robots = await request.get(production + '/robots.txt', { headers: publicHost });
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toBe(
    'User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://inecekvar.app/sitemap.xml\n',
  );
  const health = await request.get(production + '/healthz');
  expect(health.status()).toBe(200);
  expect(await health.text()).toBe('ok');
});

test('missing and unavailable pages are never stored in the page cache', async ({ request }) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const missing = await request.get('/olmayan-sayfa');
    expect(missing.status()).toBe(404);
    expect(missing.headers()['x-cache']).toBe('MISS');
    const unavailable = await request.get('http://127.0.0.1:57994/durum');
    expect(unavailable.status()).toBe(503);
    expect(unavailable.headers()['x-cache']).toBe('MISS');
    expect(unavailable.headers()['retry-after']).toBe('120');
  }
});
