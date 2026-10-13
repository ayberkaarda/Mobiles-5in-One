import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  InjectionToken,
  type OnDestroy,
  signal,
} from '@angular/core';
import { PENDING_LOGOUT_MARKER, SessionStore } from '@inecekvar/data-access';
import { FACTS } from '../../content/facts';
import {
  deletionFailure,
  deletionMessage,
  retryAfterOf,
  signInFailure,
  signInMessage,
} from './deletion-errors';

export const EMAIL_MAX = 320;
export const PASSWORD_MAX = 1024;

/** Whether the browser reports a connection; tests replace it. */
export const IS_ONLINE = new InjectionToken<() => boolean>('IS_ONLINE', {
  providedIn: 'root',
  factory: () => () => globalThis.navigator?.onLine !== false,
});

type Stage = 'sign-in' | 'confirm' | 'done' | 'ended';

/**
 * Web account deletion (ADR-0057, specification story 10): password sign-in on the same-origin
 * cookie session, the ADR-0026 summary, the password again, then `DELETE me`. A wrong password
 * is an answer, not an ended session (the 3G rule of the app): the session stays and the person
 * can retry. Only after the API accepts the request does the page forget the account.
 */
@Component({
  selector: 'iv-deletion-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-iv-deletion': '' },
  template: `
    @switch (stage()) {
      @case ('sign-in') {
        <p>
          Bu panelde e-posta adresin ve şifrenle giriş yapıp hesabını silebilirsin. E-posta
          bağlantısıyla giriş burada sunulmaz; hesabında şifre yoksa silmeyi uygulamadan yap.
        </p>
        <p class="note" role="note" data-deletion="grace-warning">
          Daha önce silme istediysen ve {{ graceDays }} günlük bekleme sürüyorsa burada giriş yapma:
          doğru şifreyle giriş yapmak silme isteğini iptal eder ve hesabını yeniden açar. İstek süre
          dolunca kendiliğinden tamamlanır.
        </p>
        @if (notice(); as text) {
          <p role="status" data-deletion="notice">{{ text }}</p>
        }
        <form (submit)="$event.preventDefault(); signIn()" novalidate>
          <label for="iv-deletion-email">E-posta</label>
          <input
            id="iv-deletion-email"
            type="email"
            autocomplete="username"
            required
            [attr.maxlength]="emailMax"
            [value]="email()"
            (input)="email.set(value($event))"
            [disabled]="busy()"
          />
          <label for="iv-deletion-signin-password">Şifre</label>
          <input
            id="iv-deletion-signin-password"
            type="password"
            autocomplete="current-password"
            required
            [attr.maxlength]="passwordMax"
            [value]="signInPassword()"
            (input)="signInPassword.set(value($event))"
            [disabled]="busy()"
          />
          @if (error(); as message) {
            <p class="error" role="alert" data-deletion="error">{{ message }}</p>
          }
          <button type="submit" [disabled]="busy()">
            {{ busy() ? 'Giriş yapılıyor…' : 'Giriş yap' }}
          </button>
        </form>
      }
      @case ('confirm') {
        <p data-deletion="account">
          Giriş yapılan hesap: <strong data-deletion="email">{{ accountEmail() }}</strong>
        </p>
        <h3>Hemen olanlar</h3>
        <ul>
          <li>Hesap kapanır, bütün cihazlardaki oturumların sonlanır.</li>
          <li>Favorilerin ve ham GPS izlerin hemen silinir.</li>
          <li>Bekleyen önerilerin geri çekilir.</li>
        </ul>
        <h3>{{ graceDays }} gün içinde</h3>
        <ul>
          <li>Bu sürede yeniden giriş yaparsan silme iptal olur.</li>
          <li>
            Süre dolunca e-posta adresin, hesabın ve yüklediğin fotoğraflar kalıcı olarak silinir;
            sana bir onay e-postası gelir.
          </li>
        </ul>
        <h3>Kalanlar</h3>
        <ul>
          <li>
            Onaylanmış hat, durak ve ücret katkıların açık veri lisansı altında kalır; adın yerine
            “silinmiş katkıcı” yazar.
          </li>
          <li>Silme işleminin denetim kaydı kişisel veri içermez.</li>
        </ul>
        <h3>Bu tarayıcıda</h3>
        <ul>
          <li>Oturum ve güvenlik çerezi kaldırılır, bu sayfadaki form bilgileri temizlenir.</li>
        </ul>
        <form (submit)="$event.preventDefault(); remove()" novalidate>
          <label for="iv-deletion-password">Şifren (güvenlik için yeniden)</label>
          <input
            id="iv-deletion-password"
            type="password"
            autocomplete="current-password"
            required
            [attr.maxlength]="passwordMax"
            [value]="password()"
            (input)="password.set(value($event))"
            [disabled]="busy()"
          />
          <div class="check">
            <input
              id="iv-deletion-confirm"
              type="checkbox"
              [checked]="confirmed()"
              (change)="confirmed.set(checked($event))"
              [disabled]="busy()"
            />
            <label for="iv-deletion-confirm">Anladım, hesabımı silmek istiyorum.</label>
          </div>
          @if (error(); as message) {
            <p class="error" role="alert" data-deletion="error">{{ message }}</p>
          }
          <div class="actions">
            <button type="submit" class="danger" [disabled]="!canDelete()">
              {{ busy() ? 'Siliniyor…' : 'Hesabı sil' }}
            </button>
            <button type="button" (click)="signOut()" [disabled]="busy()">
              Vazgeç ve çıkış yap
            </button>
          </div>
        </form>
      }
      @case ('done') {
        <div role="status" data-deletion="done">
          <h3>Hesabın silinmek üzere kapatıldı</h3>
          <p>
            Sunucu silme isteğini kabul etti. Oturumların kapatıldı, favorilerin ve ham GPS izlerin
            silindi, bekleyen önerilerin geri çekildi.
          </p>
          <p>
            {{ graceDays }} gün içinde giriş yaparsan silme iptal olur. Süre dolunca kişisel
            verilerin kalıcı olarak silinir ve sana bir onay e-postası gelir. Sunucu yanıtı kesin
            bir tarih içermez; bekleme süresi {{ graceDays }} gündür.
          </p>
          <p>Bu tarayıcıdaki oturum ve form bilgileri temizlendi.</p>
        </div>
      }
      @case ('ended') {
        <p class="error" role="alert" data-deletion="error">{{ error() }}</p>
        <button type="button" (click)="restart()">Giriş ekranına dön</button>
      }
    }
  `,
  styles: `
    form {
      display: grid;
      gap: 0.5rem;
      max-width: 28rem;
    }
    input[type='email'],
    input[type='password'] {
      font: inherit;
      padding: 0.5rem;
    }
    button {
      font: inherit;
      padding: 0.5rem 1rem;
      min-height: 2.75rem;
    }
    .danger {
      font-weight: 700;
    }
    .check,
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
    .note {
      border-left: 0.25rem solid var(--iv-color-dolmus-sarisi);
      padding: 0.5rem 0.75rem;
    }
    .error {
      font-weight: 600;
    }
  `,
})
export class DeletionPanelComponent implements OnDestroy {
  private readonly session = inject(SessionStore);
  private readonly marker = inject(PENDING_LOGOUT_MARKER);
  private readonly online = inject(IS_ONLINE);

