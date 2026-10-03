import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ContextType, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EnrollTotp } from '../../components/admin/enroll-totp';
import { QrCode } from '../../components/admin/qr-code';
import { AdminSignInForm } from '../../components/admin/sign-in-form';
import { StepUpForm } from '../../components/admin/step-up-form';
import { UserActions } from '../../components/admin/user-actions';
import { VenueVerifyButton } from '../../components/admin/venue-actions';
import { VenueImportForm } from '../../components/admin/venue-import-form';
import { encodeQr } from '../../lib/admin/qr';

/**
 * Server render of the staff panel components (initial state): labels, accessible names, submit
 * buttons that stay disabled until hydration, and the QR code as inline SVG elements.
 */

type Router = NonNullable<ContextType<typeof AppRouterContext>>;
const router = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  hmrRefresh: () => undefined,
} as unknown as Router;

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>,
  );
}

const CSRF = '__Host-kadro_csrf';
const ID = '0192a5e4-7b3c-7d2e-8f10-123456789abc';

describe('staff panel components', () => {
  it('draws the QR code as an SVG path with a quiet zone and an accessible name', () => {
    const value = 'otpauth://totp/Kadro:ayse%40kadro.app?secret=JBSWY3DPEHPK3PXP&issuer=Kadro';
    const html = render(<QrCode value={value} label="QR kodu" />);
    const size = encodeQr(value).size + 8;
    expect(html).toMatch(/^<svg /);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="QR kodu"');
    expect(html).toContain(`viewBox="0 0 ${size} ${size}"`);
    const path = /<path d="([^"]*)" fill="#000000"><\/path>/.exec(html)?.[1] ?? '';
    const squares = path.split('z').slice(0, -1);
    expect(squares.length).toBeGreaterThan(0);
    expect(squares.every((square) => /^M\d{1,3} \d{1,3}h1v1h-1$/.test(square))).toBe(true);
    expect(html).not.toContain(value);
    expect(html).not.toMatch(/<script|<image|href=/);
  });

  it('renders sign-in with labelled fields and a button disabled until hydration', () => {
    const html = render(<AdminSignInForm csrfCookieName={CSRF} />);
    expect(html).toContain('<label class="');
    expect(html).toMatch(/for="email"/);
    expect(html).toMatch(/autoComplete="username"|autocomplete="username"/);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Giriş yap<\/button>/);
    expect(html).toMatch(/role="status" aria-live="polite"/);
  });

  it('renders the step-up form with a one-time-code input and the enrollment link', () => {
    const html = render(<StepUpForm csrfCookieName={CSRF} />);
    expect(html).toMatch(/autoComplete="one-time-code"|autocomplete="one-time-code"/);
    expect(html).toMatch(/inputMode="numeric"|inputmode="numeric"/);
    expect(html).toContain('href="/admin/totp-kurulum"');
  });

  it('starts enrollment with the password proof and shows no secret yet', () => {
    const html = render(<EnrollTotp csrfCookieName={CSRF} />);
    expect(html).toContain('Kurulumu başlat');
    expect(html).toMatch(/type="password"/);
    expect(html).not.toContain('<svg');
  });

  it('names the venue in the verify button and offers role and ban changes', () => {
    const venue = render(
      <VenueVerifyButton
        venueId={ID}
        venueName="Ege Arena"
        verified={false}
        csrfCookieName={CSRF}
      />,
    );
    expect(venue).toContain('aria-label="Ege Arena: onayla"');
    const user = render(
      <UserActions
        userId={ID}
        displayName="Ayşe"
        role="user"
        deactivated={false}
        csrfCookieName={CSRF}
      />,
    );
    expect(user).toContain('Rolü değiştir');
    expect(user).toContain('Engelle');
    expect(user).toMatch(/<option value="moderator">Moderatör<\/option>/);
  });

  it('starts the import form as a dry run', () => {
    const html = render(<VenueImportForm csrfCookieName={CSRF} />);
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toContain('accept=".csv,text/csv"');
    expect(html).toContain('Dosyayı doğrula');
  });
});
