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

  /// The API nests the shop and the item (`shop: {id, name}`,
  /// `item: {id, name}`, openapi `Donation`); the model keeps them flat.
  factory fromJson(Map<String, dynamic> json) =>
      _$DonationFromJson(_flattenRefs(json));
}

Map<String, dynamic> _flattenRefs(Map<String, dynamic> json) {
  final shop = json['shop'];
  final item = json['item'];
  return {
    for (final entry in json.entries)
      if (entry.key != 'shop' && entry.key != 'item') entry.key: entry.value,
    if (shop is Map) ...{'shop_id': shop['id'], 'shop_name': shop['name']},
    if (item is Map) ...{'item_id': item['id'], 'item_name': item['name']},
  };
}

/// One cursor page of `GET donations`.
@freezed
abstract class DonationPage with _$DonationPage {
  const factory({required List<Donation> donations, String? nextCursor}) =
      _DonationPage;
}
