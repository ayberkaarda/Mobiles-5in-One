import { describe, expect, it } from 'vitest';

// @ts-expect-error -- plain ES module script without type declarations
import { resolveExportEnv } from '../scripts/export.mjs';

type Env = Record<string, string | undefined>;
const resolve = resolveExportEnv as (source: Env, bundleCheck: boolean) => Env;

describe('resolveExportEnv', () => {
  it('adds nothing in a normal export, so .env files and validation decide', () => {
    const env = resolve({ PATH: 'x' }, false);
    expect(env.EXPO_PUBLIC_APP_ENV).toBeUndefined();
    expect(env.EXPO_PUBLIC_API_URL).toBeUndefined();
    expect(env.PATH).toBe('x');
  });

  it('supplies local defaults only with the bundle-check flag', () => {
    const env = resolve({}, true);
    expect(env.EXPO_PUBLIC_APP_ENV).toBe('local');
    expect(env.EXPO_PUBLIC_API_URL).toBe('http://localhost:3000');
  });

  it('never overrides values the shell already sets', () => {
    const env = resolve(
      { EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_API_URL: 'http://api.invalid.example' },
      true,
    );
    expect(env.EXPO_PUBLIC_APP_ENV).toBe('production');
    expect(env.EXPO_PUBLIC_API_URL).toBe('http://api.invalid.example');
  });
});
