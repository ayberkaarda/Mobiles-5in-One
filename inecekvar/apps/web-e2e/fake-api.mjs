import { createServer } from 'node:http';

const port = Number(process.env.IV_E2E_FAKE_API_PORT ?? 57991);

// Deterministic public data for the web e2e run. Shapes follow docs/api/openapi.json.
const HOSTILE_NAME = 'Hat </script><script>alert(1)</script> x';
let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function city(slug, name, isSample, lastmod) {
  return {
    name,
    slug,
    is_sample: isSample,
    bbox: [28.9, 40.9, 29.2, 41.1],
    centroid: [29.05, 41.0],
    timezone: 'Europe/Istanbul',
    pack_version: 1,
    lastmod,
    lines: [],
    stops: new Map(),
  };
}

function stop(owner, slug, name, location) {
  const value = { id: id(), slug, name, kind: 'stop', location };
  owner.stops.set(slug, value);
  return value;
}

function line(owner, input) {
  const value = {
    id: id(),
    slug: input.slug,
    code: input.code,
    name: input.name,
    mode: input.mode ?? 'dolmus',
    status: 'published',
    version_no: input.version_no ?? 1,
    published_at: input.published_at ?? '2026-09-15T07:00:00Z',
    geometry: {
      type: 'LineString',
      coordinates: input.geometry ?? input.stops.map((item) => item.location),
    },
    stops: input.stops,
    fare_minor: input.fare_minor ?? null,
    fare_updated_at: input.fare_updated_at ?? null,
    hours_text: input.hours_text ?? null,
    payment_methods: input.payment_methods ?? [],
    hail_notes: input.hail_notes ?? null,
    last_verified_at: input.last_verified_at ?? null,
    contributor_count: input.contributor_count ?? 1,
  };
  owner.lines.push(value);
  return value;
}

const istanbul = city('istanbul', 'İstanbul', false, '2026-10-01T09:30:00Z');
const izmir = city('izmir', 'İzmir', false, '2026-09-20T10:00:00+03:00');
const empty = city('bos-sehir', 'Boş Şehir', false, null);
const sample = city('ornek-test-sehri', '[ÖRNEK] Test Şehri', true, '2026-09-01T12:00:00Z');
const cities = [istanbul, izmir, empty, sample];

