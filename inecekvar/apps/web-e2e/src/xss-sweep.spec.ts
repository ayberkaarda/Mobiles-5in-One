import { expect, type Page, test } from '@playwright/test';
import { REAL_STACK } from '../stack-env.mjs';
import { TotpDevice } from './totp';
import {
  auditHtml,
  auditLive,
  buildXssWorld,
  guard,
  jsonLdHolds,
  PASSWORD,
  PAYLOADS,
  psql,
  STORED,
  XSS_CITY,
  type XssWorld,
} from './xss-world';

/**
 * Item 16 stored-XSS sweep on the web (ADR-0052): the payload list of
 * `xss-payloads.json` goes through the real write path (`xss-world.ts`) into the real API, and
 * every web rendering surface is checked: SSR pages without JavaScript (city hub, line list,
 * line, stop, route), the same pages hydrated (no dialog, no CSP violation, clean DOM), JSON-LD
 * blocks parsed back to the stored string, OG SVG images, sitemaps and llms-full.txt, and the
 * admin (queue with its diff, users, versions, audit log). Needs the real stack
 * (`IV_E2E_STACK=iv6b node scripts/real-stack.mjs up`) and IV_E2E_REAL_API=1.
 */
const REAL = process.env['IV_E2E_REAL_API'] === '1';
const API = `http://127.0.0.1:${REAL_STACK.apiPort}/v1`;
const SSR = `http://127.0.0.1:${REAL_STACK.ssrPort}`;
const PROXY = `http://127.0.0.1:${REAL_STACK.proxyPort}`;
const POSTGRES = `${REAL_STACK.project}-postgres-1`;
const stamp = Date.now().toString(36);

test.skip(!REAL, 'needs the real API stack: node scripts/real-stack.mjs up and IV_E2E_REAL_API=1');
test.describe.configure({ mode: 'serial' });

let world: XssWorld;

test.beforeAll(async ({ request }, testInfo) => {
  testInfo.setTimeout(300_000);
  world = await buildXssWorld(request, {
    api: API,
    mailUi: REAL_STACK.mailUi,
    psqlContainer: POSTGRES,
    stamp,
  });
});

function withoutSeparators(value: string): string {
  return Array.from(value)
    .filter((character) => character !== '\u2028' && character !== '\u2029')
    .join('');
}

async function blank(page: Page): Promise<void> {
  await page.goto('about:blank');
}

async function ssrHtml(page: Page, path: string): Promise<string> {
  const response = await page.request.get(SSR + path);
  expect(response.status(), path).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  return response.text();
}

test('payloads with control or format characters are refused at input validation', async ({
  request,
}) => {
  expect(world.refusals.length).toBe(2 * PAYLOADS.filter((payload) => payload.refused).length);
  for (const refusal of world.refusals) {
    expect(refusal.status, `${refusal.payload.name} ${refusal.field}`).toBe(422);
    expect(refusal.code).toBe('validation.failed');
  }
  // Every other payload was stored exactly (after trimming to the field limit).
  for (const line of world.lines) {
    const stored = (await (
      await request.get(`${API}/lines/${line.slug}`, { params: { city: XSS_CITY } })
    ).json()) as { name: string; hours_text: string; hail_notes: string };
    expect(stored.name).toBe(line.name);
    expect(stored.hours_text).toBe(line.hours);
    expect(stored.hail_notes).toBe(line.notes);
  }
});

test('SSR pages without JavaScript render every payload as text', async ({ page }) => {
  test.setTimeout(240_000);
  await blank(page);
  const hub = await auditHtml(page, await ssrHtml(page, `/${XSS_CITY}`), 'hub');
  expect(hub.text).toContain('XSS Deneme Şehri');
  const list = await auditHtml(page, await ssrHtml(page, `/${XSS_CITY}/hatlar`), 'line list');
  for (const line of world.lines) expect(list.text, line.payload.name).toContain(line.name);
  for (const line of world.lines) {
    const where = `line ${line.payload.name}`;
    const result = await auditHtml(
      page,
      await ssrHtml(page, `/${XSS_CITY}/hat/${line.slug}`),
      where,
    );
    expect(result.text, where).toContain(line.name);
    expect(result.text, where).toContain(line.hours);
    expect(result.text, where).toContain(line.notes);
    expect(result.jsonLd.length, where).toBeGreaterThan(0);
    expect(jsonLdHolds(result.jsonLd, line.name), `${where} JSON-LD`).toBe(true);
  }
  for (const stop of world.stops) {
    const where = `stop ${stop.payload.name}`;
    const result = await auditHtml(
      page,
      await ssrHtml(page, `/${XSS_CITY}/durak/${stop.slug}`),
      where,
    );
    expect(result.text, where).toContain(stop.name);
    expect(jsonLdHolds(result.jsonLd, stop.name), `${where} JSON-LD`).toBe(true);
  }
  const pairs = (await (
    await page.request.get(`${API}/cities/${XSS_CITY}/stop-pairs`, { params: { limit: 200 } })
  ).json()) as {
    pairs: { from_stop: { slug: string; name: string }; to_stop: { slug: string; name: string } }[];
  };
  expect(pairs.pairs.length).toBeGreaterThan(0);
  for (const pair of pairs.pairs.slice(0, 8)) {
    const path = `/${XSS_CITY}/rota/${pair.from_stop.slug}-${pair.to_stop.slug}`;
    const result = await auditHtml(page, await ssrHtml(page, path), `route ${path}`);
    expect(result.text).toContain(pair.from_stop.name);
    expect(result.text).toContain(pair.to_stop.name);
  }
});

