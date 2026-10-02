import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILD_PRESENT, freePort } from '../security/support/server';
import { testEnvSource } from '../support/env';
import { prerequisite } from '../support/prerequisite';
import { freshToken } from './support';

/**
 * Threat model T-WEB-01/02 in a real browser: headless Chrome or Edge over the DevTools protocol
 * opens the token pages of the production build with `#token=…` and checks, after hydration, that
 * the token is gone from the address bar, the history entry, every request URL and `Referer`,
 * browser storage and cookies, and from the server output. Runs when a build and a local Chrome or
 * Edge exist; otherwise it is skipped locally and says so, and fails under CI=true.
 * `KADRO_TEST_BROWSER` replaces the candidate list with one executable path.
 */

// eslint-disable-next-line no-restricted-properties -- test-run setting, not application configuration
const BROWSER_OVERRIDE = process.env.KADRO_TEST_BROWSER;
const BROWSERS =
  BROWSER_OVERRIDE !== undefined && BROWSER_OVERRIDE !== ''
    ? [BROWSER_OVERRIDE]
    : [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed candidates or the test-run override
const BROWSER = BROWSERS.find((candidate) => existsSync(candidate));
const ENABLED = prerequisite(
  BUILD_PRESENT && BROWSER !== undefined,
  'browser.test',
  BUILD_PRESENT
    ? `no Chrome or Edge executable at ${BROWSERS.join(', ')}`
    : 'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));

interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, (message: CdpMessage) => void>();
  readonly events: CdpMessage[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id !== undefined) {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      } else {
        this.events.push(message);
      }
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error('devtools connection failed'));
      });
    });
    return new Cdp(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return (reply.result?.result as { value: T }).value;
  }

  close(): void {
    this.socket.close();
  }
}

let server: ChildProcess | undefined;
let browser: ChildProcess | undefined;
let profile = '';
let base = '';
let devtools = '';
let output = '';

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) {
      throw new Error(`${what} did not become ready`);
    }
    await delay(250);
  }
}

