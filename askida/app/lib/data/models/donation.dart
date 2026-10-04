import 'package:freezed_annotation/freezed_annotation.dart';

part 'donation.freezed.dart';
part 'donation.g.dart';

/// `POST donations`: `{donation_id, checkout_url}`.
@freezed
abstract class DonationCheckout with _$DonationCheckout {
  const factory({required String donationId, required String checkoutUrl}) =
      _DonationCheckout;

  factory fromJson(Map<String, dynamic> json) =>
      _$DonationCheckoutFromJson(json);
}

enum DonationStatus { initiated, paid, failed, refunded }

/// A donation of the signed-in donor (`GET donations`, `GET donations/{id}`).
/// Amounts are integer kuruş computed by the server.
@freezed
abstract class Donation with _$Donation {
  const factory({
    required String id,
    required String shopId,
    required String itemId,
    required int qty,
    required int amountMinor,
    required DonationStatus status,
    int? commissionMinor,
    String? currency,
    String? shopName,
    String? itemName,
    DateTime? paidAt,
    DateTime? createdAt,
  }) = _Donation;

  factory fromJson(Map<String, dynamic> json) => _$DonationFromJson(json);
}

/// One cursor page of `GET donations`.
@freezed
abstract class DonationPage with _$DonationPage {
  const factory({required List<Donation> donations, String? nextCursor}) =
      _DonationPage;
}
