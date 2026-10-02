import type { ExpoConfig } from 'expo/config';

// Expo evaluates this file with require(), and `@kadro/config` only exposes an ESM `import`
// condition, so the built module is referenced by path (turbo builds the package first).
import { loadMobilePublicEnv } from '../../packages/config/dist/mobile.js';

type IntentFilter = NonNullable<NonNullable<ExpoConfig['android']>['intentFilters']>[number];

const APP_SCHEME = 'kadro';

/**
 * Web paths the app opens as universal / app links (ADR-0034 invite links plus the venue, open
 * call and email flows). Links only navigate; every mutation needs an explicit tap and server-side
 * authorization (threat model T-MOB-03).
 */
export const UNIVERSAL_LINK_PATHS = [
  '/mac',
  '/saha',
  '/eksik-var',
  '/e-posta-dogrula',
  '/sifre-sifirla',
] as const;

/**
 * Host of the universal link domain, derived from the configured web origin. Returns `null` unless
 * the origin is a bare https origin, so a misconfigured value never produces an association.
 */
export function universalLinkHost(webOrigin: string | undefined): string | null {
  if (webOrigin === undefined || webOrigin === '') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(webOrigin);
  } catch {
    return null;
  }
  const bare =
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '';
  return bare ? url.host : null;
}

export function associatedDomainsFor(host: string | null): string[] | undefined {
  return host === null ? undefined : [`applinks:${host}`];
}

export function androidIntentFilters(host: string | null): IntentFilter[] {
  const filters: IntentFilter[] = [
    { action: 'VIEW', category: ['BROWSABLE', 'DEFAULT'], data: [{ scheme: APP_SCHEME }] },
  ];
  if (host !== null) {
    filters.push({
      action: 'VIEW',
      autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: UNIVERSAL_LINK_PATHS.map((pathPrefix) => ({ scheme: 'https', host, pathPrefix })),
    });
  }
  return filters;
}

type UpdatesConfig = NonNullable<ExpoConfig['updates']>;

/**
 * Schema preparation for `expo-updates` code signing. The certificate path is the only input;
 * no certificate or key is committed. Without a path no `updates` block is produced.
 */
export function updatesConfig(
  codeSigningCertificate: string | undefined,
): UpdatesConfig | undefined {
  if (codeSigningCertificate === undefined || codeSigningCertificate === '') {
    return undefined;
  }
  return {
    codeSigningCertificate,
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
  };
}

/**
 * Throws an EnvValidationError (key names only, never values) when an `EXPO_PUBLIC_*` variable is
 * missing or invalid, e.g. a non-https API URL outside the local environment, so a bad build
 * configuration fails here instead of shipping.
 */
export default function createConfig(): ExpoConfig {
  const publicEnv = loadMobilePublicEnv();
  const webOrigin = (publicEnv as { EXPO_PUBLIC_WEB_ORIGIN?: string }).EXPO_PUBLIC_WEB_ORIGIN;
  const linkHost = universalLinkHost(webOrigin);
  const updates = updatesConfig(undefined);
  return {
    name: 'Kadro',
    slug: 'kadro',
    scheme: APP_SCHEME,
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    backgroundColor: '#F4F6F0',
    ios: {
      bundleIdentifier: 'app.kadro.mobile',
      supportsTablet: false,
      usesAppleSignIn: true,
      ...(associatedDomainsFor(linkHost) === undefined
        ? {}
        : { associatedDomains: associatedDomainsFor(linkHost) }),
    },
    android: {
      package: 'app.kadro.mobile',
      intentFilters: androidIntentFilters(linkHost),
    },
    plugins: [
      'expo-router',
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: false,
          },
        },
      ],
      './plugins/android-network-security.js',
      'expo-secure-store',
      'expo-image',
      'expo-font',
      'expo-localization',
      'expo-notifications',
      'expo-apple-authentication',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Kadro konumunu yakınındaki sahaları ve eksik oyuncu ilanlarını göstermek için kullanır.',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    ...(updates === undefined ? {} : { updates }),
  };
}
