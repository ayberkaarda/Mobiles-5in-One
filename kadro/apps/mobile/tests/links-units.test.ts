import { describe, expect, it } from 'vitest';

import { parseDeepLink } from '../../../packages/contracts/src/deep-links';
import { districtFromLink } from '../src/links/district';
import {
  allowedLinkOrigins,
  isSlug,
  parseLink,
  pendingLinkStep,
  routeIncomingLink,
  type SessionLinkTarget,
  sessionLinkHref,
} from '../src/links/deep-links';
import { createPendingLinkStore } from '../src/links/pending';

const ORIGIN = 'https://kadro.app';
const CODE = 'abcdefghijklmnopqrstuv';
// Opaque email-link token built from plain words at run time (43 base64url characters).
const TOKEN = 'link-token-'.padEnd(43, 'x');
const DISTRICT_A = '0192a0b0-0000-7000-8000-0000000000d1';

/** Links run through both the app parser and the contracts parser. */
const CORPUS = [
  `kadro://mac/${CODE}`,
  `kadro://mac/${CODE}/`,
  `kadro://mac/${CODE}?ref=share`,
  `${ORIGIN}/mac/${CODE}`,
  `/mac/${CODE}`,
  'kadro://mac/short',
  `kadro://mac/${CODE}/extra`,
  `kadro://match/${CODE}`,
  'kadro://saha/moda-hali-saha-kadikoy',
  `${ORIGIN}/saha/moda-hali-saha-kadikoy`,
  'kadro://saha/Moda',
  'kadro://saha/a--b',
  'kadro://saha/',
  'kadro://eksik-var/istanbul/kadikoy',
  `${ORIGIN}/eksik-var/istanbul/kadikoy`,
  'kadro://eksik-var/istanbul',
  'kadro://eksik-var/istanbul/kadikoy/extra',
  `kadro://e-posta-dogrula#token=${TOKEN}`,
  `${ORIGIN}/e-posta-dogrula#token=${TOKEN}`,
  `${ORIGIN}/sifre-sifirla#token=${TOKEN}`,
  `kadro://sifre-sifirla#token=${TOKEN}&token=${TOKEN}`,
  `kadro://sifre-sifirla?token=${TOKEN}`,
  'kadro://sifre-sifirla#token=short',
  `https://evil.example/mac/${CODE}`,
  `${ORIGIN}.evil.example/mac/${CODE}`,
  `http://kadro.app/mac/${CODE}`,
  'kadro://',
  '',
];

describe('parseLink', () => {
  it('gives the same result as the contracts parser for every link', () => {
    for (const link of CORPUS) {
      expect(parseLink(link, [ORIGIN]), link).toEqual(parseDeepLink(link, [ORIGIN]));
    }
  });

  it('recognizes each target of ADR-0045', () => {
    expect(parseLink(`kadro://mac/${CODE}`)).toEqual({ kind: 'teamInvite', code: CODE });
    expect(parseLink('kadro://saha/moda-kadikoy')).toEqual({ kind: 'venue', slug: 'moda-kadikoy' });
    expect(parseLink('kadro://eksik-var/istanbul/kadikoy')).toEqual({
      kind: 'openCalls',
      provinceSlug: 'istanbul',
      districtSlug: 'kadikoy',
    });
    expect(parseLink(`kadro://e-posta-dogrula#token=${TOKEN}`)).toEqual({
      kind: 'verifyEmail',
      token: TOKEN,
    });
    expect(parseLink(`kadro://sifre-sifirla#token=${TOKEN}`)).toEqual({
      kind: 'resetPassword',
      token: TOKEN,
    });
  });

  it('accepts https links only on an allowed origin', () => {
    expect(parseLink(`${ORIGIN}/mac/${CODE}`)).toBeNull();
    expect(parseLink(`${ORIGIN}/mac/${CODE}`, [ORIGIN])).toEqual({
      kind: 'teamInvite',
      code: CODE,
    });
  });

  it('checks slugs like the contracts', () => {
    expect(isSlug('moda-kadikoy')).toBe(true);
    expect(isSlug('Moda')).toBe(false);
    expect(isSlug('a--b')).toBe(false);
    expect(isSlug('')).toBe(false);
    expect(isSlug('a'.repeat(81))).toBe(false);
  });
});

describe('allowedLinkOrigins', () => {
  it('keeps a bare https origin and drops anything else', () => {
    expect(allowedLinkOrigins('https://kadro.app')).toEqual(['https://kadro.app']);
    expect(allowedLinkOrigins('https://kadro.app/')).toEqual(['https://kadro.app']);
    expect(allowedLinkOrigins(undefined)).toEqual([]);
    expect(allowedLinkOrigins('http://kadro.app')).toEqual([]);
    expect(allowedLinkOrigins('https://kadro.app/path')).toEqual([]);
  });
});

