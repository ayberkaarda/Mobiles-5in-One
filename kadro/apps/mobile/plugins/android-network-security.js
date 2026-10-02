/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads local config plugins with require() */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

/**
 * Security checklist item 10 (HTTPS only) for Android builds.
 *
 * Writes `res/xml/network_security_config.xml` with
 * `<base-config cleartextTrafficPermitted="false">` and points the application's
 * `android:networkSecurityConfig` at it, so release builds refuse every plain-HTTP connection.
 * The development source sets (`debug`, `debugOptimized`; both load the bundle from Metro) get
 * their own copy of the resource that additionally allows plain HTTP to loopback hosts only
 * (Metro over `adb reverse`, the emulator's host alias, a local API), so development builds keep
 * working without weakening release builds. iOS is not touched: App Transport Security stays at
 * its defaults (no `NSAppTransportSecurity` exceptions).
 */

const RESOURCE_NAME = 'network_security_config';
const MANIFEST_REFERENCE = `@xml/${RESOURCE_NAME}`;
const DEBUG_CLEARTEXT_HOSTS = ['localhost', '127.0.0.1', '10.0.2.2'];
/** Android source sets of the Expo template that load JavaScript from Metro over HTTP. */
const DEVELOPMENT_SOURCE_SETS = ['debug', 'debugOptimized'];

function releaseNetworkSecurityConfig() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<network-security-config>',
    '  <base-config cleartextTrafficPermitted="false">',
    '    <trust-anchors>',
    '      <certificates src="system" />',
    '    </trust-anchors>',
    '  </base-config>',
    '</network-security-config>',
    '',
  ].join('\n');
}

function debugNetworkSecurityConfig() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<network-security-config>',
    '  <base-config cleartextTrafficPermitted="false">',
    '    <trust-anchors>',
    '      <certificates src="system" />',
    '    </trust-anchors>',
    '  </base-config>',
    '  <domain-config cleartextTrafficPermitted="true">',
    ...DEBUG_CLEARTEXT_HOSTS.map(
      (host) => `    <domain includeSubdomains="false">${host}</domain>`,
    ),
    '  </domain-config>',
    '</network-security-config>',
    '',
  ].join('\n');
}

/** Sets `android:networkSecurityConfig` on the main application element. */
function setNetworkSecurityConfig(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  application.$ = { ...application.$, 'android:networkSecurityConfig': MANIFEST_REFERENCE };
  return androidManifest;
}

/** Writes the release (main) and development variants of the resource below `androidRoot`. */
function writeNetworkSecurityConfigs(androidRoot) {
  const variants = [
    ['main', releaseNetworkSecurityConfig()],
    ...DEVELOPMENT_SOURCE_SETS.map((sourceSet) => [sourceSet, debugNetworkSecurityConfig()]),
  ];
  for (const [sourceSet, content] of variants) {
    const directory = path.join(androidRoot, 'app', 'src', sourceSet, 'res', 'xml');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed resource path inside the generated android project
    fs.mkdirSync(directory, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed resource path inside the generated android project
    fs.writeFileSync(path.join(directory, `${RESOURCE_NAME}.xml`), content);
  }
}

function withAndroidNetworkSecurity(config) {
  const withManifest = withAndroidManifest(config, (current) => {
    current.modResults = setNetworkSecurityConfig(current.modResults);
    return current;
  });
  return withDangerousMod(withManifest, [
    'android',
    (current) => {
      writeNetworkSecurityConfigs(current.modRequest.platformProjectRoot);
      return current;
    },
  ]);
}

module.exports = withAndroidNetworkSecurity;
module.exports.RESOURCE_NAME = RESOURCE_NAME;
module.exports.DEBUG_CLEARTEXT_HOSTS = DEBUG_CLEARTEXT_HOSTS;
module.exports.DEVELOPMENT_SOURCE_SETS = DEVELOPMENT_SOURCE_SETS;
module.exports.releaseNetworkSecurityConfig = releaseNetworkSecurityConfig;
module.exports.debugNetworkSecurityConfig = debugNetworkSecurityConfig;
