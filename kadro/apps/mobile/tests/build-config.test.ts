/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getConfig } from 'expo/config';
import { compileModsAsync, type ExportedConfig } from 'expo/config-plugins';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Security checklist item 10 (HTTPS only), mobile build configuration. Reads `app.json`, applies
 * every configured plugin through Expo's own mod compiler against a minimal native project in a
 * temporary directory, and asserts the generated Android files: release builds refuse all
 * plain-HTTP traffic, development builds allow it to loopback hosts only, and iOS App Transport
 * Security keeps the template defaults. The rule that `EXPO_PUBLIC_API_URL` uses https:// outside
 * the local environment is tested in packages/config (`env.test.ts`, "requires https for preview
 * and production builds").
 */

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** App Transport Security of the Expo SDK 57 bare template Info.plist. */
const TEMPLATE_ATS = { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true };

interface StaticAppJson {
  readonly expo: {
    readonly ios?: { readonly infoPlist?: Record<string, unknown> };
    readonly android?: Record<string, unknown>;
    readonly plugins?: readonly (string | readonly [string, unknown])[];
  };
}

function readAppJson(): StaticAppJson {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this package's app.json
  return JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8')) as StaticAppJson;
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

let nativeRoot: string;

beforeAll(async () => {
  nativeRoot = mkdtempSync(path.join(tmpdir(), 'kadro-mobile-build-config-'));
  writeAndroidSkeleton(nativeRoot);
  await compileModsAsync(moddedConfig(), {
    projectRoot: nativeRoot,
    platforms: ['android'],
    assertMissingModProviders: false,
  });
});

afterAll(() => {
  rmSync(nativeRoot, { recursive: true, force: true });
});

function generated(relative: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary native project
  return readFileSync(path.join(nativeRoot, 'android', 'app', 'src', relative), 'utf8');
}

describe('app.json', () => {
  it('configures cleartext blocking through expo-build-properties and the local plugin', () => {
    const plugins = readAppJson().expo.plugins ?? [];
    expect(plugins).toContainEqual([
      'expo-build-properties',
      { android: { usesCleartextTraffic: false } },
    ]);
    expect(plugins).toContain('./plugins/android-network-security.js');
  });

  it('adds no App Transport Security exception on iOS', () => {
    const app = readAppJson().expo;
    expect(app.ios?.infoPlist?.NSAppTransportSecurity).toBeUndefined();
    const buildProperties = (app.plugins ?? []).find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
    );
    expect((buildProperties?.[1] as Record<string, unknown> | undefined)?.ios).toBeUndefined();
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
