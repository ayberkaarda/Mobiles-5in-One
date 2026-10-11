/** Largest accepted fare in minor units (kuruş), matching the API bound of spec section 6.6. */
export const MAX_FARE_MINOR = 100_000_00;

const formatter = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats a fare stored in kuruş as Turkish lira text, for example 2750 -> "₺27,50". */
export function formatFareMinor(minor: number): string {
  if (!Number.isInteger(minor) || minor < 0 || minor > MAX_FARE_MINOR) {
    throw new RangeError(`fare must be an integer between 0 and ${MAX_FARE_MINOR} kuruş`);
  }
  return formatter.format(minor / 100);
}
