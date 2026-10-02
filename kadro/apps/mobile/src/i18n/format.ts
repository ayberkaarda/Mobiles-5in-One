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

/** Amount in kuruş (minor units) as Turkish lira without decimals, e.g. `₺1.500`. */
export function formatLira(minor: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

/** `₺1.200–₺1.800`, a single price, or `null` when the venue lists none. */
export function formatPriceRange(
  minMinor: number | null,
  maxMinor: number | null,
  language: string,
): string | null {
  if (minMinor !== null && maxMinor !== null && minMinor !== maxMinor) {
    return `${formatLira(minMinor, language)}–${formatLira(maxMinor, language)}`;
  }
  const single = minMinor ?? maxMinor;
  return single === null ? null : formatLira(single, language);
}
