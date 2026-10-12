import { TranslocoTestingModule } from '@jsverse/transloco';
import { contribEn } from '../i18n/contrib.en';
import { contribTr } from '../i18n/contrib.tr';
import { en } from '../i18n/en';
import { tr } from '../i18n/tr';

/** Transloco with both languages (and the contributor copy) preloaded, Turkish active. */
export function i18nTesting() {
  return TranslocoTestingModule.forRoot({
    langs: { tr: { ...tr, ...contribTr }, en: { ...en, ...contribEn } },
    translocoConfig: {
      availableLangs: ['tr', 'en'],
      defaultLang: 'tr',
      fallbackLang: 'tr',
      reRenderOnLangChange: true,
    },
    preloadLangs: true,
  });
}
