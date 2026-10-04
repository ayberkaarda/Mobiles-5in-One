import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';

/// Locations of the merchant screens (children of `/merchant`). Everything
/// below the merchant home needs a signed-in merchant (route guard); the
/// owner-only ones also send staff back to the home.
abstract final class MerchantPaths {
  static final String home = AppMode.merchant.path;
  static final String register = '$home/register';
  static final String link = '$home/link';
  static final String profile = '$home/profile';
  static final String documents = '$home/documents';
  static final String catalog = '$home/catalog';
  static final String catalogNew = '$catalog/new';
  static final String redeem = '$home/redeem';
  static const String redemptions = AppPaths.merchantRedemptions;
  static final String payouts = '$home/payouts';

  static String catalogItem(String itemId) =>
      '$catalog/${Uri.encodeComponent(itemId)}';
}
