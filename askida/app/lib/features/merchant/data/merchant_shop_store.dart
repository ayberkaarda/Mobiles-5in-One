import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Remembers which shop each merchant account works with, until the API
/// offers a listing of the account's shops.
abstract interface class MerchantShopStore {
  Future<ShopLink?> read(String userId);
  Future<void> write(String userId, ShopLink link);
  Future<void> clear(String userId);
}

/// [MerchantShopStore] in the platform keystore/keychain, next to (but
/// separate from) the tokens. A missing or failing store reads as "no
/// shop": the merchant can link the shop again.
class SecureMerchantShopStore implements MerchantShopStore {
  new({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(storageNamespace: 'askida_merchant'),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  final FlutterSecureStorage _storage;

  static String keyFor(String userId) => 'askida.merchant_shop.$userId';

  @override
  Future<ShopLink?> read(String userId) async {
    try {
      return ShopLink.decode(await _storage.read(key: keyFor(userId)));
    } on Object {
      return null;
    }
  }

  @override
  Future<void> write(String userId, ShopLink link) =>
      _storage.write(key: keyFor(userId), value: link.encode());

  @override
  Future<void> clear(String userId) async {
    try {
      await _storage.delete(key: keyFor(userId));
    } on Object {
      // Nothing stored or no store: there is nothing to clear.
    }
  }
}

/// In-memory [MerchantShopStore] (tests and previews).
class InMemoryMerchantShopStore implements MerchantShopStore {
  final Map<String, ShopLink> links = {};

  @override
  Future<ShopLink?> read(String userId) async => links[userId];

  @override
  Future<void> write(String userId, ShopLink link) async =>
      links[userId] = link;

  @override
  Future<void> clear(String userId) async => links.remove(userId);
}

final merchantShopStoreProvider = Provider<MerchantShopStore>(
  (ref) => SecureMerchantShopStore(),
);
