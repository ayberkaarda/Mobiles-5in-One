import { type i18n as I18n } from 'i18next';

import { ApiError } from '../api/errors';

/**
 * Client-side keys of `errors.json` besides the API `ERROR_CODES`: failures the app detects
 * itself, without a problem `code` from the server. No other extra key is allowed in the catalog.
 */
export const CLIENT_ERROR_KEYS = [
  'network_error',
  'offline',
  'server_error',
  'session_expired',
  'timeout',
  'unknown',
] as const;
export type ClientErrorKey = (typeof CLIENT_ERROR_KEYS)[number];

/**
 * Client-side keys with copy but no producer yet. `offline` needs connectivity detection (a
 * network-state dependency), which the app does not have; until then an unreachable server is
 * reported as `network_error` (ADR-0048).
 */
export const CLIENT_ERROR_KEYS_RESERVED: readonly ClientErrorKey[] = ['offline'];

function catalogCopy(i18n: I18n, key: string, options?: Record<string, unknown>): string | null {
  return i18n.exists(`errors:${key}`) ? i18n.t(`errors:${key}`, options) : null;
}

/**
 * Localized message for any failure (product spec §6 item 13). Server prose (`title`,
 * `detail`) is never shown. Order:
 * - transport failures: `errors:network_error`, `errors:timeout`;
 * - a 401 the client produced itself (no session left, no request id): `errors:session_expired`;
 * - a problem `code` with copy: `errors:<code>` (`rate_limited` only with its `Retry-After`
 *   seconds, which its copy interpolates);
 * - any other server failure (5xx): `errors:server_error`;
 * - everything else: `errors:unknown`.
 * While a catalog is missing, the generic copy in `common:error.*` is used instead.
 */
export function errorMessage(i18n: I18n, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return catalogCopy(i18n, 'network_error') ?? i18n.t('common:error.network');
    }
    if (error.kind === 'timeout') {
      return catalogCopy(i18n, 'timeout') ?? i18n.t('common:error.timeout');
    }
    if (error.kind === 'problem' && error.status === 401 && error.requestId === null) {
      const expired = catalogCopy(i18n, 'session_expired');
      if (expired !== null) {
        return expired;
      }
    }
    if (error.code === 'rate_limited') {
      if (error.retryAfterSeconds !== null) {
        const limited = catalogCopy(i18n, 'rate_limited', { seconds: error.retryAfterSeconds });
        if (limited !== null) {
          return limited;
        }
      }
    } else if (error.code !== null) {
      const copy = catalogCopy(i18n, error.code);
      if (copy !== null) {
        return copy;
      }
    }
    if (error.status !== null && error.status >= 500) {
      const serverError = catalogCopy(i18n, 'server_error');
      if (serverError !== null) {
        return serverError;
      }
    }
  }
  return catalogCopy(i18n, 'unknown') ?? i18n.t('common:error.unknown');
}
