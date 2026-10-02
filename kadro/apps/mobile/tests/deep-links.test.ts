import { describe, expect, it } from 'vitest';

import {
  androidIntentFilters,
  associatedDomainsFor,
  universalLinkHost,
  updatesConfig,
} from '../app.config';

describe('universalLinkHost', () => {
  it('derives the host from an https web origin', () => {
    expect(universalLinkHost('https://kadro.app')).toBe('kadro.app');
    expect(universalLinkHost('https://www.kadro.app/')).toBe('www.kadro.app');
  });

  it('returns null without an origin or for non-https, credentialed or pathful origins', () => {
    expect(universalLinkHost(undefined)).toBeNull();
    expect(universalLinkHost('')).toBeNull();
    expect(universalLinkHost('http://kadro.app')).toBeNull();
    expect(universalLinkHost('https://user:pw@kadro.app')).toBeNull();
    expect(universalLinkHost('https://kadro.app/path')).toBeNull();
    expect(universalLinkHost('not a url')).toBeNull();
  });
});

describe('associatedDomainsFor', () => {
  it('maps the host to an applinks entry and omits it without a host', () => {
    expect(associatedDomainsFor('kadro.app')).toEqual(['applinks:kadro.app']);
    expect(associatedDomainsFor(null)).toBeUndefined();
  });
});

describe('androidIntentFilters', () => {
  it('always handles the kadro scheme', () => {
    expect(androidIntentFilters(null)).toEqual([
      { action: 'VIEW', category: ['BROWSABLE', 'DEFAULT'], data: [{ scheme: 'kadro' }] },
    ]);
  });

  it('adds a verified https filter for the invite, venue and auth link paths', () => {
    const filters = androidIntentFilters('kadro.app');
    expect(filters).toHaveLength(2);
    expect(filters[1]).toEqual({
      action: 'VIEW',
      autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: ['/mac', '/saha', '/eksik-var', '/e-posta-dogrula', '/sifre-sifirla'].map(
        (pathPrefix) => ({ scheme: 'https', host: 'kadro.app', pathPrefix }),
      ),
    });
  });
});

describe('updatesConfig', () => {
  it('adds no block without a certificate path', () => {
    expect(updatesConfig(undefined)).toBeUndefined();
  });

  it('prepares code signing metadata when a certificate path is given', () => {
    expect(updatesConfig('./certs/certificate.pem')).toEqual({
      codeSigningCertificate: './certs/certificate.pem',
      codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
    });
  });
});
