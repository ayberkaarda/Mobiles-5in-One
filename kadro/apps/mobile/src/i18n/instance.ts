import { getLocales } from 'expo-localization';

import { bundledResources } from './bundled';
import { createI18n } from './create-i18n';
import { pickLanguage } from './resources';

/** The app-wide i18next instance, in the device language when it is Turkish or English. */
export const i18n = createI18n(
  bundledResources(),
  pickLanguage(getLocales().map((locale) => locale.languageCode)),
);