async function openPage(): Promise<Cdp> {
  const response = await fetch(`${devtools}/json/new?about:blank`, { method: 'PUT' });
  const target = (await response.json()) as { webSocketDebuggerUrl: string };
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

interface PageSnapshot {
  readonly href: string;
  readonly historyLength: number;
  readonly text: string;
  readonly storage: number;
  readonly cookie: string;
  readonly hasForm: boolean;
}

const SNAPSHOT = `JSON.stringify({
  href: location.href,
  historyLength: history.length,
  text: document.body.innerText,
  storage: localStorage.length + sessionStorage.length,
  cookie: document.cookie,
  hasForm: document.querySelector('form') !== null,
})`;

// Browser start-up and hydration are slow when the whole monorepo suite runs in parallel.
describe.skipIf(!ENABLED)(
  'token pages in a browser (production build)',
  { timeout: 120_000 },
  () => {
    beforeAll(async () => {
      const port = await freePort();
      base = `http://127.0.0.1:${port}`;
      server = spawn(
        process.execPath,
        [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
        {
          cwd: APP_DIR,
          env: {
            ...testEnvSource({ WEB_ORIGIN: base, CORS_ALLOWED_ORIGINS: base }),
            NODE_ENV: 'production',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      const collect = (chunk: Buffer) => {
        output += chunk.toString('utf8');
      };
      server.stdout?.on('data', collect);
      server.stderr?.on('data', collect);
      await waitFor(async () => (await fetch(`${base}/api/v1/health`)).ok, 'built server');

      const debugPort = await freePort();
      devtools = `http://127.0.0.1:${debugPort}`;
      profile = mkdtempSync(join(tmpdir(), 'kadro-pages-'));
      browser = spawn(
        BROWSER ?? '',
        [
          '--headless=new',
          `--remote-debugging-port=${debugPort}`,
          `--user-data-dir=${profile}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          'about:blank',
        ],
        { stdio: 'ignore', windowsHide: true },
      );
      await waitFor(async () => (await fetch(`${devtools}/json/version`)).ok, 'browser');
    }, 120_000);

    afterAll(async () => {
      browser?.kill();
      server?.kill();
      await delay(500);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });

    for (const pathname of ['/sifre-sifirla', '/e-posta-dogrula']) {
      it(`${pathname}: the token leaves the URL, history, requests and storage`, async () => {
        const token = freshToken();
        const cdp = await openPage();
        try {
          await cdp.send('Page.navigate', { url: `${base}${pathname}#token=${token}` });
          await waitFor(async () => {
            const snapshot = JSON.parse(await cdp.evaluate<string>(SNAPSHOT)) as PageSnapshot;
            return pathname === '/sifre-sifirla'
              ? snapshot.hasForm
              : !snapshot.text.includes('doğrulanıyor');
          }, 'hydrated page');
          await delay(500);
          const snapshot = JSON.parse(await cdp.evaluate<string>(SNAPSHOT)) as PageSnapshot;
          expect(snapshot.href).toBe(`${base}${pathname}`);
          expect(snapshot.storage).toBe(0);
          expect(snapshot.cookie).not.toContain(token);
          // The history entry's URL (Chrome's `userTypedURL` is the omnibox input, not page state).
          const history = await cdp.send('Page.getNavigationHistory');
          const entries = (history.result?.entries ?? []) as { url: string }[];
          expect(entries.map((entry) => entry.url)).toContain(`${base}${pathname}`);
          expect(entries.map((entry) => entry.url).join(' ')).not.toContain(token);

          const requests = cdp.events.filter(
            (event) => event.method === 'Network.requestWillBeSent',
          );
          expect(requests.length).toBeGreaterThan(1);
          for (const event of requests) {
            const request = event.params?.request as {
              url: string;
              headers: Record<string, string>;
            };
            expect(request.url).not.toContain(token);
            expect(new URL(request.url).origin).toBe(base);
            expect(JSON.stringify(request.headers)).not.toContain(token);
          }
          if (pathname === '/e-posta-dogrula') {
            // The verification posts once, automatically, with the token in the body only.
            const posts = requests.filter((event) =>
              String((event.params?.request as { url: string }).url).endsWith(
                '/api/v1/auth/verify-email',
              ),
            );
            expect(posts).toHaveLength(1);
            const request = posts[0]?.params?.request as {
              headers: Record<string, string>;
              postData?: string;
            };
            expect(request.headers['x-kadro-client']).toBe('web');
            expect(request.postData).toBe(JSON.stringify({ token }));
          }
          expect(output).not.toContain(token);
        } finally {
          cdp.close();
        }
      });
    }

    it('/sifre-sifirla: short password error, show/hide toggle and focus, no request', async () => {
      const cdp = await openPage();
      try {
        await cdp.send('Page.navigate', { url: `${base}/sifre-sifirla#token=${freshToken()}` });
        await waitFor(async () => {
          const snapshot = JSON.parse(await cdp.evaluate<string>(SNAPSHOT)) as PageSnapshot;
          return snapshot.hasForm;
        }, 'reset form');
        const result = JSON.parse(
          await cdp.evaluate<string>(`(() => {
          const input = document.getElementById('new-password');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'kisa');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('button[type="submit"]').click();
          return JSON.stringify({ ok: true });
        })()`),
        ) as { ok: boolean };
        expect(result.ok).toBe(true);
        await delay(300);
        const state = JSON.parse(
          await cdp.evaluate<string>(`(() => {
          const input = document.getElementById('new-password');
          const toggle = document.querySelector('button[aria-controls="new-password"]');
          const before = { type: input.type, pressed: toggle.getAttribute('aria-pressed') };
          toggle.click();
          return JSON.stringify({
            invalid: input.getAttribute('aria-invalid'),
            describedBy: input.getAttribute('aria-describedby'),
            error: document.getElementById('new-password-error')?.textContent ?? null,
            focused: document.activeElement === input,
            autocomplete: input.getAttribute('autocomplete'),
            before,
          });
        })()`),
        ) as Record<string, unknown>;
        await delay(100);
        const after = await cdp.evaluate<string>(
          `document.getElementById('new-password').type + ' ' + document.querySelector('button[aria-controls="new-password"]').getAttribute('aria-pressed')`,
        );
        expect(state).toMatchObject({
          invalid: 'true',
          describedBy: 'new-password-hint new-password-error',
          error: 'Şifren en az 10 karakter olmalı.',
          focused: true,
          autocomplete: 'new-password',
          before: { type: 'password', pressed: 'false' },
        });
        expect(after).toBe('text true');
        const apiCalls = cdp.events.filter(
          (event) =>
            event.method === 'Network.requestWillBeSent' &&
            String((event.params?.request as { url: string }).url).includes('/api/'),
        );
        expect(apiCalls).toEqual([]);
      } finally {
        cdp.close();
      }
    });

    it('/sifre-sifirla: a malformed fragment is stripped and shows the invalid-link state', async () => {
      const cdp = await openPage();
      try {
        await cdp.send('Page.navigate', { url: `${base}/sifre-sifirla#token=short` });
        await waitFor(async () => {
          const snapshot = JSON.parse(await cdp.evaluate<string>(SNAPSHOT)) as PageSnapshot;
          return snapshot.text.includes('geçersiz');
        }, 'invalid-link state');
        const snapshot = JSON.parse(await cdp.evaluate<string>(SNAPSHOT)) as PageSnapshot;
        expect(snapshot.href).toBe(`${base}/sifre-sifirla`);
        expect(snapshot.hasForm).toBe(false);
        const posts = cdp.events.filter(
          (event) =>
            event.method === 'Network.requestWillBeSent' &&
            String((event.params?.request as { url: string }).url).includes('/api/'),
        );
        expect(posts).toEqual([]);
      } finally {
        cdp.close();
      }
    });
  },
);