describe('routeIncomingLink', () => {
  it('opens an invite and holds it when the user is not signed in', () => {
    const invite = { kind: 'teamInvite', code: CODE };
    expect(routeIncomingLink(`kadro://mac/${CODE}`, 'signedOut', [])).toEqual({
      path: `/mac/${CODE}`,
      pending: invite,
    });
    expect(routeIncomingLink(`${ORIGIN}/mac/${CODE}`, 'unknown', [ORIGIN])).toEqual({
      path: `/mac/${CODE}`,
      pending: invite,
    });
    expect(routeIncomingLink(`kadro://mac/${CODE}`, 'signedIn', [])).toEqual({
      path: `/mac/${CODE}`,
      pending: null,
    });
  });

  it('opens a venue and a district link on their routes', () => {
    expect(routeIncomingLink('kadro://saha/moda-kadikoy', 'signedIn', []).path).toBe(
      '/saha/moda-kadikoy',
    );
    expect(routeIncomingLink('kadro://eksik-var/istanbul/kadikoy', 'signedIn', []).path).toBe(
      '/eksik-var?il=istanbul&ilce=kadikoy',
    );
  });

  it('leaves email links and malformed links of the five paths to their screens', () => {
    for (const link of [
      `kadro://sifre-sifirla#token=${TOKEN}`,
      `kadro://e-posta-dogrula?token=${TOKEN}`,
      'kadro://mac/short',
      'kadro://saha/Moda',
    ]) {
      expect(routeIncomingLink(link, 'signedOut', []), link).toEqual({ path: null, pending: null });
    }
  });

  it('opens the home screen for an unknown path of the app, such as the spec spelling match/', () => {
    expect(routeIncomingLink(`kadro://match/${CODE}`, 'signedIn', [])).toEqual({
      path: '/',
      pending: null,
    });
    expect(routeIncomingLink(`${ORIGIN}/blog/yazi`, 'signedIn', [ORIGIN]).path).toBe('/');
  });

  it('does not touch links of other schemes or origins', () => {
    for (const link of [
      'exp+kadro://expo-development-client/?url=x',
      `https://evil.example/mac/${CODE}`,
      'app.kadro.mobile:/oauthredirect',
    ]) {
      expect(routeIncomingLink(link, 'signedOut', [ORIGIN]), link).toEqual({
        path: null,
        pending: null,
      });
    }
  });
});

describe('pendingLinkStep', () => {
  const invite: SessionLinkTarget = { kind: 'teamInvite', code: CODE };
  const calls: SessionLinkTarget = {
    kind: 'openCalls',
    provinceSlug: 'istanbul',
    districtSlug: 'kadikoy',
  };

  it('waits until the user is signed in', () => {
    expect(pendingLinkStep('signedOut', invite, '/')).toEqual({ action: 'wait' });
    expect(pendingLinkStep('unknown', invite, '/')).toEqual({ action: 'wait' });
    expect(pendingLinkStep('signedIn', null, '/maclar')).toEqual({ action: 'wait' });
  });

  it('opens the held link after sign-in', () => {
    expect(pendingLinkStep('signedIn', invite, '/maclar')).toEqual({
      action: 'open',
      href: `/mac/${CODE}`,
    });
    expect(pendingLinkStep('signedIn', calls, '/maclar')).toEqual({
      action: 'open',
      href: sessionLinkHref(calls),
    });
  });

  it('only drops the link when the router already shows it', () => {
    expect(pendingLinkStep('signedIn', invite, `/mac/${CODE}`)).toEqual({ action: 'clear' });
    // The tab path alone does not carry the district, so the link is opened again.
    expect(pendingLinkStep('signedIn', calls, '/eksik-var').action).toBe('open');
  });
});

describe('pending link store', () => {
  it('starts empty and keeps only the latest link, in memory', () => {
    const store = createPendingLinkStore();
    expect(store.getState().target).toBeNull();
    store.setState({ target: { kind: 'teamInvite', code: CODE } });
    store.setState({ target: { kind: 'venue', slug: 'moda-kadikoy' } });
    expect(store.getState().target).toEqual({ kind: 'venue', slug: 'moda-kadikoy' });
  });
});

describe('districtFromLink', () => {
  const districts = [{ id: DISTRICT_A, provinceSlug: 'istanbul', slug: 'kadikoy' }];

  it('finds the district by province and district slug', () => {
    expect(districtFromLink('istanbul', 'kadikoy', districts)).toEqual({
      key: 'istanbul/kadikoy',
      districtId: DISTRICT_A,
    });
    expect(districtFromLink('ankara', 'kadikoy', districts)).toEqual({
      key: 'ankara/kadikoy',
      districtId: null,
    });
  });

  it('waits for the list and ignores missing or malformed parameters', () => {
    expect(districtFromLink('istanbul', 'kadikoy', undefined)).toBeNull();
    expect(districtFromLink(undefined, 'kadikoy', districts)).toBeNull();
    expect(districtFromLink('Istanbul', 'kadikoy', districts)).toBeNull();
    expect(districtFromLink(['istanbul'], 'kadikoy', districts)).toBeNull();
  });
});
