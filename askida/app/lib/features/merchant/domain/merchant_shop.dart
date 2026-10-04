import 'package:askida/data/models/shop.dart';
import 'package:flutter/foundation.dart';

/// What the signed-in merchant account is to its shop. The owner manages
/// the shop, catalog, documents and payouts; staff only redeem codes and
/// see the redemption list (authorization matrix, shop members).
enum MerchantRole { owner, staff }

/// The local pointer to the merchant's shop. The API has no "my shops"
/// listing yet, so the app remembers which shop the account registered or
/// linked, per account. Nothing personal is in it: the shop id, its public
/// slug, its name and the role last seen.
@immutable
class ShopLink {
  const new({
    required this.shopId,
    required this.slug,
    required this.name,
    required this.role,
  });

  /// Parses [encode]'s output; null for anything unreadable.
  static ShopLink? decode(String? raw) {
    if (raw == null) return null;
    final parts = raw.split('\n');
    if (parts.length != 4) return null;
    final role = MerchantRole.values.asNameMap()[parts[3]];
    if (role == null || parts[0].isEmpty || parts[1].isEmpty) return null;
    return ShopLink(
      shopId: parts[0],
      slug: parts[1],
      name: parts[2],
      role: role,
    );
  }

  final String shopId;
  final String slug;
  final String name;
  final MerchantRole role;

  /// One line per field (names never contain line breaks: the server trims
  /// and the form refuses them).
  String encode() =>
      [shopId, slug, name.replaceAll('\n', ' '), role.name].join('\n');

  @override
  bool operator ==(Object other) =>
      other is ShopLink &&
      other.shopId == shopId &&
      other.slug == slug &&
      other.name == name &&
      other.role == role;

  @override
  int get hashCode => Object.hash(shopId, slug, name, role);
}

/// The merchant's shop as the screens use it.
@immutable
class MerchantShop {
  const new({required this.link, this.owner, this.offline = false});

  final ShopLink link;

  /// The owner shape (verification state, masked identifiers). Null for
  /// staff, and when the shop could not be loaded (offline).
  final OwnerShop? owner;

  /// The shop came from the local pointer only: the server was unreachable.
  final bool offline;

  String get id => link.shopId;
  String get slug => link.slug;
  String get name => owner?.name ?? link.name;
  MerchantRole get role => link.role;
  bool get isOwner => role == MerchantRole.owner;

  /// Known only for the owner shape.
  VerificationState? get verification => owner?.verificationState;

  @override
  bool operator ==(Object other) =>
      other is MerchantShop &&
      other.link == link &&
      other.owner == owner &&
      other.offline == offline;

  @override
  int get hashCode => Object.hash(link, owner, offline);
}
