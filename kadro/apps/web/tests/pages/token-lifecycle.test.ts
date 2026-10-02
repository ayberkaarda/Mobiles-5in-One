import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiRequest } from '../../lib/client/api';
import { createTokenCapture } from '../../lib/client/token-capture';
import { fakeBrowser, freshToken } from './support';

/**
 * ADR-0040 "Token handling" steps 2 and 5 over the life of one document: a second link opened in
 * the same document, history writes by the router, leaving the page, and the back/forward cache.
 */

const RESET = '/sifre-sifirla';
const VERIFY = '/e-posta-dogrula';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a new fragment in the same document', () => {
  it('captures a second #token= and strips it from the address bar and history', () => {
    const first = freshToken();
    const second = freshToken();
    const browser = fakeBrowser(RESET, `#token=${first}`);
    const capture = createTokenCapture(browser);
    browser.navigateFragment(`#token=${second}`);
    expect(browser.location.href).toBe(`https://kadro.test${RESET}`);
    expect(browser.history.entries.join(' ')).not.toContain(second);
    expect(capture.read(RESET)).toEqual({ kind: 'valid', token: second });
  });

  it('gives the new token a new version, notifies and aborts the replaced one', () => {
    const browser = fakeBrowser(VERIFY, `#token=${freshToken()}`);
    const capture = createTokenCapture(browser);
    const before = capture.snapshot(VERIFY);
    const listener = vi.fn();
    capture.subscribe(listener);
    browser.navigateFragment(`#token=${freshToken()}`);
    const after = capture.snapshot(VERIFY);
    expect(after.version).not.toBe(before.version);
    expect(before.signal.aborted).toBe(true);
    expect(after.signal.aborted).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('a malformed second fragment replaces the held token with the invalid state', () => {
    const browser = fakeBrowser(RESET, `#token=${freshToken()}`);
    const capture = createTokenCapture(browser);
    browser.navigateFragment('#token=short');
    expect(browser.location.hash).toBe('');
    expect(capture.read(RESET)).toEqual({ kind: 'malformed' });
  });

  it('a hash change without a fragment keeps the held token', () => {
    const token = freshToken();
    const browser = fakeBrowser(RESET, `#token=${token}`);
    const capture = createTokenCapture(browser);
    const version = capture.snapshot(RESET).version;
    browser.fire('popstate');
    browser.fire('hashchange');
    expect(capture.read(RESET)).toEqual({ kind: 'valid', token });
    expect(capture.snapshot(RESET).version).toBe(version);
  });

  it('strips a token fragment written through pushState before it reaches the history entry', () => {
    const token = freshToken();
    const browser = fakeBrowser('/giris', '');
    const capture = createTokenCapture(browser);
    const state = { __NA: true };
    browser.history.pushState(state, '', `${RESET}#token=${token}`);
    expect(browser.native.pushState).toHaveBeenCalledWith(state, '', RESET);
    expect(browser.history.entries.join(' ')).not.toContain(token);
    expect(capture.read(RESET)).toEqual({ kind: 'valid', token });
  });

  it('a router rewrite of the held fragment neither resets the token nor stays in the URL', async () => {
    const token = freshToken();
    const browser = fakeBrowser('/giris', '');
    const capture = createTokenCapture(browser);
    browser.history.pushState({ __NA: true }, '', `${RESET}#token=${token}`);
    const version = capture.snapshot(RESET).version;
    // The router writes its canonical URL (fragment included) again on its next update.
    browser.history.replaceState({ __NA: true }, '', `${RESET}#token=${token}`);
    expect(capture.snapshot(RESET).version).toBe(version);
    expect(browser.history.entries.join(' ')).not.toContain(token);
    // The router is told the bare path, so its state stops carrying the fragment.
    await Promise.resolve();
    expect(browser.native.replaceState).toHaveBeenLastCalledWith(null, '', RESET);
  });

  it('a later write in the same task is not undone by the deferred router update', async () => {
    const browser = fakeBrowser('/giris', '');
    createTokenCapture(browser);
    browser.history.pushState({ __NA: true }, '', `${RESET}#token=${freshToken()}`);
    browser.history.pushState({ __NA: true }, '', '/giris');
    await Promise.resolve();
    await Promise.resolve();
    expect(browser.location.pathname).toBe('/giris');
    expect(browser.history.entries.at(-1)).toBe('https://kadro.test/giris');
    expect(browser.native.replaceState).not.toHaveBeenCalledWith(null, '', RESET);
  });

  it('leaves history writes for other pages and without a fragment untouched', () => {
    const browser = fakeBrowser('/giris', '');
    createTokenCapture(browser);
    browser.history.pushState(null, '', '/giris#bolum');
    browser.history.replaceState(null, '', `${RESET}?x=1`);
    expect(browser.native.pushState).toHaveBeenCalledWith(null, '', '/giris#bolum');
    expect(browser.native.replaceState).toHaveBeenCalledWith(null, '', `${RESET}?x=1`);
  });
});

