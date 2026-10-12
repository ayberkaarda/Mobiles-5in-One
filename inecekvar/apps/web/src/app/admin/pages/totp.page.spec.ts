import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiError } from '@inecekvar/data-access';
import { AdminApi, type TotpStatus } from '../admin-api';
import { AdminSession } from '../admin-session';
import { groupSecret, isTotpUri, TotpPage } from './totp.page';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/%C4%B0necek%20Var:mod%40example.com?secret=${SECRET}&issuer=%C4%B0necek%20Var`;
const disabled: TotpStatus = { enabled: false, enabled_at: null, pending: false };

async function render(api: Partial<Record<keyof AdminApi, unknown>>) {
  const totp = signal<TotpStatus | null>(null);
  TestBed.configureTestingModule({
    providers: [
      { provide: AdminApi, useValue: { totpStatus: vi.fn(async () => disabled), ...api } },
      {
        provide: AdminSession,
        useValue: { totp, setTotp: (value: TotpStatus) => totp.set(value) },
      },
    ],
  });
  const fixture = TestBed.createComponent(TotpPage);
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const click = async (selector: string) => {
    (element.querySelector(selector) as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };
  return { fixture, element, click };
}

afterEach(() => TestBed.resetTestingModule());

describe('TotpPage', () => {
  it('draws the QR locally, shows the secret once and confirms a code', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const confirmTotp = vi.fn(async () => ({
      enabled: true,
      enabled_at: '2026-10-12T08:00:00Z',
      pending: false,
    }));
    const { element, click, fixture } = await render({
      enrolTotp: vi.fn(async () => ({ secret: SECRET, otpauth_uri: URI })),
      confirmTotp,
    });
    await click('[data-totp="disabled"] button');
    const qr = element.querySelector('svg.qr path') as SVGPathElement;
    expect(qr.getAttribute('d')).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('[data-totp="secret"]')?.textContent).toBe(groupSecret(SECRET));
    const code = element.querySelector('#iv-totp-code') as HTMLInputElement;
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code.getAttribute('inputmode')).toBe('numeric');

    code.value = '12345';
    await click('[data-totp="enrolling"] button[type="submit"]');
    expect(confirmTotp).not.toHaveBeenCalled();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('6 rakam');

    code.value = '123456';
    await click('[data-totp="enrolling"] button[type="submit"]');
    fixture.detectChanges();
    expect(confirmTotp).toHaveBeenCalledExactlyOnceWith('123456');
    expect(element.querySelector('[data-totp="enabled"]')).not.toBeNull();
    expect(element.textContent).not.toContain(SECRET.slice(0, 8));
    expect(setItem).not.toHaveBeenCalled();
  });

  it('asks for a fresh sign-in when the session is too old to enrol', async () => {
    const { element, click } = await render({
      enrolTotp: vi
        .fn()
        .mockRejectedValue(new ApiError('problem', 403, 'auth.reauth_required', 'r')),
    });
    await click('[data-totp="disabled"] button');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('son 10 dakika');
  });

  it('refuses to draw anything that is not an otpauth TOTP URI', () => {
    expect(isTotpUri(URI)).toBe(true);
    expect(isTotpUri('https://evil.example/qr?data=x')).toBe(false);
    expect(isTotpUri('otpauth://hotp/x')).toBe(false);
    expect(isTotpUri('otpauth://totp/' + 'x'.repeat(600))).toBe(false);
  });
});
