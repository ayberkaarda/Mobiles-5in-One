export interface PaymentRow {
  readonly userId: string;
  readonly paid: boolean;
}

export interface PaymentSummary {
  /** `true` when the fee does not split evenly: some shares are 1 kuruş above the base. */
  readonly uneven: boolean;
  /** Sum of the paid shares; a lower bound (by at most `fee mod n` kuruş) while `uneven`. */
  readonly collectedMinor: number;
  /** The share shown on a row: the server's exact own share for the viewer, else the base. */
  readonly shareOf: (userId: string) => number | null;
}

/**
 * What the payments screen can state without knowing which players carry the 1-kuruş remainder
 * (ADR-0036). The contract gives the base share (`sharePerPlayerMinor`) and the viewer's exact
 * share (`myShareMinor`), not a share per row, and documents no participant order; so other rows
 * show the base share, and the collected sum is exact only when the fee splits evenly. Nothing
 * here depends on the order of `rows`.
 */
export function paymentSummary(
  feeTotalMinor: number,
  rows: readonly PaymentRow[],
  baseShareMinor: number | null,
  myUserId: string | null,
  myShareMinor: number | null,
): PaymentSummary {
  const shareOf = (userId: string): number | null =>
    userId === myUserId && myShareMinor !== null ? myShareMinor : baseShareMinor;
  const uneven = rows.length > 0 && feeTotalMinor % rows.length !== 0;
  const collectedMinor = rows.reduce(
    (sum, row) => sum + (row.paid ? (shareOf(row.userId) ?? 0) : 0),
    0,
  );
  return { uneven, collectedMinor, shareOf };
}
