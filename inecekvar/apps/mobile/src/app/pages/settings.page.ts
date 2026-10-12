import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { SessionStore, UserRole } from '@inecekvar/data-access';
import {
  AccountDeletion,
  DELETION_FAILURE_KEYS,
  WEB_DELETION_URL,
  WEB_LICENCE_URL,
} from '../account/account-deletion';
import { RecorderStore } from '../contribute/recorder.store';
import { CityStore } from '../city/city.store';
import { PackManager } from '../packs/pack-manager';
import { PackRegistry } from '../packs/pack-registry';
import { PURCHASES_ADAPTER } from '../plus/purchases';
import { Countdown } from '../shared/countdown';
import { ConnectivityService } from '../shared/connectivity.service';
import { formatBytes, formatNumber } from '../shared/format';
import { APP_VERSION } from '../core/app-info';
import { LanguageService } from '../core/language.service';
import { ThemePref, ThemeService } from '../core/theme.service';
import { TPipe, TpPipe } from '../i18n/i18n';
import { AppLang, TranslationKey } from '../i18n/translation';

const THEME_OPTIONS: readonly { value: ThemePref; label: TranslationKey }[] = [
  { value: 'system', label: 'settings.themeSystem' },
  { value: 'light', label: 'settings.themeLight' },
  { value: 'dark', label: 'settings.themeDark' },
];

const LANG_OPTIONS: readonly { value: AppLang; label: TranslationKey }[] = [
  { value: 'tr', label: 'settings.languageTr' },
  { value: 'en', label: 'settings.languageEn' },
];

const ROLE_KEYS: Record<UserRole, TranslationKey> = {
  user: 'account.roleUser',
  contributor: 'account.roleContributor',
  moderator: 'account.roleModerator',
  admin: 'account.roleAdmin',
};

export type DeletionView = 'closed' | 'confirm' | 'done';

@Component({
  selector: 'iv-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, RouterLink, TPipe, TpPipe],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly session = inject(SessionStore);
  protected readonly recorder = inject(RecorderStore);
  protected readonly deletion = inject(AccountDeletion);
  protected readonly connectivity = inject(ConnectivityService);
  protected readonly signingOut = signal(false);
  protected readonly signOutNote = signal<TranslationKey | null>(null);
  protected readonly language = inject(LanguageService);
  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly langOptions = LANG_OPTIONS;
  protected readonly version = APP_VERSION;
  protected readonly webDeletionUrl = WEB_DELETION_URL;
  protected readonly webLicenceUrl = WEB_LICENCE_URL;
  /** Plus is sold in the native app only; the web says so on the paywall. */
  protected readonly plusInApp = inject(PURCHASES_ADAPTER).unavailable !== 'web';
  private readonly registry = inject(PackRegistry);
  private readonly manager = inject(PackManager);

  protected readonly deleteView = signal<DeletionView>('closed');
  protected readonly deletePassword = signal('');
  protected readonly deleteConfirmed = signal(false);
  protected readonly deleteError = signal<TranslationKey | null>(null);
  protected readonly deleteCleanupFailed = signal(false);
  protected readonly deleteCountdown = new Countdown();

  protected readonly updates = computed(() => this.manager.updates().length);
  protected readonly offlineSummary = computed(() => {
    const packs = this.registry.list();
    if (packs.length === 0) return this.language.t('settings.offlineNone');
    const bytes = packs.reduce((sum, m) => sum + m.dataset.bytes + (m.basemap?.bytes ?? 0), 0);
    return this.language.tp('settings.offlineSome', packs.length, {
      size: formatBytes(bytes, this.language.lang()),
    });
  });
  protected readonly roleLabel = computed(() => {
    const role = this.session.role();
    return role ? ROLE_KEYS[role] : null;
  });
  protected readonly reputation = computed(() =>
    formatNumber(this.session.user()?.reputation ?? 0, this.language.lang()),
  );
  protected readonly canDelete = computed(
    () =>
      this.deleteConfirmed() &&
      this.connectivity.online() &&
      !this.deletion.busy() &&
      !this.deleteCountdown.active(),
  );

  constructor() {
    void this.registry.ready();
    void inject(CityStore).init();
  }

  ionViewDidLeave(): void {
    // Ionic keeps tab pages alive; the password must not wait in memory for the next visit.
    if (this.deleteView() === 'confirm') this.closeDeletion();
    this.deletePassword.set('');
  }

  /**
   * Signs out here and deletes the unsent ride draft: positions recorded on a shared device
   * should not wait for the next person. The local sign-out is immediate; when the server
   * cannot be reached the revocation is retried later (ADR-0031).
   */
  protected async signOut(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    this.signOutNote.set(null);
    try {
      await this.recorder.discard();
      await this.session.logout();
      this.signOutNote.set(
        this.recorder.cleanupPending() ? 'recorder.errors.cleanup' : 'settings.signedOut',
      );
    } catch {
      this.signOutNote.set(
        this.recorder.cleanupPending() ? 'recorder.errors.cleanup' : 'settings.signOutPending',
      );
    } finally {
      this.signingOut.set(false);
    }
  }

  protected setLang(lang: AppLang): void {
    void this.language.set(lang);
  }

  protected openDeletion(): void {
    this.deleteError.set(null);
    this.deleteConfirmed.set(false);
    this.deletePassword.set('');
    this.deleteView.set('confirm');
  }

  protected closeDeletion(): void {
    this.deletePassword.set('');
    this.deleteConfirmed.set(false);
    this.deleteError.set(null);
    this.deleteView.set('closed');
  }

  protected onPassword(event: Event): void {
    this.deletePassword.set((event.target as HTMLInputElement).value);
  }

  protected onConfirm(event: Event): void {
    this.deleteConfirmed.set((event.target as HTMLInputElement).checked);
  }

  protected async confirmDeletion(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.connectivity.online()) {
      this.deleteError.set('account.deleteOffline');
      return;
    }
    if (!this.canDelete()) return;
    this.deleteError.set(null);
    const password = this.deletePassword();
    const result = await this.deletion.delete(password === '' ? null : password);
    this.deletePassword.set('');
    if (result.ok) {
      this.deleteCleanupFailed.set(result.cleanupFailed);
      this.deleteConfirmed.set(false);
      this.deleteView.set('done');
      return;
    }
    if (result.failure === 'rate-limited') this.deleteCountdown.start(result.retryAfterSeconds);
    this.deleteError.set(DELETION_FAILURE_KEYS[result.failure]);
  }
}
