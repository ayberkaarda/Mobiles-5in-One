#!/usr/bin/env node
// Android transport and backup guard (spec section 6.10, ADR-0055). Fails when the release
// configuration of the Capacitor shell would permit cleartext traffic, user-added certificate
// authorities, app backup or an exported component without an explicit decision.
//
//   node apps/mobile/scripts/android-transport-check.mjs            # source files
//   node apps/mobile/scripts/android-transport-check.mjs --apk app-debug.apk
//
// The source check reads `android/app/src/main` and any `src/release` overlay. A `src/debug`
// overlay may only open cleartext for loopback hosts (localhost, 127.0.0.1, 10.0.2.2). With
// --apk the merged manifest inside the APK is read back with aapt2 (ANDROID_HOME or
// ANDROID_SDK_ROOT, newest build-tools) and checked the same way. Exit 1 lists every problem.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const appSrc = resolve(process.env.IV_ANDROID_SRC ?? join(here, '../android/app/src'));
const LOOPBACK = new Set(['localhost', '127.0.0.1', '10.0.2.2']);
const problems = [];

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Drops XML comments so commented-out examples never count. */
function stripComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function attribute(tag, name) {
  const match = new RegExp(`android:${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

function checkManifest(label, xml, { release }) {
  const source = stripComments(xml);
  const application = /<application\b[^>]*>/.exec(source)?.[0];
  if (release) {
    if (!application) {
      problems.push(`${label}: no <application> element`);
      return null;
    }
    if (attribute(application, 'usesCleartextTraffic') !== 'false') {
      problems.push(`${label}: android:usesCleartextTraffic must be "false"`);
    }
    if (attribute(application, 'allowBackup') !== 'false') {
      problems.push(`${label}: android:allowBackup must be "false"`);
    }
    if (!attribute(application, 'dataExtractionRules')) {
      problems.push(`${label}: android:dataExtractionRules is missing`);
    }
    if (attribute(application, 'debuggable') === 'true') {
      problems.push(`${label}: android:debuggable="true" in a release manifest`);
    }
  } else if (application && attribute(application, 'usesCleartextTraffic') === 'true') {
    problems.push(`${label}: usesCleartextTraffic="true" (use a loopback domain-config instead)`);
  }
  for (const component of source.matchAll(
    /<(activity|activity-alias|service|receiver|provider)\b[^>]*>/g,
  )) {
    const exported = attribute(component[0], 'exported');
    const name = attribute(component[0], 'name') ?? component[1];
    if (exported === null) problems.push(`${label}: ${name} has no explicit android:exported`);
    if (component[1] === 'provider' && exported === 'true') {
      problems.push(`${label}: provider ${name} is exported`);
    }
  }
  const config = application ? attribute(application, 'networkSecurityConfig') : null;
  return config ? config.replace(/^@xml\//, '') : null;
}

function checkNetworkConfig(label, xml, { release }) {
  const source = stripComments(xml);
  const base = /<base-config\b[^>]*>/.exec(source)?.[0];
  if (release && (!base || !/cleartextTrafficPermitted\s*=\s*"false"/.test(base))) {
    problems.push(`${label}: <base-config cleartextTrafficPermitted="false"> is missing`);
  }
  if (base && /cleartextTrafficPermitted\s*=\s*"true"/.test(base)) {
    problems.push(`${label}: base-config permits cleartext`);
  }
  for (const domainConfig of source.matchAll(
    /<domain-config\b[^>]*>([\s\S]*?)<\/domain-config>/g,
  )) {
    if (!/cleartextTrafficPermitted\s*=\s*"true"/.test(domainConfig[0])) continue;
    const domains = [...domainConfig[1].matchAll(/<domain\b[^>]*>([^<]+)<\/domain>/g)].map((d) =>
      d[1].trim(),
    );
    if (release || domains.some((domain) => !LOOPBACK.has(domain))) {
      problems.push(`${label}: cleartext permitted for ${domains.join(', ') || 'a domain'}`);
    }
  }
  const outsideDebug = source.replace(/<debug-overrides>[\s\S]*?<\/debug-overrides>/g, '');
  if (/<certificates\b[^>]*src\s*=\s*"user"/.test(outsideDebug)) {
    problems.push(`${label}: user certificate authorities trusted outside debug-overrides`);
  }
}

function checkSources() {
  for (const variant of ['main', 'release', 'debug']) {
    const dir = join(appSrc, variant);
    const manifest = read(join(dir, 'AndroidManifest.xml'));
    const release = variant !== 'debug';
    let configName = null;
    if (manifest) {
      configName = checkManifest(`${variant}/AndroidManifest.xml`, manifest, {
        release: variant === 'main',
      });
    } else if (variant === 'main') {
      problems.push('main/AndroidManifest.xml is missing');
    }
    const xmlDir = join(dir, 'res/xml');
    const names = new Set(
      existsSync(xmlDir) ? readdirSync(xmlDir).filter((f) => f.startsWith('network_security')) : [],
    );
    if (configName) names.add(`${configName}.xml`);
    for (const name of names) {
      const xml = read(join(xmlDir, name));
      if (xml === null) {
        if (variant === 'main')
          problems.push(`${variant}/res/xml/${name} is referenced but missing`);
        continue;
      }
      checkNetworkConfig(`${variant}/res/xml/${name}`, xml, { release });
    }
  }
}

function aapt2() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('ANDROID_HOME or ANDROID_SDK_ROOT is required for --apk');
  const tools = join(sdk, 'build-tools');
  const versions = readdirSync(tools).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  for (const version of versions.reverse()) {
    for (const exe of ['aapt2.exe', 'aapt2']) {
      const path = join(tools, version, exe);
      if (existsSync(path)) return path;
    }
  }
  throw new Error('aapt2 not found under ' + tools);
}

/** Reads the compiled manifest back as attribute lines and checks the release-relevant ones. */
function checkApk(apk) {
  const dump = execFileSync(aapt2(), ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk], {
    encoding: 'utf8',
  });
  const value = (name) => {
    const match = new RegExp(
      `A: http://schemas.android.com/apk/res/android:${name}\\([^)]*\\)=([^\\s]+)`,
    ).exec(dump);
    return match ? match[1].replace(/^"|"$/g, '') : null;
  };
  const label = `APK ${apk}`;
  if (value('usesCleartextTraffic') !== 'false')
    problems.push(`${label}: usesCleartextTraffic is not false`);
  if (value('allowBackup') !== 'false') problems.push(`${label}: allowBackup is not false`);
  if (value('networkSecurityConfig') === null) problems.push(`${label}: no networkSecurityConfig`);
  const debuggable = value('debuggable');
  console.log(
    `${label}: usesCleartextTraffic=${value('usesCleartextTraffic')} allowBackup=${value('allowBackup')} ` +
      `networkSecurityConfig=${value('networkSecurityConfig')} debuggable=${debuggable ?? 'absent'}`,
  );
}

const apkIndex = process.argv.indexOf('--apk');
if (apkIndex !== -1) {
  const apk = process.argv[apkIndex + 1];
  if (!apk || !existsSync(apk)) {
    console.error('APK not found: ' + apk);
    process.exit(2);
  }
  checkApk(apk);
} else {
  checkSources();
}

if (problems.length > 0) {
  console.error('Android transport check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('Android transport check passed (' + (apkIndex !== -1 ? 'APK' : appSrc) + ')');