const kadikoy = [
  stop(istanbul, 'kadikoy-rihtim', 'Kadıköy Rıhtım', [29.0236, 40.9917]),
  stop(istanbul, 'moda', 'Moda', [29.0275, 40.9829]),
  stop(istanbul, 'fenerbahce', 'Fenerbahçe', [29.0389, 40.9706]),
  stop(istanbul, 'suadiye', 'Suadiye', [29.0802, 40.9601]),
  stop(istanbul, 'bostanci-iskele', 'Bostancı İskele', [29.0947, 40.9531]),
];
const kadikoyPath = Array.from({ length: 20 }, (_, index) => {
  const t = index / 19;
  return [
    Number((29.0236 + (29.0947 - 29.0236) * t).toFixed(5)),
    Number((40.9917 + (40.9531 - 40.9917) * t + Math.sin(t * Math.PI) * 0.004).toFixed(5)),
  ];
});
line(istanbul, {
  slug: 'kadikoy-bostanci',
  code: '16D',
  name: 'Kadıköy–Bostancı',
  mode: 'minibus',
  stops: kadikoy,
  geometry: kadikoyPath,
  fare_minor: 4500,
  fare_updated_at: '2026-09-30T08:00:00+03:00',
  hours_text: 'Her gün 06:00–00:30\nGece seyrek',
  payment_methods: ['nakit', 'istanbulkart', 'bilinmeyen'],
  hail_notes: 'El kaldırmanız yeterli.',
  last_verified_at: '2026-10-01T09:30:00Z',
  contributor_count: 7,
  version_no: 3,
  published_at: '2026-10-01T09:30:00Z',
});
line(istanbul, {
  slug: 'kotu-isim',
  code: 'K1',
  name: HOSTILE_NAME,
  stops: [stop(istanbul, 'kotu-durak', '<img src=x onerror=alert(1)>', [29.03, 41.01]), kadikoy[1]],
  hail_notes: '<b>kalın değil</b>',
  contributor_count: 0,
  published_at: '2026-09-28T06:00:00Z',
});
for (let index = 1; index <= 54; index += 1) {
  const number = String(index).padStart(2, '0');
  const a = stop(istanbul, `durak-${number}-a`, `Durak ${number} A`, [29 + index / 1000, 41.02]);
  const b = stop(istanbul, `durak-${number}-b`, `Durak ${number} B`, [29 + index / 1000, 41.04]);
  line(istanbul, {
    slug: `hat-${number}`,
    code: `H${number}`,
    name: `Hat ${number}`,
    stops: [a, b],
    published_at: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T05:00:00Z`,
  });
}

const konak = [
  stop(izmir, 'konak', 'Konak', [27.1287, 38.4189]),
  stop(izmir, 'alsancak', 'Alsancak', [27.1428, 38.4381]),
  stop(izmir, 'bornova', 'Bornova', [27.2167, 38.4622]),
];
line(izmir, { slug: 'konak-bornova', code: 'İ1', name: 'Konak–Bornova', stops: konak });
line(izmir, {
  slug: 'konak-alsancak',
  code: 'İ2',
  name: 'Konak–Alsancak',
  stops: konak.slice(0, 2),
});
line(izmir, {
  slug: 'alsancak-bornova',
  code: 'İ3',
  name: 'Alsancak–Bornova',
  stops: konak.slice(1),
});

const sampleStops = [
  stop(sample, 'ornek-durak-1-1', '[ÖRNEK] Durak 1-1', [29.0, 41.0]),
  stop(sample, 'ornek-durak-1-2', '[ÖRNEK] Durak 1-2', [29.01, 41.0]),
];
line(sample, { slug: 'ornek-hat-1', code: 'Ö1', name: '[ÖRNEK] Hat 1', stops: sampleStops });
line(sample, { slug: 'ornek-hat-2', code: 'Ö2', name: '[ÖRNEK] Hat 2', stops: sampleStops });

for (const item of cities) item.lines.sort((a, b) => a.slug.localeCompare(b.slug));

const summary = (value) => ({
  slug: value.slug,
  code: value.code,
  name: value.name,
  mode: value.mode,
});

function cityOut(value) {
  return {
    name: value.name,
    slug: value.slug,
    is_sample: value.is_sample,
    bbox: value.bbox,
    centroid: value.centroid,
    timezone: value.timezone,
    pack_version: value.pack_version,
    published_line_count: value.lines.length,
  };
}

function cityDetail(value) {
  const recent = [...value.lines]
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .slice(0, 10);
  return {
    ...cityOut(value),
    recently_updated_lines: recent.map((item) => ({
      ...summary(item),
      updated_at: item.published_at,
    })),
    popular_lines: value.lines.slice(0, 10).map(summary),
    lastmod: value.lastmod,
  };
}

function stopDetail(owner, value) {
  return {
    ...value,
    lines: owner.lines
      .filter((item) => item.stops.some((entry) => entry.slug === value.slug))
      .map(summary),
  };
}

const pairs = {
  istanbul: [
    { from: kadikoy[0], to: kadikoy[4], shared: 1 },
    { from: kadikoy[1], to: kadikoy[2], shared: 1 },
  ],
  izmir: [{ from: konak[0], to: konak[2], shared: 1 }],
  'bos-sehir': [],
  'ornek-test-sehri': [{ from: sampleStops[0], to: sampleStops[1], shared: 2 }],
};

function citySitemap(value) {
  const lines = value.lines.map((item) => ({ slug: item.slug, lastmod: item.published_at }));
  const stops = [...value.stops.values()]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((item) => ({
      slug: item.slug,
      lastmod: value.lines
        .filter((entry) => entry.stops.some((s) => s.slug === item.slug))
        .map((entry) => entry.published_at)
        .sort()
        .at(-1),
    }));
  return { city: value.slug, lastmod: value.lastmod ?? '2026-08-01T00:00:00Z', lines, stops };
}

function send(response, status, body, type = 'application/json') {
  response.writeHead(status, { 'content-type': type });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function notFound(response) {
  send(
    response,
    404,
    { type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found', request_id: 'e2e' },
    'application/problem+json',
  );
}

function route(url) {
  const path = url.pathname;
  const query = url.searchParams;
  if (path === '/v1/health') return { status: 'ok' };
  if (path === '/v1/cities') return cities.map(cityOut);
  if (path === '/v1/sitemap') {
    return {
      cities: cities
        .filter((item) => item.lines.length > 0)
        .map((item) => ({
          slug: item.slug,
          lastmod: item.lastmod,
          is_sample: item.is_sample,
          published_line_count: item.lines.length,
        })),
    };
  }
  let match = path.match(/^\/v1\/cities\/([a-z0-9-]+)(\/stop-pairs|\/sitemap)?$/);
  if (match) {
    const owner = cities.find((item) => item.slug === match[1]);
    if (!owner) return null;
    if (match[2] === '/stop-pairs') {
      return {
        city: owner.slug,
        basis: 'shared_published_lines',
        pairs: pairs[owner.slug].map((pair) => ({
          from_stop: { slug: pair.from.slug, name: pair.from.name },
          to_stop: { slug: pair.to.slug, name: pair.to.name },
          shared_line_count: pair.shared,
        })),
      };
    }
    if (match[2] === '/sitemap') return citySitemap(owner);
    return cityDetail(owner);
  }
  const owner = cities.find((item) => item.slug === query.get('city'));
  if (path === '/v1/lines') {
    if (!owner) return [];
    const limit = Number(query.get('limit') ?? 50);
    const offset = Number(query.get('offset') ?? 0);
    return owner.lines
      .slice(offset, offset + limit)
      .map((item) => ({ ...summary(item), id: item.id }));
  }
  match = path.match(/^\/v1\/lines\/([a-z0-9-]+)$/);
  if (match) return owner?.lines.find((item) => item.slug === match[1]) ?? null;
  match = path.match(/^\/v1\/stops\/([a-z0-9-]+)$/);
  if (match) {
    const value = owner?.stops.get(match[1]);
    return value ? stopDetail(owner, value) : null;
  }
  return null;
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/ready') {
    send(response, 200, 'ok', 'text/plain; charset=utf-8');
    return;
  }
  const body = request.method === 'GET' ? route(url) : null;
  if (body === null) {
    notFound(response);
    return;
  }
  send(response, 200, body);
}).listen(port, '127.0.0.1');
