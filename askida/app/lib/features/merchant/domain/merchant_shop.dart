import 'package:askida/data/models/shop.dart';
import 'package:flutter/foundation.dart';

/// The merchant's shop as the screens use it: the row of `GET me/shops`
/// (role and verification state from the server's membership), plus the
/// owner shape for owners.
@immutable
class MerchantShop {
  const new({required this.mine, this.owner, this.offline = false});

  /// The shop as the account's shop listing sent it.
  final MyShop mine;

  /// The owner shape (masked identifiers, contact). Null for staff, and
  /// when it could not be loaded (offline).
  final OwnerShop? owner;

  /// The owner shape could not be loaded: the server was unreachable.
  final bool offline;

  String get id => mine.id;
  String get slug => mine.slug;
  String get name => owner?.name ?? mine.name;
  ShopRole get role => mine.role;
  bool get isOwner => role == ShopRole.owner;

  /// The latest known verification state (owner shape first).
  VerificationState get verification =>
      owner?.verificationState ?? mine.verificationState;

  @override
  bool operator ==(Object other) =>
      other is MerchantShop &&
      other.mine == mine &&
      other.owner == owner &&
      other.offline == offline;

  @override
  int get hashCode => Object.hash(mine, owner, offline);
}
