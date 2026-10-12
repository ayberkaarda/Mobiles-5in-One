import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  untracked,
  ViewEncapsulation,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AdminSession } from '../admin-session';
import { AdminDialogsComponent } from '../dialogs/dialogs.component';
import { ConfirmService } from '../dialogs/confirm.service';
import { SIGN_IN_PATH } from '../guards';
import { StepUpService } from '../step-up/step-up.service';
import { ROLE_LABELS } from '../admin-text';

/**
 * Frame of the client-only admin area: navigation by role (UX only), the dialogs, and the
 * reactions to an account change: dialogs close, stores reset and an ended session returns to
 * the sign-in page with a notice.
 */
@Component({
  selector: 'iv-admin-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AdminDialogsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'iv-admin', 'data-iv-admin': 'shell' },
  template: `
    <header class="iv-admin-bar">
      <a class="brand" routerLink="/admin/kuyruk">İnecek Var <span>Yönetim</span></a>
      @if (session.user(); as user) {
        <nav aria-label="Yönetim">
          <a routerLink="/admin/kuyruk" routerLinkActive="active">Kuyruk</a>
          <a routerLink="/admin/surumler" routerLinkActive="active">Sürümler</a>
          <a routerLink="/admin/dogrulama" routerLinkActive="active">Doğrulama</a>
          @if (session.isAdmin()) {
            <a routerLink="/admin/kullanicilar" routerLinkActive="active">Kullanıcılar</a>
            <a routerLink="/admin/disa-aktar" routerLinkActive="active">Dışa aktarım</a>
            <a routerLink="/admin/denetim" routerLinkActive="active">Denetim</a>
          }
        </nav>
        <div class="who">
          <span data-who="email">{{ user.email }}</span>
          <span class="role" data-who="role">{{ roleLabel(user.role) }}</span>
          <button type="button" class="secondary" (click)="signOut()">Çıkış</button>
        </div>
      }
    </header>
    @if (session.user() && session.totp()?.enabled === false) {
      <p class="iv-admin-banner" data-banner="totp">
        İki adımlı doğrulama kapalı. Geri alma, hat kaldırma ve yönetim işlemleri için
        <a routerLink="/admin/dogrulama">doğrulamayı kur</a>.
      </p>
    }
    @if (stepUp.verifiedUntil(); as until) {
      <p class="iv-admin-banner ok" data-banner="step-up">
        Doğrulandın; {{ until.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) }}
        saatine kadar ek kod istenmez.
      </p>
    }
    <main class="iv-admin-main">
      <router-outlet />
    </main>
    <iv-admin-dialogs />
  `,
  styles: `
    .iv-admin {
      display: block;
      min-height: 100vh;
      background: var(--iv-color-krem);
      color: var(--iv-color-lacivert);
    }
    .iv-admin-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      align-items: center;
      padding: 0.75rem 1rem;
      background: var(--iv-color-lacivert);
      color: var(--iv-color-krem);
    }
    .iv-admin-bar a {
      color: inherit;
    }
    .iv-admin-bar .brand {
      font-family: var(--iv-font-display);
      font-weight: 700;
      text-decoration: none;
      color: var(--iv-color-dolmus-sarisi);
    }
    .iv-admin-bar .brand span {
      color: var(--iv-color-krem);
      font-weight: 500;
    }
    .iv-admin-bar nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      flex: 1 1 auto;
    }
    .iv-admin-bar nav a {
      padding: 0.4rem 0.6rem;
      border-radius: 0.4rem;
      text-decoration: none;
      min-height: 24px;
    }
    .iv-admin-bar nav a.active {
      background: var(--iv-color-dolmus-sarisi);
      color: var(--iv-color-lacivert);
    }
    .iv-admin-bar .who {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.875rem;
      overflow-wrap: anywhere;
    }
    .iv-admin-bar .role {
      padding: 0.1rem 0.5rem;
      border: 1px solid currentColor;
      border-radius: 1rem;
    }
    .iv-admin-main {
      max-width: 72rem;
      margin: 0 auto;
      padding: 1rem;
    }
    .iv-admin-banner {
      margin: 0;
      padding: 0.6rem 1rem;
      background: #fde9a8;
      border-bottom: 1px solid var(--iv-color-dolmus-sarisi);
    }
    .iv-admin-banner.ok {
      background: #dff1e6;
      border-color: var(--iv-color-onay-yesili);
    }
    .iv-admin-banner a,
    .iv-admin-main a {
      color: var(--iv-color-lacivert);
      font-weight: 600;
    }
    .iv-admin h1 {
      font-size: 1.5rem;
      margin: 0.25rem 0 1rem;
    }
    .iv-admin h2 {
      font-size: 1.125rem;
      margin: 0 0 0.5rem;
    }
    .iv-admin button {
      font: inherit;
      font-weight: 600;
      min-height: 44px;
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      border: 2px solid var(--iv-color-lacivert);
      background: var(--iv-color-lacivert);
      color: var(--iv-color-krem);
      cursor: pointer;
    }
    .iv-admin button.secondary {
      background: transparent;
      color: inherit;
      border-color: currentColor;
    }
    .iv-admin button.danger {
      background: var(--iv-color-fren-kirmizisi);
      border-color: var(--iv-color-fren-kirmizisi);
      color: #fff;
    }
    .iv-admin button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .iv-admin label {
      display: block;
      font-weight: 600;
      margin: 0.5rem 0 0.25rem;
    }
    .iv-admin input,
    .iv-admin select,
    .iv-admin textarea {
      font: inherit;
      box-sizing: border-box;
      width: 100%;
      min-height: 44px;
      padding: 0.5rem;
      border: 1px solid var(--iv-color-yol-grisi);
      border-radius: 0.4rem;
      background: #fff;
      color: var(--iv-color-lacivert);
    }
    .iv-admin :focus-visible {
      outline: 3px solid var(--iv-color-turkuaz);
      outline-offset: 2px;
    }
    .iv-admin-card {
      background: #fff;
      border: 1px solid #e3dccb;
      border-radius: 0.75rem;
      padding: 1rem;
      margin: 0 0 1rem;
    }
    .iv-admin-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    .iv-admin-error {
      color: #a81c2e;
      font-weight: 600;
    }
    .iv-admin-ok {
      color: #1f6b41;
      font-weight: 600;
    }
    .iv-admin-muted {
      color: #555d65;
    }
    .iv-admin-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(20, 33, 61, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      z-index: 10;
    }
    .iv-admin-dialog {
      background: #fff;
      border-radius: 0.75rem;
      padding: 1.25rem;
      max-width: 28rem;
      width: 100%;
    }
    .iv-admin table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9375rem;
    }
    .iv-admin th,
    .iv-admin td {
      text-align: left;
      padding: 0.4rem;
      border-bottom: 1px solid #e3dccb;
      vertical-align: top;
    }
    .iv-admin code {
      overflow-wrap: anywhere;
    }
    /* Narrow screens: each row becomes a labelled block instead of squeezed columns. */
    @media (max-width: 40rem) {
      .iv-admin table.stack thead {
        display: none;
      }
      .iv-admin table.stack tr {
        display: block;
        padding: 0.5rem 0;
        border-bottom: 1px solid #e3dccb;
      }
      .iv-admin table.stack td {
        display: grid;
        grid-template-columns: 6.5rem 1fr;
        gap: 0.5rem;
        border: 0;
        padding: 0.2rem 0;
        overflow-wrap: anywhere;
      }
      .iv-admin table.stack td::before {
        content: attr(data-label);
        font-weight: 600;
      }
    }
    .iv-admin .scroll {
      overflow-x: auto;
    }
    .iv-admin .grid {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    }
    .iv-admin .text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
})
export class AdminShellComponent implements OnDestroy {
  protected readonly session = inject(AdminSession);
  protected readonly stepUp = inject(StepUpService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private robots: HTMLMetaElement | null;

  constructor() {
    this.robots = this.meta.addTag({ name: 'robots', content: 'noindex,nofollow' });
    this.title.setTitle('Yönetim | İnecek Var');
    effect(() => {
      this.session.user();
      untracked(() => this.session.track());
    });
    effect(() => {
      this.session.generation();
      untracked(() => {
        this.stepUp.reset();
        this.confirm.answer(false);
        if (this.session.status() === 'signed-in') {
          void this.session.refreshTotp();
        } else if (this.session.notice() !== null && !this.router.url.startsWith(SIGN_IN_PATH)) {
          void this.router.navigateByUrl(SIGN_IN_PATH);
        }
      });
    });
  }

  protected roleLabel(role: string): string {
    return ROLE_LABELS[role] ?? role;
  }

  protected async signOut(): Promise<void> {
    try {
      await this.session.signOut();
    } catch {
      // The local session is already gone; revocation is retried on the next start.
    }
    await this.router.navigateByUrl(SIGN_IN_PATH);
  }

  ngOnDestroy(): void {
    if (this.robots) this.meta.removeTagElement(this.robots);
    this.robots = null;
  }
}
