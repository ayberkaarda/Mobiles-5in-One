import { Pipe, PipeTransform } from '@angular/core';
import { formatFareMinor } from '@inecekvar/domain';

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A fare in kuruş as lira in the given locale ("₺27,50" in `tr-TR`, "₺27.50" in `en-GB`). The
 * range check is the domain's (0 to ₺100 000); the currency is always TRY.
 */
export function formatFare(minor: number, locale = 'tr-TR'): string {
  if (locale === 'tr-TR') return formatFareMinor(minor);
  formatFareMinor(minor);
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'TRY',
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(locale, formatter);
  }
  return formatter.format(minor / 100);
}

/** Renders a fare in kuruş as lira; pair it with the `iv-fare` class for tabular digits. */
@Pipe({ name: 'ivFare' })
export class FarePipe implements PipeTransform {
  transform(minor: number, locale = 'tr-TR'): string {
    return formatFare(minor, locale);
  }
}
