import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { isApiError, SessionStore } from '@inecekvar/data-access';
import { StateComponent } from '@inecekvar/ui';
import {
  authFailure,
  loginPasswordIssue,
  PASSWORD_ERRORS,
  PASSWORD_INPUT_MAX,
  safeNext,
} from '../auth/auth-form';
import { TPipe } from '../i18n/i18n';
import { TranslationKey } from '../i18n/translation';
import { Countdown } from '../shared/countdown';

type View = 'verifying' | 'password' | 'missing' | 'failed';

/**
 * `/giris/baglanti`: the page a magic link opens. The token arrives in the URL fragment and was
 * already taken out of the address bar by the session store at start-up (ADR-0031); this page
 * only asks the store to verify it. A registration link also needs the password chosen at
 * registration, asked here and never stored.
 */
@Component({
  selector: 'iv-magic-link-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, RouterLink, StateComponent, TPipe],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'auth.consumeTitle' | t }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page" [attr.data-view]="view()">
        @switch (view()) {
          @case ('verifying') {
            <p class="iv-panel working" role="status">{{ 'auth.consumeWorking' | t }}</p>
          }
          @case ('password') {
            <p class="iv-kicker">{{ 'auth.kicker' | t }}</p>
            <h1 class="iv-heading">{{ 'auth.consumePasswordHeading' | t }}</h1>
            <p class="iv-lead">{{ 'auth.consumePasswordBody' | t }}</p>
            <form class="iv-form iv-panel form" novalidate (submit)="submit($event)">
              <div class="iv-field">
                <label class="iv-label" for="iv-link-password">{{ 'auth.password' | t }}</label>
                <input
                  id="iv-link-password"
                  class="iv-input"
                  type="password"
                  autocomplete="new-password"
                  [attr.maxlength]="passwordMax"
                  [value]="password()"
                  [attr.aria-invalid]="message() ? 'true' : null"
                  (input)="password.set(value($event))"
                />
              </div>
              @if (message(); as key) {
                <p class="iv-error" role="alert">
                  @if (countdown.active()) {
                    {{ key | t: { seconds: countdown.seconds() } }}
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
                {{ (busy() ? 'auth.busy' : 'auth.consumeSubmit') | t }}
              </button>
            </form>
          }
          @case ('missing') {
            <iv-state
              [heading]="'auth.consumeMissingTitle' | t"
              [message]="'auth.consumeMissingBody' | t"
            >
              <a class="iv-button" routerLink="/giris">{{ 'auth.toSignin' | t }}</a>
            </iv-state>
          }
          @case ('failed') {
            <iv-state
              kind="error"
              [heading]="'auth.consumeFailedTitle' | t"
              [message]="message() ?? 'auth.errors.generic' | t: { seconds: countdown.seconds() }"
            >
              <a class="iv-button" routerLink="/giris">{{ 'auth.requestNewLink' | t }}</a>
            </iv-state>
          }
        }
      </div>
    </ion-content>
  `,
  styleUrl: '../../../../../libs/ui/src/styles/forms.css',
  styles: `
    .working {
      margin-top: var(--iv-space-5);
      text-align: center;
    }
    .form {
      margin-top: var(--iv-space-4);
    }
  `,
})
export class MagicLinkPage {
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  protected readonly countdown = new Countdown();
  protected readonly passwordMax = PASSWORD_INPUT_MAX;
  protected readonly view = signal<View>('verifying');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly message = signal<TranslationKey | null>(null);

  constructor() {
    // A native deep link can arrive while this page is open, so follow the pending flag.
    effect(() => {
      const pending = this.session.hasPendingMagicLink();
      untracked(() => {
        if (pending && this.view() !== 'password' && !this.busy()) void this.verify();
        else if (!pending && this.view() === 'verifying' && !this.busy()) this.view.set('missing');
      });
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  ionViewDidLeave(): void {
    this.password.set('');
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const issue = loginPasswordIssue(this.password());
    if (issue) {
      this.message.set(PASSWORD_ERRORS[issue]);
      return;
    }
    void this.verify(this.password());
  }

  private async verify(password?: string): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    if (password === undefined) this.view.set('verifying');
    try {
      await this.session.completeMagicLink(password);
      this.password.set('');
      await this.router.navigateByUrl(safeNext(null), { replaceUrl: true });
    } catch (error) {
      const stillPending = this.session.hasPendingMagicLink();
      const failure = authFailure(error, 'verify');
      if (failure.key === 'auth.errors.rateLimited') this.countdown.start(failure.retryAfter);
      if (stillPending && isApiError(error) && error.code === 'auth.invalid_credentials') {
        // A registration link: ask for (or retry) the password chosen at registration.
        this.message.set(password === undefined ? null : failure.key);
        this.view.set('password');
      } else if (stillPending) {
        this.message.set(failure.key);
      } else {
        this.password.set('');
        this.message.set(failure.key);
        this.view.set('failed');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
