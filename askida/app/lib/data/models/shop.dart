import 'package:askida/data/models/item.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'shop.freezed.dart';
part 'shop.g.dart';

/// Shop types exactly as the server's `type` values.
enum ShopType { bakery, restaurant, grocery, stationery, cafe, other }

/// Verification states of a shop.
enum VerificationState { pending, verified, rejected }

/// `{lat, lng}` as every shop resource sends it.
@freezed
abstract class GeoPoint with _$GeoPoint {
  const factory({required double lat, required double lng}) = _GeoPoint;

  factory fromJson(Map<String, dynamic> json) => _$GeoPointFromJson(json);
}

/// A row of `GET shops?near=` (public shape with distance).
@freezed
abstract class ShopSummary with _$ShopSummary {
  const factory({
    required String id,
    required String slug,
    required String name,
    @JsonKey(unknownEnumValue: ShopType.other) required ShopType type,
    required String address,
    required String il,
    required String ilce,
    required GeoPoint location,
    required bool isSample,
    String? typeLabel,
    int? distanceM,
    @Default(0) int availableCount,
  }) = _ShopSummary;

  factory fromJson(Map<String, dynamic> json) => _$ShopSummaryFromJson(json);
}

/// One page of `GET shops?near=`: `{data: [...], meta: {radius, next_cursor}}`.
@freezed
abstract class ShopPage with _$ShopPage {
  const factory({
    required List<ShopSummary> shops,
    required int radius,
    String? nextCursor,
  }) = _ShopPage;
}

/// `GET shops/{slug}` answers either the public detail or, for the shop's
/// owner, the owner shape. The owner shape is the one with
/// `verification_state`.
sealed class ShopDetails {
  const new();

  factory fromJson(Map<String, dynamic> json) =>
      json.containsKey('verification_state')
      ? OwnerShopDetails(OwnerShop.fromJson(json))
      : PublicShopDetails(PublicShop.fromJson(json));

  String get id;
  String get slug;
  String get name;
}

final class PublicShopDetails extends ShopDetails {
  const new(this.shop);

  final PublicShop shop;

  @override
  String get id => shop.id;
  @override
  String get slug => shop.slug;
  @override
  String get name => shop.name;
}

final class OwnerShopDetails extends ShopDetails {
  const new(this.shop);

  final OwnerShop shop;

  @override
  String get id => shop.id;
  @override
  String get slug => shop.slug;
  @override
  String get name => shop.name;
}

/// Public shop detail: summary fields (no distance) plus active items.
@freezed
abstract class PublicShop with _$PublicShop {
  const factory({
    required String id,
    required String slug,
    required String name,
    @JsonKey(unknownEnumValue: ShopType.other) required ShopType type,
    required String address,
    required String il,
    required String ilce,
    required GeoPoint location,
    required bool isSample,
    required int availableCount,
    required List<PublicItem> items,
    String? typeLabel,
  }) = _PublicShop;

  factory fromJson(Map<String, dynamic> json) => _$PublicShopFromJson(json);
}

/// Owner shape of `POST shops`, `PATCH shops/{id}` and `GET shops/{slug}`
/// for the owner. Tax number and IBAN arrive masked to the last four.
@freezed
abstract class OwnerShop with _$OwnerShop {
  const factory({
    required String id,
    required String slug,
    required String name,
    @JsonKey(unknownEnumValue: ShopType.other) required ShopType type,
    required String address,
    required String il,
    required String ilce,
    required GeoPoint location,
    required String phone,
    required VerificationState verificationState,
    required bool listedOnWeb,
    String? typeLabel,
    String? taxNumberMasked,
    String? ibanMasked,
    DateTime? verifiedAt,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) = _OwnerShop;

  factory fromJson(Map<String, dynamic> json) => _$OwnerShopFromJson(json);
}

/// The account's role in a shop it belongs to: the owner manages the shop,
/// catalog, documents and payouts; staff redeem codes and read the
/// redemption list.
enum ShopRole { owner, staff }

/// A row of `GET me/shops`: a shop where the calling merchant is owner or
/// staff, with the role. No contact, tax or bank data (those stay on the
/// owner shape of `GET shops/{slug}`).
@freezed
abstract class MyShop with _$MyShop {
  const factory({
    required String id,
    required String slug,
    required String name,
    @JsonKey(unknownEnumValue: ShopType.other) required ShopType type,
    required String il,
    required String ilce,
    required VerificationState verificationState,
    required ShopRole role,
    String? typeLabel,
  }) = _MyShop;

  factory fromJson(Map<String, dynamic> json) => _$MyShopFromJson(json);

  /// The row the listing would send for [shop], seen by its owner.
  factory fromOwnerShop(OwnerShop shop) => MyShop(
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    type: shop.type,
    il: shop.il,
    ilce: shop.ilce,
    verificationState: shop.verificationState,
    role: ShopRole.owner,
    typeLabel: shop.typeLabel,
  );
}

/// Body of `POST shops` and (any subset) `PATCH shops/{id}`. `lat` and `lng`
/// travel together.
@freezed
abstract class ShopDraft with _$ShopDraft {
  @JsonSerializable(includeIfNull: false)
  const factory({
    String? name,
    ShopType? type,
    String? address,
    String? il,
    String? ilce,
    double? lat,
    double? lng,
    String? phone,
    String? taxNumber,
    String? iban,
    bool? listedOnWeb,
  }) = _ShopDraft;

  factory fromJson(Map<String, dynamic> json) => _$ShopDraftFromJson(json);
}
