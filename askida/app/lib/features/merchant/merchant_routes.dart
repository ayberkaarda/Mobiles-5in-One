import 'package:askida/data/models/shop.dart';
import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:askida/features/merchant/merchant_paths.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:askida/features/merchant/presentation/screens/catalog_screen.dart';
import 'package:askida/features/merchant/presentation/screens/documents_screen.dart';
import 'package:askida/features/merchant/presentation/screens/item_form_screen.dart';
import 'package:askida/features/merchant/presentation/screens/payouts_screen.dart';
import 'package:askida/features/merchant/presentation/screens/redeem_screen.dart';
import 'package:askida/features/merchant/presentation/screens/redemptions_screen.dart';
import 'package:askida/features/merchant/presentation/screens/shop_onboarding_screen.dart';
import 'package:askida/features/merchant/presentation/screens/shop_profile_screen.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Staff limits: owner-only screens send staff (and accounts without a
/// shop) back to the merchant home once the shop is known. While it is
/// still loading (a cold start from a push or link) the screen opens and
/// waits for it. The app-wide guard has already made sure a merchant is
/// signed in.
String? ownerOnly(BuildContext context, GoRouterState state) {
  final shop = ProviderScope.containerOf(
    context,
    listen: false,
  ).read(merchantShopProvider);
  if (shop is! AsyncData<MerchantShop?>) return null;
  return shop.value?.role == ShopRole.owner ? null : MerchantPaths.home;
}

/// Screens that need a shop (owner or staff); same loading rule.
String? shopKnown(BuildContext context, GoRouterState state) {
  final shop = ProviderScope.containerOf(
    context,
    listen: false,
  ).read(merchantShopProvider);
  if (shop is! AsyncData<MerchantShop?>) return null;
  return shop.value == null ? MerchantPaths.home : null;
}

/// Child routes of `/merchant` (relative paths, inside the mode shell).
final List<RouteBase> merchantRoutes = <RouteBase>[
  GoRoute(
    path: 'register',
    builder: (context, state) => const ShopOnboardingScreen(),
  ),
  GoRoute(
    path: 'redeem',
    redirect: shopKnown,
    builder: (context, state) => const RedeemScreen(),
  ),
  GoRoute(
    path: 'redemptions',
    redirect: shopKnown,
    builder: (context, state) => const RedemptionsScreen(),
  ),
  GoRoute(
    path: 'catalog',
    redirect: shopKnown,
    builder: (context, state) => const CatalogScreen(),
    routes: [
      GoRoute(
        path: 'new',
        redirect: ownerOnly,
        builder: (context, state) => const ItemFormScreen(),
      ),
      GoRoute(
        path: ':itemId',
        redirect: ownerOnly,
        builder: (context, state) =>
            ItemFormScreen(itemId: state.pathParameters['itemId']),
      ),
    ],
  ),
  GoRoute(
    path: 'payouts',
    redirect: ownerOnly,
    builder: (context, state) => const PayoutsScreen(),
  ),
  GoRoute(
    path: 'documents',
    redirect: ownerOnly,
    builder: (context, state) => const DocumentsScreen(),
  ),
  GoRoute(
    path: 'profile',
    redirect: ownerOnly,
    builder: (context, state) => const ShopProfileScreen(),
  ),
];
