import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { AdminApi } from '../admin-api';
import { adminErrorMessage } from '../admin-errors';
import { AdminSession } from '../admin-session';
import { formatTime } from '../admin-text';
import { TOTP_CODE_PATTERN } from '../step-up/step-up.service';
import { encodeQr, qrPath } from '../totp/qr-code';

/** The secret from `POST me/totp/enrol` lives only in this component until it is confirmed. */
interface Enrolment {
  secret: string;
  uri: string;
}

/** Only `otpauth://totp/` URIs are drawn; anything else is refused rather than encoded. */
export function isTotpUri(value: string): boolean {
  return /^otpauth:\/\/totp\/[^\s]{1,400}$/.test(value) && value.length <= 512;
}

/** Groups the base32 secret in fours so it can be typed into an authenticator by hand. */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

@Component({
  selector: 'iv-admin-totp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>İki adımlı doğrulama</h1>
    @if (status(); as current) {
      @if (current.enabled) {
        <section class="iv-admin-card" data-totp="enabled">
          <h2>Doğrulama açık</h2>
          <p>
            Açılış: {{ time(current.enabled_at) }}. Geri alma, hat kaldırma ve yönetim işlemlerinde
            uygulamandaki kodu soracağız.
          </p>
        </section>
      } @else if (enrolment()) {
        <section class="iv-admin-card" data-totp="enrolling">
          <h2>1. Kodu uygulamana ekle</h2>
          <p>
            Doğrulama uygulamanla (ör. bir TOTP uygulaması) bu kodu tara. Kod bu cihazda çizilir.
          </p>
          @if (qr(); as drawing) {
            <svg
              class="qr"
              [attr.viewBox]="drawing.viewBox"
              role="img"
              aria-label="TOTP kurulum karekodu"
              shape-rendering="crispEdges"
            >
              <rect width="100%" height="100%" fill="#FFFFFF" />
              <path [attr.d]="drawing.d" fill="#1F2124" />
            </svg>
          } @else {
            <p class="iv-admin-error">Karekod çizilemedi; aşağıdaki anahtarı elle gir.</p>
          }
          <p class="iv-admin-banner" role="note">
            Bu anahtar yalnızca şimdi gösterilir. Kimseyle paylaşma, ekran görüntüsü alma; sayfadan
            ayrılınca bir daha gösterilmez.
          </p>
          <label for="iv-totp-secret">Anahtar (elle girmek için)</label>
          <div class="secret-row">
            <code id="iv-totp-secret" data-totp="secret">{{ grouped() }}</code>
            <button type="button" class="secondary" (click)="copy()">
              {{ copied() ? 'Kopyalandı' : 'Kopyala' }}
            </button>
          </div>
          <h2>2. Uygulamadaki kodu gir</h2>
          <form novalidate (submit)="$event.preventDefault(); confirm(code.value.trim())">
            <label for="iv-totp-code">6 haneli kod</label>
            <input
              #code
              id="iv-totp-code"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              maxlength="6"
              required
              [disabled]="pending()"
            />
            <div class="iv-admin-actions">
              <button type="submit" [disabled]="pending()">
                {{ pending() ? 'Onaylanıyor…' : 'Onayla ve aç' }}
              </button>
            </div>
          </form>
        </section>
      } @else {
        <section class="iv-admin-card" data-totp="disabled">
          <h2>Doğrulama kapalı</h2>
          <p>
            Geri alma, hat kaldırma ve yönetim işlemleri 15 dakika geçerli bir ek kod ister. Önce
            bir doğrulama uygulaması kur. Güvenlik için kurulum, son 10 dakika içinde giriş yapmış
            olmanı ister.
          </p>
          <div class="iv-admin-actions">
            <button type="button" (click)="start()" [disabled]="pending()">
              {{ pending() ? 'Hazırlanıyor…' : 'Kurulumu başlat' }}
            </button>
          </div>
        </section>
      }
    } @else if (!loadError()) {
      <p class="iv-admin-muted">Yükleniyor…</p>
    }
    @if (message(); as text) {
      <p class="iv-admin-ok" role="status">{{ text }}</p>
    }
    @if (error() ?? loadError(); as text) {
      <p class="iv-admin-error" role="alert">{{ text }}</p>
    }
  `,
  styles: `
    .qr {
      width: min(16rem, 100%);
      height: auto;
      display: block;
      margin: 0.5rem 0;
      border: 1px solid var(--iv-line);
    }
    .secret-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
    code {
      font-size: 1.125rem;
      letter-spacing: 0.05em;
      padding: 0.4rem 0.6rem;
      background: var(--iv-surface-sunk);
      border-radius: 0.4rem;
      overflow-wrap: anywhere;
      display: inline-block;
      max-width: 100%;
    }
  `,
})
export class TotpPage implements OnInit, OnDestroy {
  private readonly api = inject(AdminApi);
  private readonly session = inject(AdminSession);
  protected readonly status = this.session.totp;
  protected readonly enrolment = signal<Enrolment | null>(null);
  protected readonly pending = signal(false);
  protected readonly copied = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly grouped = computed(() => groupSecret(this.enrolment()?.secret ?? ''));
  protected readonly qr = computed(() => {
    const uri = this.enrolment()?.uri;
    if (!uri || !isTotpUri(uri)) return null;
    try {
      return qrPath(encodeQr(uri));
    } catch {
      return null;
    }
  });

  async ngOnInit(): Promise<void> {
    try {
      this.session.setTotp(await this.api.totpStatus());
    } catch (error) {
      this.loadError.set(adminErrorMessage(error, 'totp'));
    }
  }

  protected time(iso: string | null): string {
    return formatTime(iso);
  }

  async start(): Promise<void> {
    if (this.pending()) return;
    this.pending.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      const result = await this.api.enrolTotp();
      this.enrolment.set({ secret: result.secret, uri: result.otpauth_uri });
    } catch (error) {
      this.error.set(adminErrorMessage(error, 'totp'));
    } finally {
      this.pending.set(false);
    }
  }

  async confirm(code: string): Promise<void> {
    if (this.pending()) return;
    if (!TOTP_CODE_PATTERN.test(code)) {
      this.error.set('Kod 6 rakamdan oluşur.');
      return;
    }
    this.pending.set(true);
    this.error.set(null);
    try {
      const status = await this.api.confirmTotp(code);
      this.enrolment.set(null);
      this.session.setTotp(status);
      this.message.set('İki adımlı doğrulama açıldı.');
    } catch (error) {
      this.error.set(adminErrorMessage(error, 'totp'));
    } finally {
      this.pending.set(false);
    }
  }

  async copy(): Promise<void> {
    const secret = this.enrolment()?.secret;
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      this.copied.set(true);
    } catch {
      this.error.set('Kopyalanamadı; anahtarı elle seç.');
    }
  }

  ngOnDestroy(): void {
    // The secret is never stored; leaving the page forgets it.
    this.enrolment.set(null);
  }
}
