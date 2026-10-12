import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { SessionStore } from '@inecekvar/data-access';
import { RecorderStore } from '../contribute/recorder.store';
import { CityStore } from '../city/city.store';
import { PackManager } from '../packs/pack-manager';
import { PackRegistry } from '../packs/pack-registry';
import { formatBytes } from '../shared/format';
import { APP_VERSION } from '../core/app-info';
import { LanguageService } from '../core/language.service';
import { ThemePref, ThemeService } from '../core/theme.service';
import { TPipe } from '../i18n/i18n';
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

@Component({
  selector: 'iv-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, RouterLink, TPipe],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly session = inject(SessionStore);
  private readonly recorder = inject(RecorderStore);
  protected readonly signingOut = signal(false);
  protected readonly signOutNote = signal<TranslationKey | null>(null);
  protected readonly language = inject(LanguageService);
  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly langOptions = LANG_OPTIONS;
  protected readonly version = APP_VERSION;
  private readonly registry = inject(PackRegistry);
  private readonly manager = inject(PackManager);
  protected readonly updates = computed(() => this.manager.updates().length);
  protected readonly offlineSummary = computed(() => {
    const packs = this.registry.list();
    if (packs.length === 0) return this.language.t('settings.offlineNone');
    const bytes = packs.reduce((sum, m) => sum + m.dataset.bytes + (m.basemap?.bytes ?? 0), 0);
    return this.language.t('settings.offlineSome', {
      count: packs.length,
      size: formatBytes(bytes, this.language.lang()),
    });
  });

  constructor() {
    void this.registry.ready();
    void inject(CityStore).init();
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
      this.signOutNote.set('settings.signedOut');
    } catch {
      this.signOutNote.set('settings.signOutPending');
    } finally {
      this.signingOut.set(false);
    }
  }

  protected setLang(lang: AppLang): void {
    void this.language.set(lang);
  }
}
