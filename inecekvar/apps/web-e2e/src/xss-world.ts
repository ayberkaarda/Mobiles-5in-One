import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The stored-XSS world shared by the web and PWA sweeps (spec section 6 item 16, ADR-0052).
 *
 * Every hostile string reaches the database through the real write path: a contributor
 * registers with the mailed link, accepts the licence and proposes stops, lines (name, hours,
 * hailing notes), fare changes and line renames; a moderator approves the stops and lines,
 * rejects the fare changes with the payload as the reason and leaves the renames pending for the
 * queue. Only the city row (no API writes cities) and the roles and reputation (granted by an
 * admin in production) are set in the database, as in the phase 4 moderation run.
 */

export interface XssPayload {
  name: string;
  value: string;
  refused: boolean;
}

export const PAYLOADS: XssPayload[] = JSON.parse(
  readFileSync(join(__dirname, 'xss-payloads.json'), 'utf8'),
) as XssPayload[];
export const STORED = PAYLOADS.filter((payload) => !payload.refused);
export const REFUSED = PAYLOADS.filter((payload) => payload.refused);

/** One city per run, so repeated runs never collide on slugs. */
export const XSS_CITY = 'xss-' + Date.now().toString(36);
export const PASSWORD = 'dolmus-durak-2026!';

/** The payload cut to a field limit in code points, as stored. */
export function fit(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('').trim();
}

export interface WorldStop {
  payload: XssPayload;
  id: string;
  slug: string;
  name: string;
}

export interface WorldLine {
  payload: XssPayload;
  id: string;
  slug: string;
  code: string;
  name: string;
  hours: string;
  notes: string;
}

export interface XssWorld {
  city: string;
  contributor: { email: string; token: string; displayName: string };
  moderator: { email: string; token: string; displayName: string };
  stops: WorldStop[];
  lines: WorldLine[];
  rejected: { payload: XssPayload; id: string; reason: string }[];
  pending: { payload: XssPayload; id: string; name: string }[];
  refusals: { payload: XssPayload; field: string; status: number; code: string }[];
}

export interface WorldOptions {
  api: string;
  mailUi: string;
  psqlContainer: string;
  stamp: string;
}

let ipCounter = 0;
/** The API trusts X-Real-IP from 127.0.0.1 (the proxy role); one address per caller step. */
function clientIp(): Record<string, string> {
  ipCounter += 1;
  return { 'X-Real-IP': `198.51.100.${(ipCounter % 250) + 1}` };
}

export function psql(container: string, sql: string): void {
  execFileSync('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'inecekvar',
    '-d',
    'inecekvar',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
}

async function mailedToken(
  request: APIRequestContext,
  mailUi: string,
  to: string,
): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const search = await request.get(`${mailUi}/api/v1/search`, {
      params: { query: `to:"${to}"` },
    });
    const messages = ((await search.json()) as { messages?: { ID: string }[] }).messages ?? [];
    if (messages[0]) {
      const message = await request.get(`${mailUi}/api/v1/message/${messages[0].ID}`);
      const token = /#token=([A-Za-z0-9_-]+)/.exec(
        ((await message.json()) as { Text: string }).Text,
      )?.[1];
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('no magic link mail arrived');
}

