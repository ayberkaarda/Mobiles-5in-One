import { APP_LINK_PATH_PATTERNS } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import {
  appleAppSiteAssociation,
  assetLinks,
  configuredStoreEntries,
  wellKnownJson,
} from '../../lib/server/app-links';
import { surfaceFor } from '../../lib/server/security-headers';
import { testEnv } from '../support/env';

/** Verified app link documents and store entries from configuration (ADR-0045, ADR-0058). */

/** A fingerprint in Play Console notation, built at run time (`AA:AA:…`, 32 pairs). */
function fingerprint(pair: string): string {
  return Array.from({ length: 32 }, () => pair).join(':');
}

const TEAM_ID = 'ABCDE12345';
const STORE_ID = '1234567890';

describe('apple-app-site-association', () => {
  it('is absent without an Apple Team ID', () => {
    expect(appleAppSiteAssociation(testEnv())).toBeNull();
    // An empty value (`APPLE_TEAM_ID=`) counts as unset.
    expect(appleAppSiteAssociation(testEnv({ APPLE_TEAM_ID: '' }))).toBeNull();
  });

  it('rejects a placeholder Team ID at configuration time', () => {
    expect(() => testEnv({ APPLE_TEAM_ID: 'TEAMID' })).toThrow(/APPLE_TEAM_ID/);
  });

  it('names the bundle id under the team and every app link path', () => {
    const document = appleAppSiteAssociation(testEnv({ APPLE_TEAM_ID: TEAM_ID }));
    expect(document).toEqual({
      applinks: {
        details: [
          {
            appIDs: [`${TEAM_ID}.app.kadro.mobile`],
            components: [
              { '/': '/mac/*' },
              { '/': '/saha/*' },
              { '/': '/eksik-var/*' },
              { '/': '/e-posta-dogrula' },
              { '/': '/sifre-sifirla' },
            ],
          },
        ],
      },
    });
    expect(document?.applinks.details[0]?.components.map((c) => c['/'])).toEqual([
      ...APP_LINK_PATH_PATTERNS,
    ]);
  });
});

describe('assetlinks.json', () => {
  it('is absent without fingerprints, also for a list of empty entries', () => {
    expect(assetLinks(testEnv())).toBeNull();
    expect(assetLinks(testEnv({ ANDROID_CERT_SHA256_FINGERPRINTS: ' , ' }))).toBeNull();
  });

  it('rejects a malformed fingerprint at configuration time', () => {
    expect(() => testEnv({ ANDROID_CERT_SHA256_FINGERPRINTS: 'not-a-fingerprint' })).toThrow(
      /ANDROID_CERT_SHA256_FINGERPRINTS/,
    );
  });

  it('lists the package and every configured fingerprint', () => {
    const env = testEnv({
      ANDROID_CERT_SHA256_FINGERPRINTS: `${fingerprint('AB')}, ${fingerprint('0C')}`,
    });
    expect(assetLinks(env)).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.kadro.mobile',
          sha256_cert_fingerprints: [fingerprint('AB'), fingerprint('0C')],
        },
      },
    ]);
  });
});

describe('store entries', () => {
  it('are labels without links while nothing is configured', () => {
    expect(configuredStoreEntries(testEnv()).map((entry) => entry.href)).toEqual([null, null]);
  });

  it('link to the configured listings only', () => {
    const appStoreOnly = configuredStoreEntries(testEnv({ APPLE_APP_STORE_ID: STORE_ID }));
    expect(appStoreOnly.map((entry) => entry.href)).toEqual([
      `https://apps.apple.com/tr/app/id${STORE_ID}`,
      null,
    ]);
    const both = configuredStoreEntries(
      testEnv({
        APPLE_APP_STORE_ID: STORE_ID,
        ANDROID_CERT_SHA256_FINGERPRINTS: fingerprint('AB'),
      }),
    );
    expect(both.map((entry) => entry.href)).toEqual([
      `https://apps.apple.com/tr/app/id${STORE_ID}`,
      'https://play.google.com/store/apps/details?id=app.kadro.mobile',
    ]);
  });
});

describe('.well-known responses', () => {
  it('serve a document as application/json and a missing one as a plain 404', async () => {
    const found = wellKnownJson({ ok: true });
    expect(found.status).toBe(200);
    expect(found.headers.get('content-type')).toBe('application/json');
    expect(await found.json()).toEqual({ ok: true });
    const missing = wellKnownJson(null);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
  });
});

describe('invite landing surface (ADR-0034, ADR-0058)', () => {
  it('serves /mac/<code> with noindex, no-referrer and no-store from the proxy', () => {
    const surface = surfaceFor('/mac/AbCdEf123');
    expect(surface.name).toBe('invite-page');
    expect(surface.noindex).toBe(true);
    expect(surface.referrerPolicy).toBe('no-referrer');
    expect(surface.cacheControl).toBe('no-store');
  });
});
