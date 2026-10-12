import { TranslocoTestingModule } from '@jsverse/transloco';
import { en } from '../i18n/en';
import { tr } from '../i18n/tr';

/** Transloco with both languages preloaded, Turkish active, for component tests. */
export function i18nTesting() {
  return TranslocoTestingModule.forRoot({
    langs: { tr, en },
    translocoConfig: {
      availableLangs: ['tr', 'en'],
      defaultLang: 'tr',
      fallbackLang: 'tr',
      reRenderOnLangChange: true,
    },
    preloadLangs: true,
  });
}
