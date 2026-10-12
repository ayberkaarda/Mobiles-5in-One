import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonButtons, IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { SessionStore } from '@inecekvar/data-access';
import { map } from 'rxjs';
import {
  authFailure,
  DISPLAY_NAME_MAX,
  displayNameError,
  EMAIL_ERRORS,
  EMAIL_MAX,
  emailError,
  normalizeEmail,
  PASSWORD_ERRORS,
  PASSWORD_MAX,
  PASSWORD_MIN,
  passwordIssues,
} from '../auth/auth-form';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { BackButtonComponent } from '../shared/back-button.component';
import { Countdown } from '../shared/countdown';

/**
 * `/giris/kayit`: registration. The API answers the same way for new and existing addresses
 * and mails a link; the account is created when that link is opened with the same password
 * (ADR-0007), so the confirmation screen says so. The password is never stored or put in a URL.
 */
@Component({
  selector: 'iv-register-page',
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
        <ion-title>{{ 'auth.registerTitle' | t }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page">
        <p class="iv-kicker">{{ 'auth.kicker' | t }}</p>
        <h1 class="iv-heading">{{ 'auth.registerHeading' | t }}</h1>
        <p class="iv-lead">{{ 'auth.registerLead' | t }}</p>

        @if (sent()) {
          <section class="iv-panel sent" role="status" data-state="register-sent">
            <h2>{{ 'auth.registerSentTitle' | t }}</h2>
            <p>{{ 'auth.registerSentBody' | t }}</p>
            <p class="iv-hint">{{ 'auth.linkSentHint' | t }}</p>
          </section>
        } @else {
          <form class="iv-form iv-panel form" novalidate (submit)="submit($event)">
            <div class="iv-field">
              <label class="iv-label" for="iv-register-email">{{ 'auth.email' | t }}</label>
              <input
                id="iv-register-email"
                class="iv-input"
                type="email"
                inputmode="email"
                autocomplete="email"
                autocapitalize="off"
                spellcheck="false"
                [attr.maxlength]="emailMax"
                [value]="email()"
                [attr.aria-invalid]="emailMessage() ? 'true' : null"
                (input)="email.set(value($event))"
              />
              @if (emailMessage(); as message) {
                <p class="iv-error">{{ message | t }}</p>
              }
            </div>
            <div class="iv-field">
              <label class="iv-label" for="iv-register-password">{{
                'auth.newPassword' | t
              }}</label>
              <input
                id="iv-register-password"
                class="iv-input"
                type="password"
                autocomplete="new-password"
                aria-describedby="iv-register-policy"
                [attr.maxlength]="passwordMax"
                [value]="password()"
                [attr.aria-invalid]="passwordMessage() ? 'true' : null"
                (input)="password.set(value($event))"
              />
              <ul id="iv-register-policy" class="policy">
                <li [class.ok]="lengthOk()">
                  {{ 'auth.policyLength' | t: { min: passwordMin, max: passwordMax } }}
                </li>
                <li [class.ok]="notEmailOk()">{{ 'auth.policyNotEmail' | t }}</li>
                <li>{{ 'auth.policyBreached' | t }}</li>
              </ul>
              @if (passwordMessage(); as message) {
                <p class="iv-error">{{ message | t }}</p>
              }
            </div>
            <div class="iv-field">
              <label class="iv-label" for="iv-register-name">{{ 'auth.displayName' | t }}</label>
              <input
                id="iv-register-name"
                class="iv-input"
                type="text"
                autocomplete="nickname"
                [attr.maxlength]="nameMax"
                [value]="displayName()"
                [attr.aria-invalid]="nameMessage() ? 'true' : null"
                (input)="displayName.set(value($event))"
              />
              <p class="iv-hint">{{ 'auth.displayNameHint' | t: { max: nameMax } }}</p>
              @if (nameMessage(); as message) {
                <p class="iv-error">{{ message | t }}</p>
              }
            </div>
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
              {{ (busy() ? 'auth.busy' : 'auth.submitRegister') | t }}
            </button>
          </form>
        }
        <p class="switch">
          {{ 'auth.haveAccount' | t }}
          <a routerLink="/giris" [queryParams]="nextParams()">{{ 'auth.toSignin' | t }}</a>
        </p>
      </div>
    </ion-content>
  `,
  styles: `
    .form,
    .sent {
      margin-top: var(--iv-space-5);
    }
    .sent {
      display: grid;
      gap: 8px;
    }
    .sent h2 {
      margin: 0;
      font-size: 20px;
    }
    .sent p {
      margin: 0;
      line-height: 1.45;
    }
    .policy {
      margin: 2px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 4px;
      font-size: 13px;
      color: var(--iv-ink-muted);
    }
    .policy li::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 8px;
      border-radius: 50%;
      border: 1.5px solid var(--iv-line-strong);
    }
    .policy li.ok {
      color: var(--iv-ink);
    }
    .policy li.ok::before {
      border-color: var(--iv-success);
      background: var(--iv-success);
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
export class RegisterPage {
  private readonly session = inject(SessionStore);
  private readonly next = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('sonra'))),
    { initialValue: null },
  );

  protected readonly countdown = new Countdown();
  protected readonly emailMax = EMAIL_MAX;
  protected readonly passwordMin = PASSWORD_MIN;
  protected readonly passwordMax = PASSWORD_MAX;
  protected readonly nameMax = DISPLAY_NAME_MAX;
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly displayName = signal('');
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal<TranslationKey | null>(null);
  protected readonly sent = signal(false);

  protected readonly nextParams = computed(() => {
    const next = this.next();
    return next ? { sonra: next } : {};
  });

  private readonly issues = computed(() => passwordIssues(this.password(), this.email()));
  protected readonly lengthOk = computed(
    () => this.password() !== '' && !this.issues().some((i) => i === 'short' || i === 'long'),
  );
  protected readonly notEmailOk = computed(
    () => this.password() !== '' && !this.issues().includes('same-as-email'),
  );

  protected readonly emailMessage = computed<TranslationKey | null>(() => {
    if (!this.submitted()) return null;
    const error = emailError(this.email());
    return error ? EMAIL_ERRORS[error] : null;
  });

  protected readonly passwordMessage = computed<TranslationKey | null>(() => {
    if (!this.submitted()) return null;
    const [issue] = this.issues();
    return issue ? PASSWORD_ERRORS[issue] : null;
  });

  protected readonly nameMessage = computed<TranslationKey | null>(() =>
    this.submitted() && displayNameError(this.displayName()) ? 'auth.errors.displayName' : null,
  );

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  ionViewDidLeave(): void {
    this.password.set('');
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (this.emailMessage() || this.passwordMessage() || this.nameMessage()) return;
    void this.register();
  }

  private async register(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const name = this.displayName().trim();
      await this.session.register(
        normalizeEmail(this.email()),
        this.password(),
        name === '' ? undefined : name,
      );
      // The link asks for the password again on this device; nothing keeps it meanwhile.
      this.password.set('');
      this.sent.set(true);
    } catch (error) {
      const failure = authFailure(error, 'register');
      this.failure.set(failure.key);
      if (failure.key === 'auth.errors.rateLimited') this.countdown.start(failure.retryAfter);
    } finally {
      this.busy.set(false);
    }
  }
}