describe('releasing an unused token', () => {
  it('pagehide drops the token and aborts its request signal', () => {
    const browser = fakeBrowser(RESET, `#token=${freshToken()}`);
    const capture = createTokenCapture(browser);
    const held = capture.snapshot(RESET);
    browser.fire('pagehide', { persisted: true });
    expect(capture.read(RESET)).toEqual({ kind: 'missing' });
    expect(held.signal.aborted).toBe(true);
  });

  it('a page restored from the back/forward cache has no token and asks for the link again', () => {
    const browser = fakeBrowser(VERIFY, `#token=${freshToken()}`);
    const capture = createTokenCapture(browser);
    const version = capture.snapshot(VERIFY).version;
    browser.fire('pagehide', { persisted: true });
    browser.fire('pageshow', { persisted: true });
    expect(capture.read(VERIFY)).toEqual({ kind: 'missing' });
    expect(capture.snapshot(VERIFY).version).not.toBe(version);
  });

  it('pagehide after the token was spent changes nothing (the settled view stays)', () => {
    const browser = fakeBrowser(RESET, `#token=${freshToken()}`);
    const capture = createTokenCapture(browser);
    capture.forget(capture.snapshot(RESET).version);
    const version = capture.snapshot(RESET).version;
    browser.fire('pagehide', { persisted: true });
    expect(capture.snapshot(RESET).version).toBe(version);
  });

  it('releases the token one task after the page unmounts (last subscriber leaves)', () => {
    vi.useFakeTimers();
    const browser = fakeBrowser(RESET, `#token=${freshToken()}`);
    const capture = createTokenCapture(browser);
    const held = capture.snapshot(RESET);
    const unsubscribe = capture.subscribe(() => undefined);
    unsubscribe();
    expect(capture.read(RESET).kind).toBe('valid');
    vi.runAllTimers();
    expect(capture.read(RESET)).toEqual({ kind: 'missing' });
    expect(held.signal.aborted).toBe(true);
  });

  it('keeps the token across an immediate remount (React strict-mode effects)', () => {
    vi.useFakeTimers();
    const token = freshToken();
    const browser = fakeBrowser(RESET, `#token=${token}`);
    const capture = createTokenCapture(browser);
    capture.subscribe(() => undefined)();
    capture.subscribe(() => undefined);
    vi.runAllTimers();
    expect(capture.read(RESET)).toEqual({ kind: 'valid', token });
  });

  it('forget with the version of a replaced token keeps the newer token', () => {
    const second = freshToken();
    const browser = fakeBrowser(RESET, `#token=${freshToken()}`);
    const capture = createTokenCapture(browser);
    const stale = capture.snapshot(RESET).version;
    browser.navigateFragment(`#token=${second}`);
    capture.forget(stale);
    expect(capture.read(RESET)).toEqual({ kind: 'valid', token: second });
  });
});

describe('request cancellation', () => {
  it('sendFromPage hands the signal to fetch; an aborted request settles as network', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { sendFromPage } = await import('../../components/auth/hooks');
    const controller = new AbortController();
    const pending = sendFromPage(
      buildApiRequest('verifyEmail', { token: freshToken() }),
      controller.signal,
    );
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: 'network' });
    expect(fetchMock.mock.calls[0]?.[1].signal).toBe(controller.signal);
  });
});