async function register(
  request: APIRequestContext,
  options: WorldOptions,
  email: string,
): Promise<string> {
  const registered = await request.post(`${options.api}/auth/register`, {
    headers: clientIp(),
    data: { email, password: PASSWORD, mode: 'bearer' },
  });
  expect(registered.status()).toBe(202);
  const verified = await request.post(`${options.api}/auth/magic-link/verify`, {
    headers: clientIp(),
    data: {
      token: await mailedToken(request, options.mailUi, email),
      mode: 'bearer',
      password: PASSWORD,
    },
  });
  expect(verified.status()).toBe(200);
  return ((await verified.json()) as { access_token: string }).access_token;
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function json<T>(
  response: { status(): number; json(): Promise<unknown>; text(): Promise<string> },
  status: number,
): Promise<T> {
  if (response.status() !== status) {
    throw new Error(`expected ${status}, got ${response.status()}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** Builds the world through the API; idempotent per stamp (every run uses fresh accounts). */
export async function buildXssWorld(
  request: APIRequestContext,
  options: WorldOptions,
): Promise<XssWorld> {
  const { api } = options;
  psql(
    options.psqlContainer,
    'insert into cities (id, name, slug, bbox, centroid, timezone, is_sample) values ' +
      "(gen_random_uuid(), 'XSS Deneme Şehri', '" +
      XSS_CITY +
      "', ST_GeomFromText('POLYGON((35 41,35.2 41,35.2 41.1,35 41.1,35 41))', 4326), " +
      "ST_GeomFromText('POINT(35.1 41.05)', 4326), 'Europe/Istanbul', false) " +
      'on conflict do nothing',
  );
  const contributorEmail = `xss-katki-${options.stamp}@example.com`;
  const moderatorEmail = `xss-mod-${options.stamp}@example.com`;
  if (
    ![contributorEmail, moderatorEmail].every((email) => /^[a-z0-9.-]+@example\.com$/.test(email))
  ) {
    throw new Error('unexpected test email');
  }
  const contributorToken = await register(request, options, contributorEmail);
  const moderatorToken = await register(request, options, moderatorEmail);
  psql(
    options.psqlContainer,
    `update users set role = 'moderator' where email = '${moderatorEmail}'`,
  );
  psql(
    options.psqlContainer,
    `update users set reputation = 1000 where email = '${contributorEmail}'`,
  );
  const author = bearer(contributorToken);
  const reviewer = bearer(moderatorToken);
  await json(await request.post(`${api}/me/licence-accept`, { headers: author, data: {} }), 200);
  const contributorName = fit('<img src=x onerror=alert(1)><svg onload=alert(2)>', 60);
  const moderatorName = fit('"><script>alert(3)</script>', 60);
  await json(
    await request.patch(`${api}/me`, { headers: author, data: { display_name: contributorName } }),
    200,
  );
  await json(
    await request.patch(`${api}/me`, { headers: reviewer, data: { display_name: moderatorName } }),
    200,
  );

  const approve = async (id: string): Promise<void> => {
    await json(
      await request.post(`${api}/moderation/edits/${id}/approve`, { headers: reviewer, data: {} }),
      200,
    );
  };

  // Refused at validation: control and format characters (Unicode category C).
  const refusals: XssWorld['refusals'] = [];
  for (const payload of REFUSED) {
    const response = await request.post(`${api}/edits`, {
      headers: author,
      data: {
        kind: 'new_stop',
        city: XSS_CITY,
        name: payload.value,
        location: [35.19, 41.09],
        stop_kind: 'formal',
      },
    });
    const body = (await response.json()) as { code: string };
    refusals.push({ payload, field: 'stop name', status: response.status(), code: body.code });
    const named = await request.patch(`${api}/me`, {
      headers: author,
      data: { display_name: fit(payload.value, 60) },
    });
    const namedBody = (await named.json()) as { code: string };
    refusals.push({
      payload,
      field: 'display name',
      status: named.status(),
      code: namedBody.code,
    });
  }

  const location = (index: number): [number, number] => [
    Number((35.01 + index * 0.009).toFixed(4)),
    index % 2 === 0 ? 41.02 : 41.03,
  ];
  const stopEdits: { payload: XssPayload; id: string; name: string }[] = [];
  for (const [index, payload] of STORED.entries()) {
    const name = fit(payload.value, 160);
    const created = await json<{ id: string }>(
      await request.post(`${api}/edits`, {
        headers: author,
        data: {
          kind: 'new_stop',
          city: XSS_CITY,
          name,
          location: location(index),
          stop_kind: index % 3 === 0 ? 'informal' : 'formal',
        },
      }),
      201,
    );
    await approve(created.id);
    stopEdits.push({ payload, id: created.id, name });
  }
  const listed = await json<{ id: string; slug: string; name: string }[]>(
    await request.get(`${api}/stops`, { params: { city: XSS_CITY, limit: 50 } }),
    200,
  );
  const stops: WorldStop[] = stopEdits.map((edit) => {
    const match = listed.find((stop) => stop.name === edit.name);
    if (!match) throw new Error(`stop for ${edit.payload.name} not listed`);
    return { payload: edit.payload, id: match.id, slug: match.slug, name: edit.name };
  });

  const lines: WorldLine[] = [];
  for (const [index, payload] of STORED.entries()) {
    const next = (index + 1) % stops.length;
    const code = `X-${index + 1}`;
    const name = fit(payload.value, 160);
    const hours = fit(payload.value, 500);
    const notes = fit(payload.value, 1000);
    const created = await json<{ id: string }>(
      await request.post(`${api}/edits`, {
        headers: author,
        data: {
          kind: 'new_line',
          city: XSS_CITY,
          code,
          name,
          mode: ['dolmus', 'minibus', 'servis'][index % 3],
          geometry: [location(index), location(next)],
          stop_ids: [stops[index].id, stops[next].id],
          fare_minor: 2500 + index * 10,
          hours_text: hours,
          payment_methods: ['nakit', 'kart'],
          hail_notes: notes,
        },
      }),
      201,
    );
    await approve(created.id);
    const line = await json<{ id: string; slug: string }>(
      await request.get(`${api}/lines/${code.toLowerCase()}`, { params: { city: XSS_CITY } }),
      200,
    );
    lines.push({ payload, id: line.id, slug: line.slug, code, name, hours, notes });
  }

  const rejected: XssWorld['rejected'] = [];
  const pending: XssWorld['pending'] = [];
  for (const [index, line] of lines.entries()) {
    const fare = await json<{ id: string }>(
      await request.post(`${api}/edits`, {
        headers: author,
        data: { kind: 'fare_update', line: line.id, base_version_no: 1, fare_minor: 9000 + index },
      }),
      201,
    );
    const reason = fit(line.payload.value, 1000);
    await json(
      await request.post(`${api}/moderation/edits/${fare.id}/reject`, {
        headers: reviewer,
        data: { reason },
      }),
      200,
    );
    rejected.push({ payload: line.payload, id: fare.id, reason });
    const renamed = 'Yeni ' + fit(line.payload.value, 150);
    const rename = await json<{ id: string }>(
      await request.post(`${api}/edits`, {
        headers: author,
        data: {
          kind: 'update_line',
          line: line.id,
          base_version_no: 1,
          changes: { name: renamed },
        },
      }),
      201,
    );
    pending.push({ payload: line.payload, id: rename.id, name: fit(renamed, 160) });
  }

  return {
    city: XSS_CITY,
    contributor: { email: contributorEmail, token: contributorToken, displayName: contributorName },
    moderator: { email: moderatorEmail, token: moderatorToken, displayName: moderatorName },
    stops,
    lines,
    rejected,
    pending,
    refusals,
  };
}

/** Records alert/confirm/prompt dialogs and CSP violations of a page. */
export interface Guard {
  dialogs: string[];
  violations(): Promise<string[]>;
}

export async function guard(page: Page): Promise<Guard> {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.addInitScript(() => {
    const store = window as unknown as { __ivViolations: string[] };
    store.__ivViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__ivViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return {
    dialogs,
    violations: () =>
      page.evaluate(
        () => (window as unknown as { __ivViolations?: string[] }).__ivViolations ?? [],
      ),
  };
}

export interface AuditResult {
  handlers: string[];
  urls: string[];
  injected: string[];
  scripts: string[];
  breakouts: number;
  text: string;
  jsonLd: string[];
}

/**
 * Structural audit of a document, run in the browser: the live DOM when `html` is null,
 * otherwise the string parsed with DOMParser (nothing in it runs). It never greps markup for a
 * payload substring, because escaped text such as `&lt;img onerror=` legitimately contains
 * `onerror=`. It reports event-handler attributes, script-capable URLs, elements a payload would
 * create, scripts that are neither bundles, nonced inline scripts nor data blocks, and
 * `</script` sequences outside script elements. Self-contained: Playwright serializes it.
 */
export function auditDocument(html: string | null): AuditResult {
  const root = html === null ? document : new DOMParser().parseFromString(html, 'text/html');
  const handlers: string[] = [];
  const urls: string[] = [];
  const injected: string[] = [];
  const scripts: string[] = [];
  const urlAttributes = ['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster'];
  for (const element of Array.from(root.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const tag = element.tagName.toLowerCase();
      if (name.startsWith('on')) handlers.push(tag + '[' + name + ']');
      if (urlAttributes.includes(name)) {
        const value = Array.from(attribute.value)
          .filter((character) => character.charCodeAt(0) > 32)
          .join('')
          .toLowerCase();
        if (/^(javascript|vbscript|data:text)/.test(value) || value.startsWith('data:image/svg')) {
          urls.push(tag + '[' + name + '=' + attribute.value.slice(0, 40) + ']');
        }
      }
    }
  }
  const markers: [string, string][] = [
    ['img[src="x"]', 'img src=x'],
    ['iframe', 'iframe'],
    ['object', 'object'],
    ['embed', 'embed'],
    ['base:not([href="/"])', 'base'],
    ['meta[http-equiv="refresh" i]', 'meta refresh'],
    ['image[href="x"]', 'svg image'],
    ['b', 'b element'],
    ['link[rel~="stylesheet" i][href*="attacker" i]', 'attacker stylesheet'],
  ];
  for (const [selector, label] of markers) {
    if (root.querySelector(selector)) injected.push(label);
  }
  for (const style of Array.from(root.querySelectorAll('style'))) {
    if (/attacker|@import/i.test(style.textContent ?? '')) injected.push('style import');
  }
  const scriptElements = Array.from(root.querySelectorAll('script'));
  for (const script of scriptElements) {
    const type = (script.getAttribute('type') ?? '').toLowerCase();
    const data = type === 'application/ld+json' || type === 'application/json';
    const bundle = script.hasAttribute('src');
    const nonced = script.hasAttribute('nonce') || script.nonce !== '';
    const body = script.textContent ?? '';
    // The PWA build's critical-CSS loader (beasties) is the one inline script of index.html.
    const loader = body.startsWith("document.querySelectorAll('link[data-beasties-media]')");
    if (!data && !bundle && !nonced && !loader) scripts.push('inline: ' + body.slice(0, 60));
    if (!data && /alert\(/.test(body)) scripts.push('alert in script: ' + body.slice(0, 60));
  }
  const closers = html === null ? 0 : (html.match(/<\/script/gi) ?? []).length;
  return {
    handlers,
    urls,
    injected,
    scripts,
    breakouts: html === null ? 0 : closers - scriptElements.length,
    text: (root.title ?? '') + '\n' + (root.body?.textContent ?? ''),
    jsonLd: Array.from(root.querySelectorAll('script[type="application/ld+json"]')).map(
      (node) => node.textContent ?? '',
    ),
  };
}

export function expectClean(result: AuditResult, where: string): void {
  expect(result.handlers, `${where}: event handler attributes`).toEqual([]);
  expect(result.urls, `${where}: script URLs`).toEqual([]);
  expect(result.injected, `${where}: injected elements`).toEqual([]);
  expect(result.scripts, `${where}: executable scripts`).toEqual([]);
  expect(result.breakouts, `${where}: script breakouts`).toBeLessThanOrEqual(0);
}

/** Audits the live DOM of the page; returns the title and body text. */
export async function auditLive(page: Page, where: string): Promise<AuditResult> {
  const result = await page.evaluate(auditDocument, null);
  expectClean(result, where);
  return result;
}

/** Parses an HTML string in the browser without running it and audits it. */
export async function auditHtml(page: Page, html: string, where: string): Promise<AuditResult> {
  const result = await page.evaluate(auditDocument, html);
  expectClean(result, where);
  return result;
}

/** True when every JSON-LD block parses and one string value contains `expected` exactly. */
export function jsonLdHolds(blocks: string[], expected: string): boolean {
  const values: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') values.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  for (const block of blocks) walk(JSON.parse(block));
  return values.some((value) => value.includes(expected));
}
