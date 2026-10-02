import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isWellFormedToken,
  parseFragmentToken,
  takeFragmentToken,
} from '../../lib/client/fragment-token';
import { createTokenCapture } from '../../lib/client/token-capture';
import { fakeBrowser, freshToken, storageSpy } from './support';

/** ADR-0040 "Token handling" steps 1-3 and 5; threat model T-WEB-01, T-WEB-02. */

describe('parseFragmentToken', () => {
  it('accepts exactly one well-formed token', () => {
    const token = freshToken();
    expect(parseFragmentToken(`#token=${token}`)).toEqual({ kind: 'valid', token });
    expect(parseFragmentToken(`token=${token}`)).toEqual({ kind: 'valid', token });
    // Unrelated keys are ignored.
    expect(parseFragmentToken(`#utm=x&token=${token}`)).toEqual({ kind: 'valid', token });
  });

  it('accepts the length bounds of the contracts (43..128) and nothing outside', () => {
    expect(parseFragmentToken(`#token=${'a'.repeat(43)}`).kind).toBe('valid');
    expect(parseFragmentToken(`#token=${'a'.repeat(128)}`).kind).toBe('valid');
    expect(parseFragmentToken(`#token=${'a'.repeat(42)}`).kind).toBe('malformed');
    expect(parseFragmentToken(`#token=${'a'.repeat(129)}`).kind).toBe('malformed');
  });

  it('reports an absent fragment or absent key as missing', () => {
    for (const hash of ['', '#', '#foo=bar', '#tokens=abc', '#&&']) {
      expect(parseFragmentToken(hash), hash).toEqual({ kind: 'missing' });
    }
  });

  it('rejects empty, repeated, encoded and non-base64url values', () => {
    const token = freshToken();
    const cases = [
      '#token',
      '#token=',
      `#token=${token}&token=${token}`,
      `#token=${token}&token=${freshToken()}`,
      `#token=${token.slice(0, 20)}%2F${token.slice(20)}`,
      `#token=${token}=`,
      `#token=${token}+`,
      `#token=${token.slice(0, 30)}/${token.slice(30)}`,
      `#token=${token} `,
      '#token=<script>alert(1)</script>xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    ];
    for (const hash of cases) {
      expect(parseFragmentToken(hash).kind, hash).toBe('malformed');
    }
  });

  it('isWellFormedToken matches the opaque token schema', () => {
    expect(isWellFormedToken(freshToken())).toBe(true);
    expect(isWellFormedToken(freshToken(96))).toBe(true);
    expect(isWellFormedToken(freshToken(97))).toBe(false);
    expect(isWellFormedToken('')).toBe(false);
  });
});

describe('takeFragmentToken', () => {
  it('removes the fragment (and the query) from the address bar and the history entry', () => {
    const token = freshToken();
    const browser = fakeBrowser('/sifre-sifirla', `#token=${token}`, '?x=1');
    const result = takeFragmentToken(browser.location, browser.history);
    expect(result).toEqual({ kind: 'valid', token });
    expect(browser.history.replaceState).toHaveBeenCalledTimes(1);
    expect(browser.history.replaceState).toHaveBeenCalledWith(null, '', '/sifre-sifirla');
    expect(browser.location.href).toBe('https://kadro.test/sifre-sifirla');
    expect(browser.history.entries.join(' ')).not.toContain(token);
  });

  it('removes a malformed fragment too', () => {
    const browser = fakeBrowser('/e-posta-dogrula', '#token=short');
    expect(takeFragmentToken(browser.location, browser.history).kind).toBe('malformed');
    expect(browser.location.hash).toBe('');
    expect(browser.history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('leaves a URL without fragment alone', () => {
    const browser = fakeBrowser('/e-posta-dogrula', '');
    expect(takeFragmentToken(browser.location, browser.history).kind).toBe('missing');
    expect(browser.history.replaceState).not.toHaveBeenCalled();
  });

  it('never passes the token to replaceState', () => {
    const token = freshToken();
    const browser = fakeBrowser('/sifre-sifirla', `#token=${token}`);
    takeFragmentToken(browser.location, browser.history);
    expect(JSON.stringify(browser.history.replaceState.mock.calls)).not.toContain(token);
  });
});

describe('createTokenCapture', () => {
  it('captures on creation and reads only for the path it was captured on', () => {
    const token = freshToken();
    const browser = fakeBrowser('/sifre-sifirla', `#token=${token}`);
    const capture = createTokenCapture(browser);
    // The fragment is gone before any caller asks for it.
    expect(browser.location.hash).toBe('');
    expect(capture.read('/sifre-sifirla')).toEqual({ kind: 'valid', token });
    expect(capture.read('/e-posta-dogrula')).toEqual({ kind: 'missing' });
  });

  it('forgets the token', () => {
    const browser = fakeBrowser('/e-posta-dogrula', `#token=${freshToken()}`);
    const capture = createTokenCapture(browser);
    capture.forget();
    expect(capture.read('/e-posta-dogrula')).toEqual({ kind: 'missing' });
  });

  it('leaves the fragment of every other page alone', () => {
    for (const pathname of ['/', '/giris', '/sss', '/sifre-sifirla/x']) {
      const browser = fakeBrowser(pathname, `#token=${freshToken()}`);
      const capture = createTokenCapture(browser);
      expect(browser.history.replaceState, pathname).not.toHaveBeenCalled();
      expect(capture.read(pathname)).toEqual({ kind: 'missing' });
    }
  });

  it('reads nothing on the server', () => {
    expect(createTokenCapture(undefined).read('/sifre-sifirla')).toEqual({ kind: 'missing' });
  });
});

describe('page-wide capture module', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('strips the fragment while the module is evaluated and writes the token nowhere', async () => {
    const token = freshToken();
    const browser = fakeBrowser('/e-posta-dogrula', `#token=${token}`);
    const local = storageSpy();
    const session = storageSpy();
    const cookieWrites: string[] = [];
    const document = {
      get cookie() {
        return '';
      },
      set cookie(value: string) {
        cookieWrites.push(value);
      },
    };
    vi.stubGlobal('window', {
      location: browser.location,
      history: browser.history,
      localStorage: local.storage,
      sessionStorage: session.storage,
      document,
    });
    vi.stubGlobal('localStorage', local.storage);
    vi.stubGlobal('sessionStorage', session.storage);
    vi.stubGlobal('document', document);
    vi.resetModules();

    const capture = await import('../../lib/client/token-capture');
    // Step 2: evaluation alone removed the fragment, before any export is used.
    expect(browser.history.replaceState).toHaveBeenCalledTimes(1);
    expect(browser.location.href).not.toContain(token);
    expect(capture.pageTokenCapture.read('/e-posta-dogrula')).toEqual({ kind: 'valid', token });

    // The full redeem path, from the capture to the request body, touches no storage.
    const api = await import('../../lib/client/api');
    const sent: RequestInit[] = [];
    const outcome = await api.sendApiRequest(
      (_url, init) => {
        sent.push(init);
        return Promise.resolve(new Response(null, { status: 204 }));
      },
      api.buildApiRequest('verifyEmail', { token }),
    );
    expect(outcome.kind).toBe('ok');
    capture.pageTokenCapture.forget();
    expect(capture.pageTokenCapture.read('/e-posta-dogrula')).toEqual({ kind: 'missing' });

    expect(local.writes).toEqual([]);
    expect(session.writes).toEqual([]);
    expect(cookieWrites).toEqual([]);
    expect(browser.history.entries.join(' ')).not.toContain(token);
    // The token reaches exactly one place: the JSON body of the same-origin request.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toBe(JSON.stringify({ token }));
  });
});
