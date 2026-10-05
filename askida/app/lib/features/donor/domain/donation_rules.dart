import 'dart:math' as math;

/// Donation limits of the Phase 3 contract. The server recomputes the
/// amount and enforces every limit; the app uses them to keep the form
/// honest and explain a limit before the payment starts.
abstract final class DonationRules {
  static const int minQty = 1;
  static const int maxQty = 20;

  /// Per payment: ₺2 000 in kuruş.
  static const int perTransactionCapMinor = 200000;

  /// Per donor and Istanbul day (paid plus recent unpaid): ₺5 000.
  static const int perDayCapMinor = 500000;

  /// Highest quantity one payment of [unitPriceMinor] allows (at least 1
  /// when a single unit fits, 0 when even one unit is over the cap).
  static int maxQtyFor(int unitPriceMinor) {
    if (unitPriceMinor <= 0) return maxQty;
    return math.min(maxQty, perTransactionCapMinor ~/ unitPriceMinor);
  }

  /// Amount the server will charge (shown before paying; the server's own
  /// computation is the one that counts).
  static int totalMinor(int unitPriceMinor, int qty) => unitPriceMinor * qty;
}

/// Why the quantity cannot go higher, for the hint under the stepper.
enum QtyLimit {
  /// Nothing stops a higher quantity.
  none,

  /// The 20-unit maximum of one donation.
  maxUnits,

  /// The ₺2 000 limit of one payment.
  transactionCap,
}

QtyLimit qtyLimitFor(int unitPriceMinor, int qty) {
  final max = DonationRules.maxQtyFor(unitPriceMinor);
  if (qty < max) return QtyLimit.none;
  return max < DonationRules.maxQty
      ? QtyLimit.transactionCap
      : QtyLimit.maxUnits;
}
