import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ApiError } from '@inecekvar/data-access';
import { AdminSession, type SignInNotice } from '../admin-session';
import { SignInPage } from './sign-in.page';

function render(signIn = vi.fn(async () => 'staff' as const), notice: SignInNotice = null) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AdminSession, useValue: { signIn, notice: signal(notice) } },
    ],
  });
  const fixture = TestBed.createComponent(SignInPage);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const fill = (email: string, password: string) => {
    (element.querySelector('#iv-admin-email') as HTMLInputElement).value = email;
    (element.querySelector('#iv-admin-password') as HTMLInputElement).value = password;
  };
  const submit = async () => {
    (element.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  };
  return { fixture, element, fill, submit, signIn };
}

afterEach(() => TestBed.resetTestingModule());

describe('SignInPage', () => {
  it('validates the form before calling the API', async () => {
    const { element, fill, submit, signIn } = render();
    fill('not-an-email', 'secret');
    await submit();
    expect(signIn).not.toHaveBeenCalled();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Geçerli bir e-posta');
    fill('mod@example.com', '');
    await submit();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs in staff and opens the queue', async () => {
    const { fill, submit, signIn } = render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill(' mod@example.com ', 'dolmus-durak-2026!');
    await submit();
    expect(signIn).toHaveBeenCalledExactlyOnceWith('mod@example.com', 'dolmus-durak-2026!');
    expect(navigate).toHaveBeenCalledWith('/admin/kuyruk');
  });

  it('maps a wrong password to plain copy', async () => {
    const { element, fill, submit } = render(
      vi.fn().mockRejectedValue(new ApiError('problem', 401, 'auth.invalid_credentials', 'r')),
    );
    fill('mod@example.com', 'wrong');
    await submit();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'E-posta ya da şifre yanlış',
    );
  });

  it('explains an ended session', () => {
    const { element } = render(undefined, 'expired');
    expect(element.querySelector('[data-notice="sign-in"]')?.textContent).toContain(
      'Oturumun sona erdi',
    );
  });

  it('offers no magic-link sign-in and asks the browser for the password manager fields', () => {
    const { element } = render();
    expect(element.textContent).not.toContain('bağlantı gönder');
    expect(element.querySelector('#iv-admin-email')?.getAttribute('autocomplete')).toBe('username');
    expect(element.querySelector('#iv-admin-password')?.getAttribute('autocomplete')).toBe(
      'current-password',
    );
  });
});
