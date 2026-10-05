import 'package:askida/data/models/item.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'reservation.freezed.dart';
part 'reservation.g.dart';

/// `POST hooks/reserve` (201): the plaintext code is shown once and lives
/// only in memory on the device.
@freezed
abstract class Reservation with _$Reservation {
  const factory({
    required String code,
    required DateTime expiresAt,
    required ReservationShop shop,
    required ReservationItem item,
  }) = _Reservation;

  factory fromJson(Map<String, dynamic> json) => _$ReservationFromJson(json);
}

@freezed
abstract class ReservationShop with _$ReservationShop {
  const factory({required String id, required String name}) = _ReservationShop;

  factory fromJson(Map<String, dynamic> json) =>
      _$ReservationShopFromJson(json);
}

@freezed
abstract class ReservationItem with _$ReservationItem {
  const factory({
    required String name,
    @JsonKey(unknownEnumValue: ItemCategory.diger)
    required ItemCategory category,
  }) = _ReservationItem;

  factory fromJson(Map<String, dynamic> json) =>
      _$ReservationItemFromJson(json);
}

/// `{name}`: the only item detail redemption answers carry.
@freezed
abstract class NamedItem with _$NamedItem {
  const factory({required String name}) = _NamedItem;

  factory fromJson(Map<String, dynamic> json) => _$NamedItemFromJson(json);
}

/// `POST shops/{id}/redeem`: `{message: "1 ekmek verildi", item, redeemed_at}`.
/// No recipient data exists in it.
@freezed
abstract class RedeemResult with _$RedeemResult {
  const factory({
    required String message,
    required NamedItem item,
    required DateTime redeemedAt,
  }) = _RedeemResult;

  factory fromJson(Map<String, dynamic> json) => _$RedeemResultFromJson(json);
}

/// A row of `GET shops/{id}/redemptions?day=`.
@freezed
abstract class Redemption with _$Redemption {
  const factory({
    required NamedItem item,
    required DateTime redeemedAt,

    /// `owner` or `staff`; null when the member left the shop.
    String? redeemedByRole,
  }) = _Redemption;

  factory fromJson(Map<String, dynamic> json) => _$RedemptionFromJson(json);
}

/// The whole redemptions answer: `{data: [...], meta: {day, count}}`.
@freezed
abstract class RedemptionDay with _$RedemptionDay {
  const factory({
    /// Calendar day in Europe/Istanbul, `YYYY-MM-DD`.
    required String day,
    required int count,
    required List<Redemption> redemptions,
  }) = _RedemptionDay;
}
