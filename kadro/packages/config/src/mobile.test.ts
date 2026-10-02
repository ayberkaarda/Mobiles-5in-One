import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMobilePublicEnv } from './mobile.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadMobilePublicEnv', () => {
  it('reads every public key statically, including the web origin and RevenueCat keys', () => {
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'production');
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://kadro.app');
    vi.stubEnv('EXPO_PUBLIC_WEB_ORIGIN', 'https://kadro.app');
    vi.stubEnv('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', 'appl_publicsdkkey1234');
    vi.stubEnv('EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY', '');
    expect(loadMobilePublicEnv()).toEqual({
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_URL: 'https://kadro.app',
      EXPO_PUBLIC_WEB_ORIGIN: 'https://kadro.app',
      EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'appl_publicsdkkey1234',
    });
  });

  it('keeps every process.env access a literal member expression for the Expo bundler', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed sibling source file
    const source = readFileSync(new URL('./mobile.ts', import.meta.url), 'utf8');
    const keys = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]);
    expect(keys).toEqual([
      'EXPO_PUBLIC_APP_ENV',
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_WEB_ORIGIN',
      'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY',
      'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY',
    ]);
    expect(source).not.toMatch(/process\.env\[/);
  });
});

describe('package exports', () => {
  it('exposes ./mobile to import and require resolution', () => {
    const manifestUrl = new URL('../package.json', import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this package's manifest
    const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
      exports: Record<string, Record<string, string>>;
    };
    expect(manifest.exports['./mobile']).toEqual({
      types: './dist/mobile.d.ts',
      import: './dist/mobile.js',
      require: './dist/mobile.js',
      default: './dist/mobile.js',
    });
  });
});
