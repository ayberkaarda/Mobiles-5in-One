// @vitest-environment node
import { loadWebServerConfig } from './config';

describe('web server config', () => {
  it('uses strict production defaults without environment variables', () => {
    expect(loadWebServerConfig({})).toEqual({
      env: 'production',
      canonicalOrigin: 'https://inecekvar.app',
      allowedHosts: ['inecekvar.app', 'www.inecekvar.app'],
      apiPublicOrigin: 'https://api.inecekvar.app',
      apiPublicBaseUrl: 'https://api.inecekvar.app/v1',
      appStoreId: null,
      tilesOrigin: 'https://tiles.inecekvar.app',
      apiInternalUrl: 'http://127.0.0.1:57800/v1',
      cacheTtlMs: 600_000,
      cacheMaxEntries: 500,
      cacheMaxBytes: 32 * 1024 * 1024,
      cacheQueryAllowlist: ['sayfa'],
      cacheDebugHeader: false,
      robotsIndexable: true,
    });
  });

  it('drops wildcard and loopback hosts in production and keeps the canonical host', () => {
    const config = loadWebServerConfig({
      IV_WEB_ALLOWED_HOSTS: 'LOCALHOST,127.0.0.1,::1,[::1],*,WWW.INECEKVAR.APP',
    });
    expect(config.allowedHosts).toEqual(['www.inecekvar.app', 'inecekvar.app']);
  });

  it.each(['local', 'test'])('adds loopback hosts in %s', (env) => {
    const config = loadWebServerConfig({ INECEKVAR_ENV: env });
    expect(config.allowedHosts).toContain('localhost');
    expect(config.allowedHosts).toContain('127.0.0.1');
    expect(config.cacheDebugHeader).toBe(true);
    expect(config.robotsIndexable).toBe(false);
  });

  it.each(['IV_WEB_CANONICAL_ORIGIN', 'IV_WEB_API_PUBLIC_ORIGIN', 'IV_WEB_TILES_ORIGIN'])(
    'rejects cleartext %s in production without echoing its value',
    (variable) => {
      const value = 'http://example.test';
      expect(() => loadWebServerConfig({ [variable]: value })).toThrow(`Invalid ${variable}`);
      try {
        loadWebServerConfig({ [variable]: value });
      } catch (error) {
        expect(String(error)).not.toContain(value);
      }
    },
  );

  it.each([
    'https://example.test/path',
    'https://example.test/a/..',
    'https://example.test?x=1',
    'https://example.test?',
    'https://name:pass@example.test',
    'https://@example.test',
    'https://example.test#section',
    'invalid',
  ])('rejects an origin with extra URL components: %s', (value) => {
    expect(() => loadWebServerConfig({ IV_WEB_CANONICAL_ORIGIN: value })).toThrow(
      'IV_WEB_CANONICAL_ORIGIN',
    );
  });

  it('treats an unknown environment as production', () => {
    expect(loadWebServerConfig({ INECEKVAR_ENV: 'preview' }).env).toBe('production');
  });

  it.each(['123456', '123456789012'])('accepts an app store id %s', (appStoreId) => {
    expect(loadWebServerConfig({ IV_WEB_IOS_APP_ID: appStoreId }).appStoreId).toBe(appStoreId);
  });

  it.each(['', '12345', '1234567890123', '12abc345', ' 123456'])(
    'ignores an invalid app store id %s',
    (appStoreId) => {
      expect(loadWebServerConfig({ IV_WEB_IOS_APP_ID: appStoreId }).appStoreId).toBeNull();
    },
  );

  it('derives the public API base from the public origin', () => {
    expect(
      loadWebServerConfig({ IV_WEB_API_PUBLIC_ORIGIN: 'https://api.example.test/' })
        .apiPublicBaseUrl,
    ).toBe('https://api.example.test/v1');
  });

  it('normalizes origin casing and keeps nondefault ports out of hostnames', () => {
    const config = loadWebServerConfig({
      INECEKVAR_ENV: 'local',
      IV_WEB_CANONICAL_ORIGIN: 'http://EXAMPLE.TEST:4200',
      IV_WEB_ALLOWED_HOSTS: 'alias.example:4000',
      IV_WEB_CACHE_TTL_SECONDS: '45',
      IV_WEB_CACHE_MAX_ENTRIES: '12',
      IV_WEB_CACHE_QUERY_ALLOWLIST: 'sayfa, sort, sayfa',
    });
    expect(config.canonicalOrigin).toBe('http://example.test:4200');
    expect(config.allowedHosts).toContain('example.test');
    expect(config.allowedHosts).not.toContain('example.test:4200');
    expect(config.allowedHosts).toContain('alias.example');
    expect(config.allowedHosts).not.toContain('alias.example:4000');
    expect(config.cacheTtlMs).toBe(45_000);
    expect(config.cacheMaxEntries).toBe(12);
    expect(config.cacheQueryAllowlist).toEqual(['sayfa', 'sort']);
  });

  it('rejects a production loopback canonical origin', () => {
    expect(() => loadWebServerConfig({ IV_WEB_CANONICAL_ORIGIN: 'https://localhost' })).toThrow(
      'IV_WEB_CANONICAL_ORIGIN',
    );
  });

  it.each(['0', '-1', '1.5', 'invalid'])('rejects invalid cache limits: %s', (value) => {
    expect(() => loadWebServerConfig({ IV_WEB_CACHE_MAX_ENTRIES: value })).toThrow(
      'IV_WEB_CACHE_MAX_ENTRIES',
    );
  });
});