test('hydrated pages run no payload: no dialog, no CSP violation, clean DOM', async ({ page }) => {
  test.setTimeout(300_000);
  const watch = await guard(page);
  const paths = [
    `/${XSS_CITY}`,
    `/${XSS_CITY}/hatlar`,
    ...world.lines.map((line) => `/${XSS_CITY}/hat/${line.slug}`),
    ...world.stops.map((stop) => `/${XSS_CITY}/durak/${stop.slug}`),
  ];
  for (const path of paths) {
    await page.goto(SSR + path, { waitUntil: 'networkidle' });
    const result = await auditLive(page, `hydrated ${path}`);
    expect(result.text.length).toBeGreaterThan(0);
  }
  // Opening the interactive map of the most hostile line exercises the client-side renderer.
  await page.goto(`${SSR}/${XSS_CITY}/hat/${world.lines[0].slug}`, { waitUntil: 'networkidle' });
  await auditLive(page, 'line with map');
  expect(watch.dialogs).toEqual([]);
  expect(await watch.violations()).toEqual([]);
});

test('OG images, sitemaps and llms-full.txt stay well-formed', async ({ page }) => {
  test.setTimeout(120_000);
  await blank(page);
  for (const line of world.lines) {
    const response = await page.request.get(`${SSR}/og/${XSS_CITY}/hat/${line.slug}.svg`);
    expect(response.status(), line.payload.name).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
    const svg = await response.text();
    const parsed = await page.evaluate((markup) => {
      const document = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const handlers = Array.from(document.querySelectorAll('*')).flatMap((element) =>
        Array.from(element.attributes)
          .filter((attribute) => attribute.name.toLowerCase().startsWith('on'))
          .map((attribute) => attribute.name),
      );
      return {
        parserError: document.getElementsByTagName('parsererror').length,
        elements: Array.from(
          new Set(Array.from(document.querySelectorAll('*')).map((node) => node.localName)),
        ).sort(),
        handlers,
        texts: Array.from(document.querySelectorAll('text')).map((node) => node.textContent ?? ''),
      };
    }, svg);
    expect(parsed.parserError, line.payload.name).toBe(0);
    expect(parsed.handlers, line.payload.name).toEqual([]);
    for (const element of parsed.elements) {
      expect(
        ['path', 'rect', 'svg', 'text', 'title'],
        `${line.payload.name} <${element}>`,
      ).toContain(element);
    }
    // The SVG writer drops U+2028/U+2029 and the clamp folds whitespace: compare without both.
    const prefix = withoutSeparators(line.name).replace(/\s+/g, '').slice(0, 20);
    expect(parsed.texts.join('').replace(/\s+/g, ''), line.payload.name).toContain(prefix);
  }
  const index = await page.request.get(`${SSR}/sitemap.xml`);
  expect(index.status()).toBe(200);
  const indexLocs = await page.evaluate(xmlLocs, await index.text());
  expect(indexLocs).toContain(`${SSR}/sitemaps/${XSS_CITY}.xml`);
  const city = await page.request.get(`${SSR}/sitemaps/${XSS_CITY}.xml`);
  expect(city.status()).toBe(200);
  const locs = await page.evaluate(xmlLocs, await city.text());
  const origin = SSR.replace(/[.]/g, '\\.');
  const detail = new RegExp(`^${origin}/${XSS_CITY}/(hat|durak)/[a-z0-9]+(-[a-z0-9]+)*$`);
  const listing = new RegExp(`^${origin}/${XSS_CITY}(/hatlar)?$`);
  expect(locs.filter((loc) => detail.test(loc)).length).toBe(
    world.lines.length + world.stops.length,
  );
  for (const loc of locs) expect(detail.test(loc) || listing.test(loc), loc).toBe(true);
  const llms = await page.request.get(`${SSR}/llms-full.txt`);
  expect(llms.status()).toBe(200);
  expect(llms.headers()['content-type']).toContain('text/plain');
  const text = await llms.text();
  for (const payload of STORED) expect(text).not.toContain(payload.value.slice(0, 24));
});

