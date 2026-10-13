import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import {
  AppLang,
  DEFAULT_LANG,
  isAppLang,
  PluralKey,
  TranslationKey,
  TranslationParams,
} from '../i18n/translation';
import { formatNumber, pluralForm } from '../shared/format';
import { PREF_KEYS, readPref, writePref } from './local-prefs';

/** Active UI language: Turkish by default, English on request; mirrored to <html lang>. */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  readonly lang = signal<AppLang>(DEFAULT_LANG);

  /** Restores the stored language; called once at startup. */
  async init(): Promise<void> {
    const stored = readPref(PREF_KEYS.lang);
    await this.apply(isAppLang(stored) ? stored : DEFAULT_LANG);
  }

  /** Typed lookup for code paths; reading `lang` makes callers inside `computed` re-run. */
  t(key: TranslationKey, params?: TranslationParams): string {
    this.lang();
    return this.transloco.translate(key, params);
  }

  /**
   * A count-dependent text: the plural form comes from `Intl.PluralRules` of the active
   * language and `{{count}}` is formatted with its number format (1.250 / 1,250).
   */
  tp(key: PluralKey, count: number, params?: TranslationParams): string {
    const lang = this.lang();
    const form = pluralForm(lang, count);
    return this.transloco.translate(`${key}.${form}`, {
      ...params,
      count: formatNumber(count, lang),
    });
  }

  async set(lang: AppLang): Promise<void> {
    writePref(PREF_KEYS.lang, lang);
    await this.apply(lang);
  }

  private async apply(lang: AppLang): Promise<void> {
    // A destroyed Transloco hands back an empty stream (a start-up initializer that outlives its
    // injector, e.g. a torn-down test module); that is not a language failure, so stop quietly.
    const loaded = await firstValueFrom(this.transloco.load(lang), { defaultValue: null });
    if (loaded === null) return;
    this.transloco.setActiveLang(lang);
    this.lang.set(lang);
    this.document.documentElement.lang = lang;
  }
}
