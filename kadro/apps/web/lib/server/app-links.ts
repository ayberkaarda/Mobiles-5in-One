import type { WebEnv } from '@kadro/config';
import { APP_LINK_PATH_PATTERNS, MOBILE_APP_IDS } from '@kadro/contracts';

import type { StoreEntry } from '../../components/marketing/site';

/**
 * Verified app links and store listings from configuration (product spec §7 "App linking",
 * ADR-0045, ADR-0058).
 *
 * - `/.well-known/apple-app-site-association` names `<APPLE_TEAM_ID>.<bundle id>` and the path
 *   patterns of `APP_LINK_PATH_PATTERNS`; without `APPLE_TEAM_ID` there is no document (404).
 * - `/.well-known/assetlinks.json` names the Android package and every fingerprint of
 *   `ANDROID_CERT_SHA256_FINGERPRINTS`; without fingerprints there is no document (404).
 * - Store entries link to a listing only when configuration names it: the App Store listing
 *   from `APPLE_APP_STORE_ID`, the Google Play listing of the fixed application id once the
 *   Play signing fingerprints are configured. Otherwise the entry stays a "coming soon" label.
 *
 * Every function is pure over the validated configuration, so an empty or partial configuration
 * can never produce a document that names a wrong or placeholder app.
 */

export type AppLinkEnv = Pick<
  WebEnv,
  'APPLE_TEAM_ID' | 'APPLE_APP_STORE_ID' | 'ANDROID_CERT_SHA256_FINGERPRINTS'
>;

export interface AppleAppSiteAssociation {
  readonly applinks: {
    readonly details: readonly {
      readonly appIDs: readonly string[];
      readonly components: readonly { readonly '/': string }[];
    }[];
  };
}

export interface AssetLinkStatement {
  readonly relation: readonly string[];
  readonly target: {
    readonly namespace: 'android_app';
    readonly package_name: string;
    readonly sha256_cert_fingerprints: readonly string[];
  };
}

/** The association file, or `null` when no Apple Team ID is configured. */
export function appleAppSiteAssociation(env: AppLinkEnv): AppleAppSiteAssociation | null {
  if (env.APPLE_TEAM_ID === undefined) {
    return null;
  }
  return {
    applinks: {
      details: [
        {
          appIDs: [`${env.APPLE_TEAM_ID}.${MOBILE_APP_IDS.iosBundleId}`],
          components: APP_LINK_PATH_PATTERNS.map((pattern) => ({ '/': pattern })),
        },
      ],
    },
  };
}

/** The Digital Asset Links statements, or `null` when no fingerprint is configured. */
export function assetLinks(env: AppLinkEnv): AssetLinkStatement[] | null {
  const fingerprints = env.ANDROID_CERT_SHA256_FINGERPRINTS ?? [];
  if (fingerprints.length === 0) {
    return null;
  }
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: MOBILE_APP_IDS.androidPackage,
        sha256_cert_fingerprints: [...fingerprints],
      },
    },
  ];
}

/** App Store listing of a numeric app id. */
export function appStoreUrl(appStoreId: string): string {
  return `https://apps.apple.com/tr/app/id${appStoreId}`;
}

/** Google Play listing of an application id. */
export function googlePlayUrl(packageName: string): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;
}

/** Store entries with a listing link only where configuration names one. */
export function configuredStoreEntries(env: AppLinkEnv): StoreEntry[] {
  const playConfigured = (env.ANDROID_CERT_SHA256_FINGERPRINTS ?? []).length > 0;
  return [
    {
      store: 'appStore',
      label: 'App Store',
      href: env.APPLE_APP_STORE_ID === undefined ? null : appStoreUrl(env.APPLE_APP_STORE_ID),
    },
    {
      store: 'googlePlay',
      label: 'Google Play',
      href: playConfigured ? googlePlayUrl(MOBILE_APP_IDS.androidPackage) : null,
    },
  ];
}

/** JSON body for a `.well-known` document: no redirect, no HTML, cacheable for an hour. */
export function wellKnownJson(document: unknown): Response {
  if (document === null) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(JSON.stringify(document), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