function xmlLocs(xml: string): string[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) throw new Error('XML parser error');
  return Array.from(document.getElementsByTagName('loc')).map((node) => node.textContent ?? '');
}

test('admin queue, diff, users, versions and audit log show payloads as text', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const adminEmail = `xss-yonetici-${stamp}@example.com`;
  const registered = await request.post(`${API}/auth/register`, {
    headers: { 'X-Real-IP': '198.51.100.251' },
    data: { email: adminEmail, password: PASSWORD, mode: 'bearer' },
  });
  expect(registered.status()).toBe(202);
  const login = await request.post(`${API}/auth/magic-link/verify`, {
    headers: { 'X-Real-IP': '198.51.100.252' },
    data: { token: await linkToken(request, adminEmail), mode: 'bearer', password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const token = ((await login.json()) as { access_token: string }).access_token;
  psql(POSTGRES, `update users set role = 'admin' where email = '${adminEmail}'`);
  const enrol = await request.post(`${API}/me/totp/enrol`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Real-IP': '198.51.100.253' },
    data: {},
  });
  expect(enrol.status()).toBe(201);
  const device = new TotpDevice(((await enrol.json()) as { secret: string }).secret);
  const confirmed = await request.post(`${API}/me/totp/confirm`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Real-IP': '198.51.100.253' },
    data: { code: device.next() },
  });
  expect(confirmed.status()).toBe(200);

  const watch = await guard(page);
  // Its own client address: the moderation spec already used the proxy address's step-up quota.
  await page.setExtraHTTPHeaders({ 'x-e2e-client-ip': '198.51.100.254' });
  await page.goto(`${PROXY}/admin`);
  await expect(page).toHaveURL(/\/admin\/giris$/);
  await page.locator('#iv-admin-email').fill(adminEmail);
  await page.locator('#iv-admin-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL(/\/admin\/kuyruk$/);
  for (const edit of world.pending) {
    await expect(page.locator(`[data-edit="${edit.id}"]`)).toBeVisible();
  }
  const queue = await auditLive(page, 'admin queue');
  for (const edit of world.pending) {
    const card = page.locator(`[data-edit="${edit.id}"]`);
    await expect(card.locator('[data-field="name"] td').nth(1)).toHaveText(edit.name.slice(0, 600));
    await expect(card.locator('header .text')).toHaveText(world.contributor.displayName);
  }
  expect(queue.text).toContain(world.contributor.displayName);

  await page.getByRole('link', { name: 'Kullanıcılar' }).click();
  const dialog = page.locator('[data-dialog="step-up"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('#iv-stepup-code').fill(device.next());
  await dialog.getByRole('button', { name: 'Doğrula' }).click();
  await expect(page.locator(`[data-user="${world.contributor.email}"]`)).toBeVisible();
  await expect(page.locator(`[data-user="${world.contributor.email}"]`)).toContainText(
    world.contributor.displayName,
  );
  await expect(page.locator(`[data-user="${world.moderator.email}"]`)).toContainText(
    world.moderator.displayName,
  );
  await auditLive(page, 'admin users');

  await page.getByRole('link', { name: 'Sürümler' }).click();
  await page.locator('#iv-versions-city').selectOption(XSS_CITY);
  await page.locator('#iv-versions-q').fill('X-');
  await page.getByRole('button', { name: 'Ara' }).click();
  await expect(page.getByRole('button', { name: /X-1\b/ }).first()).toBeVisible();
  await auditLive(page, 'admin versions list');
  await page.getByRole('button', { name: /X-1\b/ }).first().click();
  await expect(page.locator('[data-line] h2')).toContainText('X-1');
  const versions = await auditLive(page, 'admin versions line');
  expect(versions.text).toContain(world.lines[0].name.slice(0, 40));

  await page.getByRole('link', { name: 'Denetim' }).click();
  await expect(page.locator('[data-audit="total"]')).toBeVisible();
  await expect(page.locator('tr[data-action="moderation.reject"]').first()).toBeVisible();
  await auditLive(page, 'admin audit log');

  expect(watch.dialogs).toEqual([]);
  expect(await watch.violations()).toEqual([]);
});

async function linkToken(request: Page['request'], to: string): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const search = await request.get(`${REAL_STACK.mailUi}/api/v1/search`, {
      params: { query: `to:"${to}"` },
    });
    const messages = ((await search.json()) as { messages?: { ID: string }[] }).messages ?? [];
    if (messages[0]) {
      const message = await request.get(`${REAL_STACK.mailUi}/api/v1/message/${messages[0].ID}`);
      const found = /#token=([A-Za-z0-9_-]+)/.exec(
        ((await message.json()) as { Text: string }).Text,
      );
      if (found?.[1]) return found[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('no magic link mail arrived');
}
