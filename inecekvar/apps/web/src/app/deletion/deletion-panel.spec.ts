import { TestBed } from '@angular/core/testing';
import {
  API_CLIENT_OPTIONS,
  DEFAULT_API_CLIENT_OPTIONS,
  FETCH,
  PENDING_LOGOUT_MARKER,
  SessionStore,
} from '@inecekvar/data-access';
import { DeletionPanelComponent, IS_ONLINE } from './deletion-panel.component';
import { DELETION_PROVIDERS } from './deletion-panel';
import { deletionFailure, deletionMessage } from './deletion-errors';

const EMAIL = 'silinecek@example.com';
const PASSWORD = 'dolmus-durak-2026!';
const USER = {
  id: '01890000-0000-7000-8000-000000000001',
  email: EMAIL,
  display_name: null,
  email_verified: true,
  licence_accepted: false,
  reputation: 0,
  role: 'user',
  created_at: '2026-10-13T09:00:00Z',
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  csrf: string | null;
  credentials: RequestCredentials | undefined;
}

type Answer = Response | (() => Response) | Error;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function problem(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: 'x', status, code, request_id: 'r1', ...extra }),
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );
}

function setup(answers: Record<string, Answer[]>, online = true) {
  const calls: Call[] = [];
  let marker = false;
  const fetchFake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      path: url.pathname,
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      csrf: headers.get('X-CSRF-Token'),
      credentials: init?.credentials,
    });
    const queue = answers[`${method} ${url.pathname}`];
    const next = queue?.shift();
    if (next === undefined) return problem(500, 'unexpected');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  };
  TestBed.configureTestingModule({
    providers: [
      ...DELETION_PROVIDERS,
      { provide: FETCH, useValue: fetchFake },
      {
        provide: API_CLIENT_OPTIONS,
        useValue: { ...DEFAULT_API_CLIENT_OPTIONS, sleep: async () => undefined },
      },
      {
        provide: PENDING_LOGOUT_MARKER,
        useValue: {
          isSet: () => marker,
          set: () => (marker = true),
          clear: () => (marker = false),
        },
      },
      { provide: IS_ONLINE, useValue: () => online },
    ],
  });
  const fixture = TestBed.createComponent(DeletionPanelComponent);
  fixture.detectChanges();
  const panel = fixture.componentInstance;
  const element = fixture.nativeElement as HTMLElement;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { calls, fixture, panel, element, render, store: TestBed.inject(SessionStore) };
}

const signedIn = (): Answer[] => [
  json(200, { auth_mode: 'cookie', csrf_token: 'csrf-1', user: USER }),
];

async function signIn(context: ReturnType<typeof setup>): Promise<void> {
  context.panel.email.set(EMAIL);
  context.panel.signInPassword.set(PASSWORD);
  await context.panel.signIn();
  await context.render();
}

function unlabelledControls(element: HTMLElement): string[] {
  return Array.from(element.querySelectorAll('input, select, textarea'))
    .filter((control) => {
      const id = control.getAttribute('id');
      const label = id ? element.querySelector(`label[for="${id}"]`) : null;
      return !label?.textContent?.trim() && !control.getAttribute('aria-label');
    })
    .map((control) => control.id || control.tagName);
}

afterEach(() => TestBed.resetTestingModule());

