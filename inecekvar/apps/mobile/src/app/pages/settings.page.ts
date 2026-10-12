import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
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
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, TPipe],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  protected readonly theme = inject(ThemeService);
  protected readonly language = inject(LanguageService);
  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly langOptions = LANG_OPTIONS;
  protected readonly version = APP_VERSION;

  protected setLang(lang: AppLang): void {
    void this.language.set(lang);
  }
}
