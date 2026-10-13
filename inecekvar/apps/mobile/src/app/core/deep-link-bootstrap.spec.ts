import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { IS_NATIVE_PLATFORM, SessionStore } from '@inecekvar/data-access';
import { PREFERENCE_STORE } from '../city/city.store';
import { MemoryPreferences } from '../testing/catalog.fixtures';
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

function setup(native = true) {
  const session = fakeSession();
  const app = fakeApp();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SessionStore, useValue: session },
      { provide: IS_NATIVE_PLATFORM, useValue: native },
      { provide: PREFERENCE_STORE, useValue: new MemoryPreferences() },
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  const ready = TestBed.runInInjectionContext(() => bootstrapSession(app as never));
  return { session, app, navigate, ready };
}

describe('deep-link session bootstrap', () => {
  it('routes a native line link without consuming it as a magic link', async () => {
    const { session, app, navigate, ready } = setup();
    expect(app.addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));

    app.open('https://inecekvar.app/ornek-test-sehri/hat/ornek-hat-1');
    await ready;

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/hat/ornek-hat-1?city=ornek-test-sehri');
    expect(session.consumeMagicLinkUrl).not.toHaveBeenCalled();
  });

  it('consumes the full magic link and routes without its token', async () => {
    const { session, app, navigate, ready } = setup();
    const url = 'https://app.inecekvar.app/giris/baglanti#token=abc';

    app.open(url);
    await ready;

    expect(session.consumeMagicLinkUrl).toHaveBeenCalledTimes(1);
    expect(session.consumeMagicLinkUrl).toHaveBeenCalledWith(url);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/giris/baglanti');
    expect(navigate.mock.calls[0]?.[0]).not.toContain('token');
  });

  it('routes foreign-host links to not found without consuming them', async () => {
    const { session, app, navigate, ready } = setup();

    app.open('https://evil.example/hat/x');
    await ready;

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/bulunamadi');
    expect(session.consumeMagicLinkUrl).not.toHaveBeenCalled();
  });

  it('starts the web session without registering a native listener', async () => {
    const { session, app, navigate, ready } = setup(false);
    await ready;

    expect(session.init).toHaveBeenCalledTimes(1);
    expect(app.addListener).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
