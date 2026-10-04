import 'package:freezed_annotation/freezed_annotation.dart';

part 'item.freezed.dart';
part 'item.g.dart';

/// Item categories exactly as the server's `category` values.
@JsonEnum()
enum ItemCategory { ekmek, corba, yemek, kirtasiye, bebek, diger }

/// An item as the public shop detail lists it (active items only).
@freezed
abstract class PublicItem with _$PublicItem {
  const factory({
    required String id,
    required String name,
    @JsonKey(unknownEnumValue: ItemCategory.diger)
    required ItemCategory category,
    required String categoryLabel,
    required int priceMinor,
    required String currency,
    required int availableCount,
  }) = _PublicItem;

  factory fromJson(Map<String, dynamic> json) => _$PublicItemFromJson(json);
}

/// An item as the owner catalog returns it (includes inactive items).
@freezed
abstract class Item with _$Item {
  const factory({
    required String id,
    required String shopId,
    required String name,
    @JsonKey(unknownEnumValue: ItemCategory.diger)
    required ItemCategory category,
    required String categoryLabel,
    required int priceMinor,
    required String currency,
    required int dailyCap,
    required bool active,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) = _Item;

  factory fromJson(Map<String, dynamic> json) => _$ItemFromJson(json);
}

/// Body of `POST shops/{id}/items` and (every field optional) `PATCH`.
/// `currency`, `id` and `shop_id` are refused by the server, so they are not
/// here.
@freezed
abstract class ItemDraft with _$ItemDraft {
  @JsonSerializable(includeIfNull: false)
  const factory({
    String? name,
    ItemCategory? category,
    int? priceMinor,
    int? dailyCap,
    bool? active,
  }) = _ItemDraft;

  factory fromJson(Map<String, dynamic> json) => _$ItemDraftFromJson(json);
}
