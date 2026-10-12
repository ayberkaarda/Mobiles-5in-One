import { expect, type Page } from '@playwright/test';

// Test-only app link values: not a real signing certificate or team. Production sets its own
// values or leaves both unset, which keeps the association files absent.
export const TEST_CERT_SHA256 = Array.from({ length: 32 }, () => 'AB').join(':');
export const TEST_TEAM_ID = 'TESTTEAM01';

export const TEST_ORIGIN = 'http://127.0.0.1:57992';
export const PRODUCTION = 'http://127.0.0.1:57993';
export const PUBLIC_HOST = { host: 'inecekvar.app' };
export const HOSTILE_NAME = 'Hat </script><script>alert(1)</script> x';

export const LINE_PATH = '/istanbul/hat/kadikoy-bostanci';
export const HOSTILE_PATH = '/istanbul/hat/kotu-isim';
export const STOP_PATH = '/istanbul/durak/moda';
export const ROUTE_PATH = '/istanbul/rota/kadikoy-rihtim-bostanci-iskele';

export type JsonLdNode = Record<string, unknown>;

export function codePoints(value: string): number {
  return Array.from(value).length;
}

export function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

/** Parses every JSON-LD block of the page and returns the nodes of their graphs. */
export async function jsonLdNodes(page: Page): Promise<JsonLdNode[]> {
  const texts = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  const nodes: JsonLdNode[] = [];
  for (const text of texts) {
    expect(text).not.toContain('<');
    expect(text).not.toContain(' ');
    expect(text).not.toContain(' ');
    const data = JSON.parse(text) as JsonLdNode;
    expect(data['@context']).toBe('https://schema.org');
    const graph = data['@graph'];
    if (Array.isArray(graph)) {
      nodes.push(...(graph as JsonLdNode[]));
    } else {
      nodes.push(data);
    }
  }
  return nodes;
}

export function nodesOfType(nodes: JsonLdNode[], type: string): JsonLdNode[] {
  return nodes.filter((node) => node['@type'] === type);
}

export function expectBreadcrumbs(nodes: JsonLdNode[], origin: string, lastPath: string): void {
  const lists = nodesOfType(nodes, 'BreadcrumbList');
  expect(lists).toHaveLength(1);
  const items = lists[0]['itemListElement'] as JsonLdNode[];
  expect(items.length).toBeGreaterThan(0);
  items.forEach((item, index) => {
    expect(item['@type']).toBe('ListItem');
    expect(item['position']).toBe(index + 1);
    expect(typeof item['name']).toBe('string');
    expect(String(item['item'])).toMatch(new RegExp('^' + origin.replace(/[.]/g, '\\.') + '/'));
  });
  expect(items[items.length - 1]['item']).toBe(origin + lastPath);
}

export function expectGeo(node: JsonLdNode): void {
  expect(node['@type']).toBe('BusStop');
  const geo = node['geo'] as JsonLdNode;
  expect(geo['@type']).toBe('GeoCoordinates');
  expect(typeof geo['latitude']).toBe('number');
  expect(typeof geo['longitude']).toBe('number');
}

/** Parses XML in the browser and fails on a parser error. */
export async function parseXml(page: Page, xml: string): Promise<string[]> {
  return page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.getElementsByTagName('parsererror').length > 0) {
      throw new Error('XML parser error');
    }
    return Array.from(document.getElementsByTagName('loc')).map((node) => node.textContent ?? '');
  }, xml);
}

export function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((entry) => {
      const [name, ...values] = entry.trim().split(/\s+/);
      return [name, values];
    }),
  );
}
