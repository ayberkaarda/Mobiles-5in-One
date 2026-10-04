import 'package:askida/data/models/reservation.dart';

/// Reservation (recipient, anon token) and redemption (merchant members).
/// Every method throws `ApiProblem`.
abstract interface class HooksRepository {
  /// `POST hooks/reserve` with the anon token. The returned code is shown
  /// once and kept in memory only.
  Future<Reservation> reserve(String shopId, String itemId);

  /// `POST shops/{id}/redeem` (owner or staff). [code] may be typed loosely;
  /// the server normalises it.
  Future<RedeemResult> redeem(String shopId, String code);

  /// `GET shops/{id}/redemptions?day=YYYY-MM-DD` (today when [day] is null;
  /// days are Europe/Istanbul calendar days).
  Future<RedemptionDay> redemptions(String shopId, {DateTime? day});
}
