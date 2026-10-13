import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { SessionStore } from '@inecekvar/data-access';
import { map } from 'rxjs';
import {
  authFailure,
  EMAIL_ERRORS,
  EMAIL_MAX,
  emailError,
  loginPasswordIssue,
  normalizeEmail,
  PASSWORD_ERRORS,
  PASSWORD_INPUT_MAX,
  safeNext,
} from '../auth/auth-form';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { BackButtonComponent } from '../shared/back-button.component';
import { Countdown } from '../shared/countdown';

type Mode = 'password' | 'link';

/**
 * `/giris`: sign in with email and password, or ask for a magic link. Failures are generic
 * (no hint whether the address exists); a rate limit shows a countdown. The password lives in
 * this component only: never in the URL, history state or storage, and it is cleared on
 * success and when the page is left.
 */
@Component({
  selector: 'iv-signin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonTitle,
    IonContent,
    RouterLink,
    BackButtonComponent,
    TPipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <iv-back-button />
        </ion-buttons>
        <ion-title>{{ 'auth.signinTitle' | t }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page">
        <p class="iv-kicker">{{ 'auth.kicker' | t }}</p>
        <h1 class="iv-heading">{{ 'auth.signinHeading' | t }}</h1>
        <p class="iv-lead">{{ 'auth.signinLead' | t }}</p>

        <div class="iv-segmented mode" role="group" [attr.aria-label]="'auth.modeLabel' | t">
          <button
            type="button"
            [attr.aria-pressed]="mode() === 'password'"
            (click)="setMode('password')"
          >
            {{ 'auth.modePassword' | t }}
          </button>
          <button type="button" [attr.aria-pressed]="mode() === 'link'" (click)="setMode('link')">
            {{ 'auth.modeLink' | t }}
          </button>
        </div>

        @if (linkSent()) {
          <section class="iv-panel sent" role="status" data-state="link-sent">
            <svg class="mail" viewBox="0 0 48 48" aria-hidden="true">
              <rect x="5" y="11" width="38" height="26" rx="4" />
              <path d="M7 14l17 12 17-12" />
            </svg>
            <h2>{{ 'auth.linkSentTitle' | t }}</h2>
            <p>{{ 'auth.linkSentBody' | t }}</p>
            <p class="iv-hint">{{ 'auth.linkSentHint' | t }}</p>
            <button
              type="button"
              class="iv-button iv-button--ghost iv-button--block"
              [disabled]="busy() || countdown.active()"
              (click)="sendLink()"
            >
              @if (countdown.active()) {
                {{ 'auth.resendIn' | t: { seconds: countdown.seconds() } }}
              } @else {
                {{ 'auth.resend' | t }}
              }
            </button>
          </section>
        } @else {
          <form class="iv-form iv-panel" novalidate (submit)="submit($event)">
            <div class="iv-field">
              <label class="iv-label" for="iv-signin-email">{{ 'auth.email' | t }}</label>
              <input
                id="iv-signin-email"
                class="iv-input"
                type="email"
                inputmode="email"
                autocomplete="username"
                autocapitalize="off"
                spellcheck="false"
                [attr.maxlength]="emailMax"
                [value]="email()"
                [attr.aria-invalid]="emailMessage() ? 'true' : null"
                [attr.aria-describedby]="emailMessage() ? 'iv-signin-email-error' : null"
                (input)="email.set(value($event))"
              />
              @if (emailMessage(); as message) {
                <p id="iv-signin-email-error" class="iv-error">{{ message | t }}</p>
              }
            </div>
            @if (mode() === 'password') {
              <div class="iv-field">
                <label class="iv-label" for="iv-signin-password">{{ 'auth.password' | t }}</label>
                <div class="secret">
                  <input
                    id="iv-signin-password"
                    class="iv-input"
                    autocomplete="current-password"
                    [type]="showPassword() ? 'text' : 'password'"
                    [attr.maxlength]="passwordMax"
                    [value]="password()"
                    [attr.aria-invalid]="passwordMessage() ? 'true' : null"
                    (input)="password.set(value($event))"
                  />
                  <button
                    type="button"
                    class="iv-link-button reveal"
                    [attr.aria-pressed]="showPassword()"
                    (click)="showPassword.set(!showPassword())"
                  >
                    {{ (showPassword() ? 'auth.hide' : 'auth.show') | t }}
                  </button>
                </div>
                @if (passwordMessage(); as message) {
                  <p class="iv-error">{{ message | t }}</p>
                }
              </div>
            } @else {
              <p class="iv-hint">{{ 'auth.linkHint' | t }}</p>
            }
            @if (failure(); as key) {
              <p class="iv-error failure" role="alert">
                @if (countdown.active()) {
                  {{ key | t: { seconds: countdown.seconds() } }}
                } @else if (key === 'auth.errors.rateLimited') {
                  {{ 'auth.errors.rateReady' | t }}
                } @else {
                  {{ key | t }}
                }
              </p>
            }
            <button
              type="submit"
              class="iv-button iv-button--block"
              [disabled]="busy() || countdown.active()"
            >
              {{ submitLabel() | t }}
            </button>
          </form>
        }

        <p class="switch">
          {{ 'auth.noAccount' | t }}
          <a routerLink="/giris/kayit" [queryParams]="nextParams()">{{ 'auth.toRegister' | t }}</a>
        </p>
      </div>
    </ion-content>
  `,
  styleUrl: '../../../../../libs/ui/src/styles/forms.css',
  styles: `
    .mode {
      margin: var(--iv-space-5) 0 var(--iv-space-4);
    }
    .secret {
      position: relative;
    }
    .secret .iv-input {
      padding-right: 84px;
    }
    .reveal {
      position: absolute;
      top: 3px;
      right: 6px;
    }
    .sent {
      display: grid;
      gap: 8px;
      justify-items: start;
    }
    .sent h2 {
      margin: 0;
      font-size: 20px;
    }
    .sent p {
      margin: 0;
      line-height: 1.45;
    }
    .mail {
      width: 48px;
      height: 48px;
      fill: var(--iv-accent);
      stroke: var(--iv-ink);
      stroke-width: 2.5;
      stroke-linejoin: round;
    }
    .switch {
      margin: var(--iv-space-5) 0 0;
      text-align: center;
      color: var(--iv-ink-muted);
    }
    .switch a {
      color: var(--iv-ink);
      font-weight: 600;
    }
  `,
})
export class SigninPage {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly next = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('sonra'))),
    { initialValue: null },
  );

  protected readonly countdown = new Countdown();
  protected readonly emailMax = EMAIL_MAX;
  protected readonly passwordMax = PASSWORD_INPUT_MAX;
  protected readonly mode = signal<Mode>('password');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal<TranslationKey | null>(null);
  protected readonly linkSent = signal(false);

  protected readonly nextParams = computed(() => {
    const next = this.next();
    return next ? { sonra: next } : {};
  });

  protected readonly emailMessage = computed<TranslationKey | null>(() => {
    if (!this.submitted()) return null;
    const error = emailError(this.email());
    return error ? EMAIL_ERRORS[error] : null;
  });

  protected readonly passwordMessage = computed<TranslationKey | null>(() => {
    if (!this.submitted() || this.mode() !== 'password') return null;
    const issue = loginPasswordIssue(this.password());
    return issue ? PASSWORD_ERRORS[issue] : null;
  });

  protected readonly submitLabel = computed<TranslationKey>(() => {
    if (this.busy()) return 'auth.busy';
    return this.mode() === 'password' ? 'auth.submitLogin' : 'auth.submitLink';
  });

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setMode(mode: Mode): void {
    this.mode.set(mode);
    this.failure.set(null);
    this.submitted.set(false);
    this.linkSent.set(false);
    this.password.set('');
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (this.mode() === 'link') {
      void this.sendLink();
      return;
    }
    if (this.emailMessage() || this.passwordMessage()) return;
    void this.login();
  }

  /** Ionic keeps tab pages alive; nothing typed into the password field outlives the visit. */
  ionViewDidLeave(): void {
    this.password.set('');
    this.showPassword.set(false);
  }

  private async login(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      await this.session.login(normalizeEmail(this.email()), this.password());
      this.password.set('');
      await this.router.navigateByUrl(safeNext(this.next()), { replaceUrl: true });
    } catch (error) {
      this.fail(error, 'login');
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendLink(): Promise<void> {
    if (this.busy() || emailError(this.email())) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      await this.session.requestMagicLink(normalizeEmail(this.email()));
      this.linkSent.set(true);
      // The API allows a few requests per quarter hour; pace resends so they stay useful.
      this.countdown.start(60);
    } catch (error) {
      this.linkSent.set(false);
      this.fail(error, 'link');
    } finally {
      this.busy.set(false);
    }
  }

  private fail(error: unknown, action: 'login' | 'link'): void {
    const failure = authFailure(error, action);
    this.failure.set(failure.key);
    if (failure.key === 'auth.errors.rateLimited') this.countdown.start(failure.retryAfter);
  }
}
