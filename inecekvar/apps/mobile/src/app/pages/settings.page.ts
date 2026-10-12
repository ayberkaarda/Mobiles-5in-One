import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
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

  protected setLang(lang: AppLang): void {
    void this.language.set(lang);
  }
}