  protected readonly graceDays = FACTS.deletion.graceDays;
  protected readonly emailMax = EMAIL_MAX;
  protected readonly passwordMax = PASSWORD_MAX;

  readonly stage = signal<Stage>('sign-in');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly email = signal('');
  readonly signInPassword = signal('');
  readonly password = signal('');
  readonly confirmed = signal(false);
  readonly accountEmail = computed(() => this.session.user()?.email ?? '');
  readonly canDelete = computed(
    () => !this.busy() && this.confirmed() && this.password().length > 0,
  );

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  async signIn(): Promise<void> {
    if (this.busy()) return;
    const address = this.email().trim();
    const secret = this.signInPassword();
    if (!/^[^\s@]+@[^\s@]+$/.test(address) || address.length > EMAIL_MAX) {
      this.error.set('Geçerli bir e-posta adresi gir.');
      return;
    }
    if (secret.length === 0 || secret.length > PASSWORD_MAX) {
      this.error.set('Şifreni gir.');
      return;
    }
    if (!this.online()) {
      this.error.set(signInMessage('offline', null));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.session.login(address, secret);
      this.signInPassword.set('');
      this.stage.set('confirm');
    } catch (failure) {
      this.signInPassword.set('');
      this.error.set(signInMessage(signInFailure(failure), retryAfterOf(failure)));
    } finally {
      this.busy.set(false);
    }
  }

  /** Sends `DELETE me` with the password; never without it, whatever the account type. */
  async remove(): Promise<void> {
    if (this.busy()) return;
    const secret = this.password();
    if (secret.length === 0 || secret.length > PASSWORD_MAX) {
      this.error.set('Güvenlik için şifreni yeniden gir.');
      return;
    }
    if (!this.confirmed()) {
      this.error.set('Silmeyi onaylamak için kutuyu işaretle.');
      return;
    }
    if (!this.online()) {
      this.error.set(deletionMessage('offline', null));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.session.deleteAccount(secret);
      if (result.status !== 'deletion_scheduled') throw new Error('unexpected deletion status');
      this.forgetLocal();
      this.stage.set('done');
    } catch (failure) {
      const kind = deletionFailure(failure);
      this.password.set('');
      this.error.set(deletionMessage(kind, retryAfterOf(failure)));
      if (kind === 'session-ended') {
        this.forgetLocal();
        this.stage.set('ended');
      }
      // Every other failure keeps the session and the confirm step: the account is unchanged.
    } finally {
      this.busy.set(false);
    }
  }

  async signOut(): Promise<void> {
    this.forgetLocal();
    this.stage.set('sign-in');
    this.notice.set('Çıkış yaptın; hesabında bir değişiklik yapılmadı.');
    try {
      await this.session.logout();
    } catch {
      // The pending-logout marker of the shared client finishes it on a later visit.
    }
  }

  restart(): void {
    this.error.set(null);
    this.stage.set('sign-in');
  }

  ngOnDestroy(): void {
    // Leaving the page while signed in must not leave a session cookie behind.
    if (this.stage() === 'confirm' && this.session.user() !== null) {
      this.session.logout().catch(() => undefined);
    }
  }

  /** Clears what this page holds about the account: inputs, error text and the sign-in state. */
  private forgetLocal(): void {
    this.email.set('');
    this.signInPassword.set('');
    this.password.set('');
    this.confirmed.set(false);
    if (this.session.user() === null && !this.session.logoutPending()) this.marker.clear();
  }
}
