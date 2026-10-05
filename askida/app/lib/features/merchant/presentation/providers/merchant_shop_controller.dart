import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Failing loads are shown with a retry button instead of retried in the
/// background.
Duration? noRetry(int retryCount, Object error) => null;

/// The signed-in merchant's shop, found through `GET me/shops` on every
/// load (nothing is kept on the device): null when nobody (or a donor) is
/// signed in, or when the account is not owner or staff of any shop yet.
/// When the account belongs to several shops, the first one it owns is
/// used, otherwise the first one listed (the server orders them by name).
final merchantShopProvider =
    AsyncNotifierProvider<MerchantShopController, MerchantShop?>(
      MerchantShopController.new,
      retry: noRetry,
    );

class MerchantShopController extends AsyncNotifier<MerchantShop?> {
  @override
  Future<MerchantShop?> build() async {
    final merchantId = ref.watch(
      sessionProvider.select((s) => s.isMerchant ? s.user!.id : null),
    );
    if (merchantId == null) return null;
    final mine = await ref.read(shopsRepositoryProvider).myShops();
    if (mine.isEmpty) return null;
    final pick = mine.firstWhere(
      (shop) => shop.role == ShopRole.owner,
      orElse: () => mine.first,
    );
    return pick.role == ShopRole.owner
        ? await _withOwnerShape(pick)
        : _staff(pick);
  }

  static MerchantShop _staff(MyShop mine) => MerchantShop(mine: mine);

  static MerchantShop _owner(OwnerShop shop) =>
      MerchantShop(mine: MyShop.fromOwnerShop(shop), owner: shop);

  /// Owners also get the owner shape (masked identifiers, contact).
  Future<MerchantShop> _withOwnerShape(MyShop mine) async {
    try {
      final details = await ref.read(shopsRepositoryProvider).bySlug(mine.slug);
      return switch (details) {
        OwnerShopDetails(:final shop) => _owner(shop),
        // The server answers its owner with the owner shape; a public one
        // for an owner comes from the offline cache.
        PublicShopDetails() => MerchantShop(mine: mine, offline: true),
      };
    } on ApiProblem catch (problem) {
      if (problem.code.startsWith('network.')) {
        return MerchantShop(mine: mine, offline: true);
      }
      rethrow;
    }
  }

  void _requireMerchant() {
    if (!ref.read(sessionProvider).isMerchant) {
      throw const ApiProblem(code: 'auth.unauthenticated', status: 401);
    }
  }

  /// The account just registered [shop] (`POST shops`).
  Future<MerchantShop> registered(OwnerShop shop) async {
    _requireMerchant();
    final merchantShop = _owner(shop);
    state = AsyncData(merchantShop);
    return merchantShop;
  }

  /// The owner edited the shop (`PATCH shops/{id}`).
  Future<void> ownerUpdated(OwnerShop shop) async {
    _requireMerchant();
    state = AsyncData(_owner(shop));
  }

  /// Loads the shop again (verification state or membership may have
  /// changed).
  Future<void> reload() async {
    ref.invalidateSelf();
    await future;
  }
}
