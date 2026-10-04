import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/merchant/data/merchant_shop_store.dart';
import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Failing loads are shown with a retry button instead of retried in the
/// background.
Duration? noRetry(int retryCount, Object error) => null;

/// A staff link was asked for a shop the account is not a member of.
class NotShopMember implements Exception {
  const new();
}

/// The signed-in merchant's shop: null when nobody (or a donor) is signed
/// in, or when the account has not registered or linked a shop yet.
final merchantShopProvider =
    AsyncNotifierProvider<MerchantShopController, MerchantShop?>(
      MerchantShopController.new,
      retry: noRetry,
    );

class MerchantShopController extends AsyncNotifier<MerchantShop?> {
  @override
  Future<MerchantShop?> build() async {
    final userId = ref.watch(
      sessionProvider.select((s) => s.isMerchant ? s.user!.id : null),
    );
    if (userId == null) return null;
    final link = await ref.watch(merchantShopStoreProvider).read(userId);
    if (link == null) return null;
    return await _load(userId, link);
  }

  Future<MerchantShop?> _load(String userId, ShopLink link) async {
    final store = ref.read(merchantShopStoreProvider);
    try {
      final details = await ref.read(shopsRepositoryProvider).bySlug(link.slug);
      final shop = _fromDetails(details);
      if (shop.link != link) await store.write(userId, shop.link);
      return shop;
    } on ApiProblem catch (problem) {
      // The shop closed or the account left it: forget the pointer.
      if (problem.code == 'not_found' || problem.code == 'forbidden') {
        await store.clear(userId);
        return null;
      }
      // Offline: keep working from the pointer (scanner, log).
      if (problem.code.startsWith('network.')) {
        return MerchantShop(link: link, offline: true);
      }
      rethrow;
    }
  }

  static MerchantShop _fromDetails(ShopDetails details) => switch (details) {
    OwnerShopDetails(:final shop) => MerchantShop(
      link: ShopLink(
        shopId: shop.id,
        slug: shop.slug,
        name: shop.name,
        role: MerchantRole.owner,
      ),
      owner: shop,
    ),
    PublicShopDetails(:final shop) => MerchantShop(
      link: ShopLink(
        shopId: shop.id,
        slug: shop.slug,
        name: shop.name,
        role: MerchantRole.staff,
      ),
    ),
  };

  String _userId() {
    final session = ref.read(sessionProvider);
    if (!session.isMerchant) {
      throw const ApiProblem(code: 'auth.unauthenticated', status: 401);
    }
    return session.user!.id;
  }

  /// The account just registered [shop] (`POST shops`).
  Future<MerchantShop> registered(OwnerShop shop) async {
    final userId = _userId();
    final merchantShop = _fromDetails(OwnerShopDetails(shop));
    await ref.read(merchantShopStoreProvider).write(userId, merchantShop.link);
    state = AsyncData(merchantShop);
    return merchantShop;
  }

  /// The owner edited the shop (`PATCH shops/{id}`).
  Future<void> ownerUpdated(OwnerShop shop) async {
    final userId = _userId();
    final merchantShop = _fromDetails(OwnerShopDetails(shop));
    await ref.read(merchantShopStoreProvider).write(userId, merchantShop.link);
    state = AsyncData(merchantShop);
  }

  /// Links the shop at [input] (a slug or a `askida.app/dukkan/<slug>`
  /// address). Owners get their shop back; staff membership is proven by
  /// reading the catalog, which only members may do. Throws [ApiProblem]
  /// or [NotShopMember].
  Future<MerchantShop> link(String input) async {
    final userId = _userId();
    final slug = slugFromInput(input);
    if (slug == null) {
      throw const ApiProblem(code: 'not_found', status: 404);
    }
    final shops = ref.read(shopsRepositoryProvider);
    final shop = _fromDetails(await shops.bySlug(slug));
    if (!shop.isOwner) {
      try {
        await shops.items(shop.id);
      } on ApiProblem catch (problem) {
        if (problem.code == 'forbidden' || problem.code == 'not_found') {
          throw const NotShopMember();
        }
        rethrow;
      }
    }
    await ref.read(merchantShopStoreProvider).write(userId, shop.link);
    state = AsyncData(shop);
    return shop;
  }

  /// Forgets the shop on this device (the shop itself is untouched).
  Future<void> unlink() async {
    final userId = _userId();
    await ref.read(merchantShopStoreProvider).clear(userId);
    state = const AsyncData(null);
  }

  /// Loads the shop again (verification state may have changed).
  Future<void> reload() async {
    ref.invalidateSelf();
    await future;
  }
}

/// `ornek-firin`, `askida.app/dukkan/ornek-firin` or
/// `https://askida.app/dukkan/ornek-firin/` -> `ornek-firin`; null when
/// nothing slug-shaped is there.
String? slugFromInput(String input) {
  var text = input.trim();
  final marker = text.indexOf('/dukkan/');
  if (marker >= 0) text = text.substring(marker + '/dukkan/'.length);
  text = text.split(RegExp('[/?#]')).first;
  final slug = text.replaceAll(RegExp(r'\s'), '');
  return RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$').hasMatch(slug) ? slug : null;
}