describe('DeletionPanelComponent', () => {
  it('signs in on the cookie session and shows what is deleted and what stays', async () => {
    const context = setup({ 'POST /api/v1/auth/login': signedIn() });
    expect(context.element.querySelector('[data-deletion="grace-warning"]')?.textContent).toMatch(
      /giriş yapmak silme isteğini iptal eder/,
    );
    expect(unlabelledControls(context.element)).toEqual([]);
    await signIn(context);
    const login = context.calls[0];
    expect(login).toMatchObject({
      method: 'POST',
      path: '/api/v1/auth/login',
      credentials: 'include',
    });
    expect(login?.body).toMatchObject({ email: EMAIL, mode: 'cookie' });
    expect(context.panel.stage()).toBe('confirm');
    expect(context.element.querySelector('[data-deletion="email"]')?.textContent).toBe(EMAIL);
    const text = context.element.textContent ?? '';
    expect(text).toContain('Favorilerin ve ham GPS izlerin hemen silinir.');
    expect(text).toContain('“silinmiş katkıcı”');
    expect(text).toContain('7 gün içinde');
    expect(unlabelledControls(context.element)).toEqual([]);
    expect(context.panel.signInPassword()).toBe('');
  });

  it('keeps the session after a wrong password and deletes on the second try', async () => {
    const context = setup({
      'POST /api/v1/auth/login': signedIn(),
      'DELETE /api/v1/me': [
        problem(401, 'auth.invalid_credentials'),
        json(202, { status: 'deletion_scheduled' }),
      ],
    });
    await signIn(context);
    context.panel.password.set('yanlis-sifre');
    context.panel.confirmed.set(true);
    await context.panel.remove();
    await context.render();
    expect(context.panel.stage()).toBe('confirm');
    expect(context.store.user()?.email).toBe(EMAIL);
    expect(context.panel.password()).toBe('');
    expect(context.element.querySelector('[role="alert"]')?.textContent).toContain(
      'Şifre doğru değil',
    );
    expect(context.calls.filter((call) => call.path === '/api/v1/auth/logout')).toEqual([]);

    context.panel.password.set(PASSWORD);
    await context.panel.remove();
    await context.render();
    const deletes = context.calls.filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(2);
    expect(deletes[1]).toMatchObject({
      body: { password: PASSWORD },
      csrf: 'csrf-1',
      credentials: 'include',
    });
    expect(context.panel.stage()).toBe('done');
    expect(context.element.querySelector('[data-deletion="done"]')?.textContent).toMatch(
      /7 gün içinde giriş yaparsan silme iptal olur/,
    );
    expect(context.store.user()).toBeNull();
    expect([context.panel.email(), context.panel.password(), context.panel.confirmed()]).toEqual([
      '',
      '',
      false,
    ]);
    expect(context.element.querySelector('input')).toBeNull();
  });

  it('never sends the deletion without the password, whatever the button state', async () => {
    const context = setup({ 'POST /api/v1/auth/login': signedIn() });
    await signIn(context);
    context.panel.confirmed.set(true);
    await context.render();
    const submit = context.element.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(true);
    await context.panel.remove();
    expect(context.calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(context.panel.error()).toContain('şifreni yeniden gir');
    context.panel.password.set(PASSWORD);
    context.panel.confirmed.set(false);
    await context.panel.remove();
    expect(context.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('shows the wait of a 429 and keeps the account signed in', async () => {
    const limited = () =>
      new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'x',
          status: 429,
          code: 'rate_limited',
          request_id: 'r',
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '120' },
        },
      );
    const context = setup({
      'POST /api/v1/auth/login': signedIn(),
      'DELETE /api/v1/me': [limited],
    });
    await signIn(context);
    context.panel.password.set(PASSWORD);
    context.panel.confirmed.set(true);
    await context.panel.remove();
    expect(context.panel.error()).toBe('Çok fazla deneme. 120 sn sonra yeniden dene.');
    expect(context.panel.stage()).toBe('confirm');
    expect(context.store.user()).not.toBeNull();
  });

  it('sends nothing offline and treats a network failure as offline', async () => {
    const offline = setup({}, false);
    offline.panel.email.set(EMAIL);
    offline.panel.signInPassword.set(PASSWORD);
    await offline.panel.signIn();
    expect(offline.calls).toEqual([]);
    expect(offline.panel.error()).toContain('İnternet yok');
    TestBed.resetTestingModule();

    const context = setup({
      'POST /api/v1/auth/login': signedIn(),
      'DELETE /api/v1/me': [new TypeError('Failed to fetch')],
    });
    await signIn(context);
    context.panel.password.set(PASSWORD);
    context.panel.confirmed.set(true);
    await context.panel.remove();
    expect(context.panel.error()).toContain('Silme isteği sunucuya ulaşmadan hiçbir şey silinmez');
    expect(context.panel.stage()).toBe('confirm');
    expect(context.store.user()).not.toBeNull();
  });

  it('ends the flow when the server no longer knows the session', async () => {
    const context = setup({
      'POST /api/v1/auth/login': signedIn(),
      'DELETE /api/v1/me': [problem(401, 'auth.required')],
    });
    await signIn(context);
    context.panel.password.set(PASSWORD);
    context.panel.confirmed.set(true);
    await context.panel.remove();
    await context.render();
    expect(context.panel.stage()).toBe('ended');
    expect(context.store.user()).toBeNull();
    expect(context.element.textContent).toContain('yeniden giriş yapma');
  });

  it('renders server problems only as fixed copy (no markup from the response)', async () => {
    const hostile = '<img src=x onerror="globalThis.__ivXss=1">';
    const context = setup({
      'POST /api/v1/auth/login': signedIn(),
      'DELETE /api/v1/me': [
        problem(400, hostile, { detail: '<script>globalThis.__ivXss=1</script>', title: hostile }),
      ],
    });
    await signIn(context);
    context.panel.password.set(PASSWORD);
    context.panel.confirmed.set(true);
    await context.panel.remove();
    await context.render();
    const alert = context.element.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(deletionMessage('error', null));
    expect(context.element.querySelector('img, script')).toBeNull();
    expect(context.element.querySelector('[onerror]')).toBeNull();
    expect((globalThis as Record<string, unknown>)['__ivXss']).toBeUndefined();
  });

  it('maps the failure classes like the app does', () => {
    expect(deletionFailure(new Error('x'))).toBe('error');
    expect(deletionMessage('last-admin', null)).toContain('son yönetici');
    expect(deletionMessage('rate-limited', null)).toContain('Biraz bekleyip');
  });

  it('signs out when the page is left in the confirm step', async () => {
    const context = setup({
      'POST /api/v1/auth/login': signedIn(),
      'POST /api/v1/auth/logout': [new Response(null, { status: 204 })],
    });
    await signIn(context);
    context.fixture.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.calls.some((call) => call.path === '/api/v1/auth/logout')).toBe(true);
  });
});
