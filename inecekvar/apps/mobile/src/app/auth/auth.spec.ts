import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { ApiError, SessionStore } from '@inecekvar/data-access';
import { FakeSession } from '../testing/catalog.fixtures';
import {
  authFailure,
  displayNameError,
  emailError,
  loginPasswordIssue,
  passwordIssues,
  safeNext,
} from './auth-form';
import { signedInGuard } from './auth.guard';
import { LicenceGate } from './licence-gate';

const problem = (status: number, code: string, retry: number | null = null) =>
  new ApiError(status === 429 ? 'rate_limited' : 'problem', status, code, 'req', null, retry);

describe('auth validators (mirroring the API bounds)', () => {
  it('checks the email address', () => {
    expect(emailError('')).toBe('required');
    expect(emailError('   ')).toBe('required');
    expect(emailError('deniz')).toBe('invalid');
    expect(emailError('deniz@ornek')).toBe('invalid');
    expect(emailError(' deniz@ornek.test ')).toBeNull();
    expect(emailError(`${'a'.repeat(310)}@ornek.test`)).toBe('too-long');
  });

  it('applies the registration password policy: 10 to 128 characters, not the address', () => {
    expect(passwordIssues('', 'a@b.co')).toEqual(['required']);
    expect(passwordIssues('kısa', 'a@b.co')).toEqual(['short']);
    expect(passwordIssues('x'.repeat(129), 'a@b.co')).toEqual(['long']);
    expect(passwordIssues('dolmus-durak-42', 'a@b.co')).toEqual([]);
    expect(passwordIssues('deniz.kaya@ornek.test', 'Deniz.Kaya@ornek.test')).toEqual([
      'same-as-email',
    ]);
    expect(passwordIssues('denizkaya1', 'denizkaya1@ornek.test')).toEqual(['same-as-email']);
    // Counted as the server counts: NFC code points (a decomposed "ş" is one character).
    expect(passwordIssues('ş'.repeat(10), 'a@b.co')).toEqual([]);
  });

  it('only requires a bounded password to sign in', () => {
    expect(loginPasswordIssue('')).toBe('required');
    expect(loginPasswordIssue('kisa')).toBeNull();
    expect(loginPasswordIssue('x'.repeat(1025))).toBe('long');
  });

  it('accepts an empty display name and refuses long or control characters', () => {
    expect(displayNameError('')).toBeNull();
    expect(displayNameError('Deniz')).toBeNull();
    expect(displayNameError('x'.repeat(61))).toBe('invalid');
    expect(displayNameError('De\u0007niz')).toBe('invalid');
  });
});

describe('auth error mapping', () => {
  it('gives the same message for every failed sign-in', () => {
    for (const error of [
      problem(401, 'auth.invalid_credentials'),
      problem(403, 'auth.forbidden'),
      problem(404, 'user.not_found'),
      problem(422, 'validation.failed'),
    ]) {
      expect(authFailure(error, 'login').key).toBe('auth.errors.credentials');
    }
  });

  it('turns a 429 into a countdown and keeps policy and link answers specific', () => {
    expect(authFailure(problem(429, 'rate_limited', 900), 'login')).toEqual({
      key: 'auth.errors.rateLimited',
      retryAfter: 900,
    });
    expect(authFailure(problem(422, 'auth.weak_password'), 'register').key).toBe(
      'auth.errors.weakPassword',
    );
    expect(authFailure(problem(401, 'auth.token_invalid'), 'verify').key).toBe(
      'auth.errors.tokenInvalid',
    );
    expect(authFailure(problem(401, 'auth.invalid_credentials'), 'verify').key).toBe(
      'auth.errors.verifyPassword',
    );
    expect(authFailure(new ApiError('network', 0, 'network', 'r'), 'link').key).toBe(
      'auth.errors.offline',
    );
    expect(authFailure(new Error('boom'), 'register').key).toBe('auth.errors.generic');
  });

  it('only follows same-app paths after sign-in', () => {
    expect(safeNext('/katki/kayit')).toBe('/katki/kayit');
    expect(safeNext('/katki/oneri?tur=new_line')).toBe('/katki/oneri?tur=new_line');
    for (const bad of [
      null,
      '',
      'https://evil.example',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      '/giris',
      '/giris/baglanti',
      '/' + 'x'.repeat(400),
    ]) {
      expect(safeNext(bad)).toBe('/katki');
    }
  });
});

describe('signedInGuard (UX only)', () => {
  function run(session: { status: () => string }, url = '/katki/kayit') {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SessionStore, useValue: session }],
    });
    return TestBed.runInInjectionContext(() => signedInGuard({} as never, { url } as never)) as
      boolean | UrlTree;
  }

  it('sends guests to /giris with the page to return to', () => {
    const result = run({ status: () => 'anonymous' });
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/giris?sonra=%2Fkatki%2Fkayit',
    );
  });

  it('lets signed-in users and an undecided session through', () => {
    expect(run({ status: () => 'signed-in' })).toBe(true);
    TestBed.resetTestingModule();
    expect(run({ status: () => 'unknown' })).toBe(true);
  });
});

describe('LicenceGate', () => {
  function gate(licence: boolean) {
    const session = new FakeSession();
    session.signIn('user-a', licence);
    TestBed.configureTestingModule({ providers: [{ provide: SessionStore, useValue: session }] });
    return { gate: TestBed.inject(LicenceGate), session };
  }

  it('passes at once when the licence is already accepted', async () => {
    const { gate: g } = gate(true);
    expect(await g.ensure()).toBe(true);
    expect(g.open()).toBe(false);
  });

  it('asks, records the acceptance and lets every waiting caller through', async () => {
    const { gate: g, session } = gate(false);
    const first = g.ensure();
    const second = g.ensure();
    expect(g.open()).toBe(true);
    await g.accept();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(session.acceptLicence.calls).toHaveLength(1);
    expect(g.open()).toBe(false);
  });

  it('stays open with a message when the acceptance cannot be saved, and can be declined', async () => {
    const { gate: g, session } = gate(false);
    session.acceptLicence.impl = async () => {
      throw new ApiError('network', 0, 'network', 'r');
    };
    const waiting = g.ensure();
    await g.accept();
    expect(g.open()).toBe(true);
    expect(g.error()).toBe('licence.offline');
    g.decline();
    expect(await waiting).toBe(false);
  });
});
