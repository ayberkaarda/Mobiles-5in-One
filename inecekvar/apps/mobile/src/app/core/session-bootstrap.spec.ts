import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { EMPTY } from 'rxjs';
import {
  API_BASE_URL,
  AUTH_STRATEGY,
  FETCH,
  IS_NATIVE_PLATFORM,
  SessionStore,
} from '@inecekvar/data-access';
import { apiBaseFor, environment } from '../../environments/environment';
import { appConfig } from '../app.config';
import { PREFERENCE_STORE } from '../city/city.store';
import { TRACE_CLEANUP_KEY, TRACE_DRAFT_KEY } from '../contribute/trace-draft';
import { MemoryPreferences, settle } from '../testing/catalog.fixtures';
import { LanguageService } from './language.service';
import { bootstrapSession } from './session-bootstrap';

function fakeSession() {
  return { init: vi.fn(async () => undefined), consumeMagicLinkUrl: vi.fn(() => true) };
}

function fakeApp() {
  let handler: ((event: { url: string }) => void) | undefined;
  return {
    addListener: vi.fn(async (_name: string, fn: (event: { url: string }) => void) => {
      handler = fn;
      return { remove: async () => undefined };
    }),
    open: (url: string) => handler?.({ url }),
  };
}

describe('bootstrapSession', () => {
  it('retries pending coordinate cleanup during app startup', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(TRACE_CLEANUP_KEY, '1');
    prefs.values.set(TRACE_DRAFT_KEY, 'coordinates awaiting deletion');
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: fakeSession() },
        { provide: IS_NATIVE_PLATFORM, useValue: false },
        { provide: PREFERENCE_STORE, useValue: prefs },
      ],
    });
    TestBed.runInInjectionContext(() => bootstrapSession());
    await settle();
    expect(prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
    expect(prefs.values.has(TRACE_CLEANUP_KEY)).toBe(false);
  });

  it('starts the session check on the web without a deep-link listener', () => {
    const session = fakeSession();
    const app = fakeApp();
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: session },
        { provide: IS_NATIVE_PLATFORM, useValue: false },
      ],
    });
    TestBed.runInInjectionContext(() => bootstrapSession(app as never));
    expect(session.init).toHaveBeenCalledTimes(1);
    expect(app.addListener).not.toHaveBeenCalled();
  });

  it('captures magic links opened in the native app', () => {
    const session = fakeSession();
    const app = fakeApp();
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: session },
        { provide: IS_NATIVE_PLATFORM, useValue: true },
      ],
    });
    TestBed.runInInjectionContext(() => bootstrapSession(app as never));
    expect(app.addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));
    app.open('https://app.inecekvar.app/giris/baglanti#token=abc');
    expect(session.consumeMagicLinkUrl).toHaveBeenCalledWith(
      'https://app.inecekvar.app/giris/baglanti#token=abc',
    );
  });
});

describe('environment and app wiring', () => {
  it('holds public URLs only and picks the API base by platform', () => {
    expect(Object.keys(environment).sort()).toEqual([
      'nativeApiBase',
      'revenueCatPublicKey',
      'tilesBase',
      'webApiBase',
    ]);
    expect(environment.revenueCatPublicKey).toBe('');
    expect(apiBaseFor(environment, false)).toBe('/api/v1');
    expect(apiBaseFor(environment, true)).toBe('https://api.inecekvar.app/v1');
    expect(environment.tilesBase.startsWith('https://')).toBe(true);
  });

  it('uses the same-origin API path and the cookie strategy in the browser', () => {
    const offline = (async () => Promise.reject(new TypeError('offline'))) as typeof fetch;
    TestBed.configureTestingModule({
      providers: [...appConfig.providers, { provide: FETCH, useValue: offline }],
    });
    expect(TestBed.inject(API_BASE_URL)).toBe('/api/v1');
    expect(TestBed.inject(AUTH_STRATEGY).mode).toBe('cookie');
  });

  it('lets the language initializer end quietly when its translation service is already gone', async () => {
    const transloco = { load: vi.fn(() => EMPTY), setActiveLang: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: TranslocoService, useValue: transloco }],
    });
    const language = TestBed.inject(LanguageService);
    await expect(language.init()).resolves.toBeUndefined();
    expect(transloco.setActiveLang).not.toHaveBeenCalled();
  });
});
