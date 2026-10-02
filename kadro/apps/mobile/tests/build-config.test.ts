/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConfig, type ExpoConfig } from 'expo/config';
import { compileModsAsync, type ExportedConfig } from 'expo/config-plugins';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Security checklist item 10 (HTTPS only), mobile build configuration. Evaluates `app.config.ts`
 * under a valid local public environment, applies every configured plugin through Expo's own mod compiler against a minimal native project in a
 * temporary directory, and asserts the generated Android files: release builds refuse all
 * plain-HTTP traffic, development builds allow it to loopback hosts only, and iOS App Transport
 * Security keeps the template defaults. The rule that `EXPO_PUBLIC_API_URL` uses https:// outside
 * the local environment is defined in packages/config (`env.test.ts`) and enforced again here: the
 * config itself refuses to evaluate for a plain-HTTP API URL in a production build.
 */

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** App Transport Security of the Expo SDK 57 bare template Info.plist. */
const TEMPLATE_ATS = { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true };

const VALID_PUBLIC_ENV = {
  EXPO_PUBLIC_APP_ENV: 'local',
  EXPO_PUBLIC_API_URL: 'http://localhost:3000',
} as const;

function stubPublicEnv(env: Readonly<Record<string, string>> = VALID_PUBLIC_ENV): void {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The plain resolved config (no mods), as `expo config` prints it. */
function resolvedConfig(): ExpoConfig {
  return getConfig(PROJECT_ROOT, { skipSDKVersionRequirement: true }).exp;
}

/** The resolved config with the mods every plugin registered (what `expo prebuild` evaluates). */
function moddedConfig(): ExportedConfig {
  const { exp } = getConfig(PROJECT_ROOT, {
    skipSDKVersionRequirement: true,
    isModdedConfig: true,
  });
  return exp as ExportedConfig;
}

/** Files of the Expo template that the configured Android mods read. */
function writeAndroidSkeleton(root: string): void {
  const files: Record<string, string> = {
    'android/gradle.properties': '',
    'android/settings.gradle': "rootProject.name = 'Kadro'\n",
    'android/app/proguard-rules.pro': '',
    'android/app/src/main/AndroidManifest.xml': [
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
      '  <uses-permission android:name="android.permission.INTERNET"/>',
      '  <application android:name=".MainApplication" android:label="@string/app_name" android:allowBackup="false">',
      '    <activity android:name=".MainActivity" android:exported="true"/>',
      '  </application>',
      '</manifest>',
      '',
    ].join('\n'),
    'android/app/src/main/res/values/styles.xml':
      '<resources>\n  <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar"/>\n</resources>\n',
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary native project
    mkdirSync(path.dirname(file), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary native project
    writeFileSync(file, content);
  }
}

/** Message of the error `fn` throws; the test fails when it does not throw. */
function captureFailure(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the config evaluation to fail');
}

let nativeRoot: string;

beforeAll(async () => {
  stubPublicEnv();
  nativeRoot = mkdtempSync(path.join(tmpdir(), 'kadro-mobile-build-config-'));
  writeAndroidSkeleton(nativeRoot);
  await compileModsAsync(moddedConfig(), {
    projectRoot: nativeRoot,
    platforms: ['android'],
    assertMissingModProviders: false,
  });
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(nativeRoot, { recursive: true, force: true });
});

function generated(relative: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary native project
  return readFileSync(path.join(nativeRoot, 'android', 'app', 'src', relative), 'utf8');
}

describe('app.config.ts', () => {
  it('configures cleartext blocking through expo-build-properties and the local plugin', () => {
    stubPublicEnv();
    const plugins = resolvedConfig().plugins ?? [];
    expect(plugins).toContainEqual([
      'expo-build-properties',
      { android: { usesCleartextTraffic: false } },
    ]);
    expect(plugins).toContain('./plugins/android-network-security.js');
  });

  it('adds no App Transport Security exception on iOS', () => {
    stubPublicEnv();
    const app = resolvedConfig();
    expect(app.ios?.infoPlist?.NSAppTransportSecurity).toBeUndefined();
    const buildProperties = (app.plugins ?? []).find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
    );
    expect((buildProperties?.[1] as Record<string, unknown> | undefined)?.ios).toBeUndefined();
  });

  it('registers the kadro scheme and a scheme intent filter without a web origin', () => {
    stubPublicEnv();
    const app = resolvedConfig();
    expect(app.scheme).toBe('kadro');
    expect(app.android?.intentFilters).toContainEqual({
      action: 'VIEW',
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'kadro' }],
    });
    expect(app.ios?.associatedDomains).toBeUndefined();
  });

  it('keeps secrets out of extra and defines no update code signing without a certificate', () => {
    stubPublicEnv();
    const app = resolvedConfig();
    expect(JSON.stringify(app.extra ?? {})).not.toMatch(/secret|token|password|private/i);
    expect(app.updates?.codeSigningCertificate).toBeUndefined();
    expect(app.updates?.codeSigningMetadata).toBeUndefined();
  });

  it('fails fast when the API URL is plain HTTP in a production build', () => {
    stubPublicEnv({
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_URL: 'http://api.invalid.example',
    });
    const failure = captureFailure(() => resolvedConfig());
    expect(failure).toContain('EXPO_PUBLIC_API_URL');
    expect(failure).toContain('https://');
    expect(failure).not.toContain('api.invalid.example');
  });

  it('fails fast and names only the key when a public variable is missing', () => {
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'preview');
    vi.stubEnv('EXPO_PUBLIC_API_URL', '');
    const failure = captureFailure(() => resolvedConfig());
    expect(failure).toContain('EXPO_PUBLIC_API_URL');
  });

  it('accepts an https API URL in a production build', () => {
    stubPublicEnv({
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_URL: 'https://api.kadro.example',
    });
    expect(resolvedConfig().scheme).toBe('kadro');
  });
});

describe('generated Android project', () => {
  it('points the application at the network security config and disables cleartext', () => {
    const manifest = generated('main/AndroidManifest.xml');
    expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
  });

  it('refuses plain HTTP everywhere in release builds', () => {
    const release = generated('main/res/xml/network_security_config.xml');
    expect(release).toContain('<base-config cleartextTrafficPermitted="false">');
    expect(release).not.toContain('cleartextTrafficPermitted="true"');
    expect(release).not.toContain('<domain-config');
    expect(release).not.toContain('src="user"');
  });

  it('allows plain HTTP to loopback hosts only in development builds', () => {
    for (const sourceSet of ['debug', 'debugOptimized']) {
      const development = generated(`${sourceSet}/res/xml/network_security_config.xml`);
      expect(development).toContain('<base-config cleartextTrafficPermitted="false">');
      const domains = [...development.matchAll(/<domain [^>]*>([^<]+)<\/domain>/g)].map(
        (match) => match[1],
      );
      expect(domains.sort()).toEqual(['10.0.2.2', '127.0.0.1', 'localhost']);
    }
  });
});

describe('generated iOS Info.plist', () => {
  it('keeps the template App Transport Security settings unchanged', async () => {
    stubPublicEnv();
    const config = moddedConfig();
    config.ios = { ...config.ios, infoPlist: { NSAppTransportSecurity: { ...TEMPLATE_ATS } } };
    const result = await compileModsAsync(config, {
      projectRoot: nativeRoot,
      platforms: ['ios'],
      introspect: true,
      assertMissingModProviders: false,
    });
    expect(result.ios?.infoPlist?.NSAppTransportSecurity).toEqual(TEMPLATE_ATS);
  });
});
