import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  type Language,
  NAMESPACES,
  type Resources,
} from './resources';

/**
 * Creates an initialized i18next instance. All namespaces are bundled, so initialization is
 * synchronous and the first render already has its copy.
 */
export function createI18n(resources: Resources, language: Language): I18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: ['tr', 'en'],
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    fallbackNS: DEFAULT_NAMESPACE,
    initAsync: false,
    returnNull: false,
    returnEmptyString: false,
    // React escapes rendered text; i18next must not escape it a second time.
    interpolation: { escapeValue: false },
  });
  return instance;
}
