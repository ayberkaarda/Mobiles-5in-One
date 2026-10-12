import { expect, test } from '@playwright/test';
import {
  expectBreadcrumbs,
  expectGeo,
  HOSTILE_NAME,
  HOSTILE_PATH,
  jsonLdNodes,
  LINE_PATH,
  nodesOfType,
  ROUTE_PATH,
  STOP_PATH,
  TEST_ORIGIN,
  type JsonLdNode,
} from './support';

test.use({ javaScriptEnabled: false });

const pages: { path: string; types: string[] }[] = [
  { path: '/', types: ['Organization', 'WebSite', 'BreadcrumbList'] },
  { path: '/istanbul', types: ['BreadcrumbList'] },
  { path: '/istanbul/hatlar', types: ['BreadcrumbList'] },
  { path: LINE_PATH, types: ['BreadcrumbList', 'BusTrip'] },
  { path: STOP_PATH, types: ['BreadcrumbList', 'BusStop'] },
  { path: ROUTE_PATH, types: ['BreadcrumbList'] },
];

for (const { path, types } of pages) {
  test(`structured data on ${path} parses and has its types`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const nodes = await jsonLdNodes(page);
    expect(nodes.map((node) => node['@type']).sort()).toEqual([...types].sort());
    expectBreadcrumbs(nodes, TEST_ORIGIN, path);
  });
}

test('line page BusTrip names its end stops with coordinates and a provider', async ({ page }) => {
  await page.goto(LINE_PATH);
  const [trip] = nodesOfType(await jsonLdNodes(page), 'BusTrip');
  expect(trip['name']).toBe('Kadıköy–Bostancı');
  expect(trip['url']).toBe(TEST_ORIGIN + LINE_PATH);
  const departure = trip['departureBusStop'] as JsonLdNode;
  const arrival = trip['arrivalBusStop'] as JsonLdNode;
  expectGeo(departure);
  expectGeo(arrival);
  expect(departure['name']).toBe('Kadıköy Rıhtım');
  expect(arrival['name']).toBe('Bostancı İskele');
  expect((departure['geo'] as JsonLdNode)['latitude']).toBeCloseTo(40.9917, 4);
  expect((trip['provider'] as JsonLdNode)['@type']).toBe('Organization');
});

test('stop page BusStop carries its coordinates', async ({ page }) => {
  await page.goto(STOP_PATH);
  const [stop] = nodesOfType(await jsonLdNodes(page), 'BusStop');
  expectGeo(stop);
  expect(stop['name']).toBe('Moda');
});

test('a stored script payload and U+2028 stay data inside JSON-LD', async ({ page }) => {
  await page.goto(HOSTILE_PATH);
  const nodes = await jsonLdNodes(page);
  const [trip] = nodesOfType(nodes, 'BusTrip');
  expect(trip['name']).toBe(HOSTILE_NAME);
  expect((trip['departureBusStop'] as JsonLdNode)['name']).toBe('<img src=x onerror=alert(1)>');
  const html = await page.content();
  const blocks = [
    ...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ];
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    expect(block[1]).toContain('\\u003c/script\\u003e');
  }
});
