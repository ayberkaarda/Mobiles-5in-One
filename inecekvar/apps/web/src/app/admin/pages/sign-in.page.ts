import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { adminErrorMessage } from '../admin-errors';
import { AdminSession } from '../admin-session';
import { HOME_PATH } from '../guards';

export const EMAIL_MAX = 320;
export const PASSWORD_MAX = 1024;

const NOTICES = {
  expired: 'Oturumun sona erdi. Devam etmek için yeniden giriş yap.',
  'signed-out': 'Çıkış yaptın. Bu cihazda yönetim verisi tutulmaz.',
  'not-staff': 'Bu hesabın moderatör ya da yönetici rolü yok; yönetim paneli açılmadı.',
} as const;

/**
 * Password sign-in through the shared API auth (cookie session plus CSRF). The magic link is
 * not offered here: staff sign in with a password and then prove a TOTP code for risky actions.
 */
@Component({
  selector: 'iv-admin-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="iv-admin-card signin">
      <h1>Yönetim girişi</h1>
      <p class="iv-admin-muted">
        Moderatör ve yönetici hesapları içindir. Yetkiler sunucuda denetlenir; bu sayfa yalnızca
        şifreyle giriş sunar.
      </p>
      @if (notice(); as text) {
        <p class="iv-admin-banner" role="status" data-notice="sign-in">{{ text }}</p>
      }
      <form (submit)="$event.preventDefault(); submit(email.value, password.value)" novalidate>
        <label for="iv-admin-email">E-posta</label>
        <input
          #email
          id="iv-admin-email"
          type="email"
          autocomplete="username"
          required
          [attr.maxlength]="emailMax"
          [disabled]="pending()"
        />
        <label for="iv-admin-password">Şifre</label>
        <input
          #password
          id="iv-admin-password"
          type="password"
          autocomplete="current-password"
          required
          [attr.maxlength]="passwordMax"
          [disabled]="pending()"
        />
        @if (error(); as message) {
          <p class="iv-admin-error" role="alert">{{ message }}</p>
        }
        <div class="iv-admin-actions">
          <button type="submit" [disabled]="pending()">
            {{ pending() ? 'Giriş yapılıyor…' : 'Giriş yap' }}
          </button>
        </div>
      </form>
    </section>
  `,
  styles: `
    .signin button[type='submit'] {
      background: var(--iv-accent);
      color: var(--iv-accent-ink);
      border-color: var(--iv-accent);
    }
    .signin {
      max-width: 26rem;
      margin: 2rem auto;
    }
  `,
})
export class SignInPage {
  private readonly session = inject(AdminSession);
  private readonly router = inject(Router);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly emailMax = EMAIL_MAX;
  protected readonly passwordMax = PASSWORD_MAX;

  protected notice(): string | null {
    const notice = this.session.notice();
    return notice === null ? null : NOTICES[notice];
  }

  async submit(email: string, password: string): Promise<void> {
    if (this.pending()) return;
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(address) || address.length > EMAIL_MAX) {
      this.error.set('Geçerli bir e-posta adresi gir.');
      return;
    }
    if (password.length === 0 || password.length > PASSWORD_MAX) {
      this.error.set('Şifreni gir.');
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    try {
      const outcome = await this.session.signIn(address, password);
      if (outcome === 'staff') await this.router.navigateByUrl(HOME_PATH);
    } catch (error) {
      this.error.set(adminErrorMessage(error, 'sign-in'));
    } finally {
      this.pending.set(false);
    }
  }
}
