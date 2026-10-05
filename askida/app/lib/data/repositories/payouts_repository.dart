import 'package:askida/data/models/payout.dart';

/// Merchant payout ledger (Phase 3 API). Throws `ApiProblem`.
abstract interface class PayoutsRepository {
  /// `GET shops/{id}/payouts` (owner only; staff get `forbidden`).
  Future<List<Payout>> payouts(String shopId);
}
