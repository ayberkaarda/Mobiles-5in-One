import { isSlug, resolveDeepLink } from './deep-link';

describe('resolveDeepLink', () => {
  it.each([
    ['https://inecekvar.app/hat/ornek-hat-1', '/hat/ornek-hat-1'],
    ['https://app.inecekvar.app/durak/durak-1-2/', '/durak/durak-1-2'],
    [
      'https://inecekvar.app/ornek-test-sehri/hat/ornek-hat-1',
      '/hat/ornek-hat-1?city=ornek-test-sehri',
    ],
    [
      'https://inecekvar.app/hat/ornek-hat-1?city=ornek-test-sehri&utm=x#frag',
      '/hat/ornek-hat-1?city=ornek-test-sehri',
    ],
    ['https://INECEKVAR.APP/hat/a1', '/hat/a1'],
  ])('routes %s to %s', (url, path) => {
    expect(resolveDeepLink(url)).toEqual({ kind: 'route', path });
  });

  it('keeps the magic-link token out of the route', () => {
    const target = resolveDeepLink('https://app.inecekvar.app/giris/baglanti#token=abc');

    expect(target).toEqual({ kind: 'magic-link', path: '/giris/baglanti' });
    expect(target.path).not.toContain('token');
    expect(target.path).not.toContain('abc');
  });

  it.each([
    ['foreign host', 'https://evil.example/hat/x'],
    ['host suffix', 'https://inecekvar.app.evil.example/hat/x'],
    ['host prefix', 'https://evilinecekvar.app/hat/x'],
    ['product host as credentials', 'https://inecekvar.app@evil.example/hat/x'],
    ['credentials on the product host', 'https://user:pw@inecekvar.app/hat/x'],
    ['http', 'http://inecekvar.app/hat/x'],
    ['custom scheme', 'inecekvar://hat/x'],
    ['port', 'https://inecekvar.app:8443/hat/x'],
    ['javascript', 'javascript:alert(1)'],
    ['unknown path', 'https://inecekvar.app/admin'],
    ['missing slug', 'https://inecekvar.app/hat/'],
    ['uppercase slug', 'https://inecekvar.app/hat/ORN-1'],
    ['encoded slash', 'https://inecekvar.app/hat/a%2Fb'],
    ['dot segments', 'https://inecekvar.app/hat/../ayarlar'],
    ['double hyphen', 'https://inecekvar.app/hat/a--b'],
    ['long slug', `https://inecekvar.app/hat/${'a'.repeat(121)}`],
    ['invalid query city', 'https://inecekvar.app/hat/x?city=..%2F'],
    ['four segments', 'https://inecekvar.app/a/b/hat/x'],
    ['empty string', ''],
    ['invalid URL', 'not a url'],
    [
      '3000-character URL',
      `https://inecekvar.app/hat/${'a'.repeat(3000 - 'https://inecekvar.app/hat/'.length)}`,
    ],
  ])('rejects %s', (_label, url) => {
    expect(resolveDeepLink(url)).toEqual({ kind: 'not-found', path: '/bulunamadi' });
  });
});

describe('isSlug', () => {
  it.each(['a1', 'ornek-hat-1', 'a'.repeat(120)])('accepts %s', (slug) => {
    expect(isSlug(slug)).toBe(true);
  });

  it.each([
    null,
    undefined,
    '',
    'ORN-1',
    'a--b',
    '-a',
    'a-',
    'a/b',
    'a%2Fb',
    '..',
    'a'.repeat(121),
  ])('rejects %s', (slug) => {
    expect(isSlug(slug)).toBe(false);
  });
});
