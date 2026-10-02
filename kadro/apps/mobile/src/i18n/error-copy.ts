import { type i18n as I18n } from 'i18next';

import { ApiError } from '../api/errors';

/**
 * Localized message for any failure. A problem `code` maps to `errors:<code>` (product spec §6
 * item 13); a code without copy, a transport failure or a non-API error falls back to generic
 * copy in `common`. Server prose (`title`, `detail`) is never shown.
 */
export function errorMessage(i18n: I18n, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return i18n.t('common:error.network');
    }
    if (error.kind === 'timeout') {
      return i18n.t('common:error.timeout');
    }
    if (error.code !== null && i18n.exists(`errors:${error.code}`)) {
      return i18n.t(`errors:${error.code}`);
    }
  }
  return i18n.t('common:error.unknown');
}
