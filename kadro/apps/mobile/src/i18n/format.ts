/**
 * Locale-aware formatting for list rows. Hermes ships `Intl.DateTimeFormat` and
 * `Intl.NumberFormat`; times are shown in the device time zone.
 */
export function formatDateTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Lira sign, written after the amount ("1.500 ₺", design direction §4.10). */
export const LIRA_SIGN = '₺';

/** No-break space between the amount and the sign, so a price never wraps apart. */
const NBSP = '\u00A0';

/**
 * Amount in kuruş as a plain number in the reader's language: whole lira without decimals
 * (`1.500`), otherwise with two (`333,34`), so a per-player share is shown to the kuruş.
 */
function formatAmount(minor: number, language: string): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
}

/**
 * The one price formatter of the app: amount in kuruş as Turkish lira, amount first and the sign
 * after it (`1.500 ₺`, `333,34 ₺`). Store prices on the paywall come preformatted from the store.
 */
export function formatLira(minor: number, language: string): string {
  return `${formatAmount(minor, language)}${NBSP}${LIRA_SIGN}`;
}

/** `1.200–1.800 ₺` (one sign for the range), a single price, or `null` when the venue lists none. */
export function formatPriceRange(
  minMinor: number | null,
  maxMinor: number | null,
  language: string,
): string | null {
  if (minMinor !== null && maxMinor !== null && minMinor !== maxMinor) {
    return `${formatAmount(minMinor, language)}–${formatLira(maxMinor, language)}`;
  }
  const single = minMinor ?? maxMinor;
  return single === null ? null : formatLira(single, language);
}
