import { EnvironmentProviders, Injectable, isDevMode, Pipe, PipeTransform } from '@angular/core';
import {
  provideTransloco,
  Translation as TranslocoTranslation,
  TranslocoLoader,
  TranslocoPipe,
} from '@jsverse/transloco';
import { from, Observable, of } from 'rxjs';
import { tr } from './tr';
import {
  AVAILABLE_LANGS,
  AppLang,
  DEFAULT_LANG,
  TranslationKey,
  TranslationParams,
} from './translation';

/**
 * Turkish ships in the main bundle; English is a lazy chunk fetched on first use, together with
 * its contributor copy. The Turkish contributor copy is merged in by `contributorCopy`.
 */
@Injectable({ providedIn: 'root' })
export class AppTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<TranslocoTranslation> {
    if ((lang as AppLang) === 'en') {
      return from(
        Promise.all([import('./en'), import('./contrib.en')]).then(
          ([main, contrib]) => ({ ...main.en, ...contrib.contribEn }) as TranslocoTranslation,
        ),
      );
    }
    return of(tr as TranslocoTranslation);
  }
}

export function provideAppI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: [...AVAILABLE_LANGS],
      defaultLang: DEFAULT_LANG,
      fallbackLang: DEFAULT_LANG,
      reRenderOnLangChange: true,
      missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
      prodMode: !isDevMode(),
    },
    loader: AppTranslationLoader,
  });
}

/**
 * Typed wrapper around Transloco's pipe: `{{ 'tabs.search' | t }}`. With strict templates an
 * unknown key is a compile error.
 */
@Pipe({ name: 't', pure: false })
export class TPipe extends TranslocoPipe implements PipeTransform {
  override transform(key: TranslationKey, params?: TranslationParams): string {
    return super.transform(key, params);
  }
}
