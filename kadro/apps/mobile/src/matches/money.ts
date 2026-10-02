/**
 * Amount in kuruş as Turkish lira: whole lira without decimals (`₺1.500`), otherwise with two
 * (`₺233,34`), so a per-player share is shown to the kuruş.
 */
export function formatMinor(minor: number, language: string): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(minor / 100);
}

/**
 * Exact share of every confirmed player (ADR-0036): `floor(fee / n)`, plus 1 kuruş for the first
 * `fee mod n` players in RSVP order. `confirmedIds` must be in that order; the API lists
 * participants in RSVP order (ties by id). The shares always add up to the fee.
 */
export function confirmedShares(
  feeTotalMinor: number,
  confirmedIds: readonly string[],
): Map<string, number> {
  const shares = new Map<string, number>();
  const n = confirmedIds.length;
  if (n === 0) {
    return shares;
  }
  const base = Math.floor(feeTotalMinor / n);
  const remainder = feeTotalMinor % n;
  confirmedIds.forEach((id, index) => shares.set(id, base + (index < remainder ? 1 : 0)));
  return shares;
}
