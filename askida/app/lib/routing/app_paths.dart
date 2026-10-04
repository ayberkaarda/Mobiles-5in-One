import 'package:askida/routing/app_mode.dart';

/// Locations every feature agrees on. Mode features add child routes under
/// their mode path (`/recipient/...`, `/donor/...`, `/merchant/...`); auth and
/// settings are top level. Guards and deep links rely on these prefixes.
abstract final class AppPaths {
  /// Auth entry (donor worker). Guards add `?from=<location>`.
  static const auth = '/auth';

  /// Settings (donor worker).
  static const settings = '/settings';

  /// Recipient onboarding + attestation (recipient worker). Anon guards add
  /// `?from=<location>`.
  static const anonEntry = '/recipient/start';

  /// Screens that need the anonymous device token.
  static const anonOnlyPrefixes = ['/recipient/reserve', '/recipient/code'];

  /// Screens that need a signed-in donor.
  static const donorOnlyPrefixes = ['/donor/donate', '/donor/donation'];

  /// Everything below the merchant home needs a signed-in merchant.
  static const merchantOnlyPrefix = '/merchant/';

  /// Donation history (donor).
  static const donorDonations = '/donor/donations';

  /// Today's redemptions (merchant).
  static const merchantRedemptions = '/merchant/redemptions';

  /// Shop detail in [mode]; merchant mode opens the donor view of a shop.
  static String shop(AppMode mode, String slug) {
    final base = mode == AppMode.merchant ? AppMode.donor.path : mode.path;
    return '$base/shop/${Uri.encodeComponent(slug)}';
  }

  /// Donation receipt, optionally with the checkout `status` from the
  /// payment return link.
  static String donation(String id, {String? status}) => Uri(
    path: '/donor/donation/${Uri.encodeComponent(id)}',
    queryParameters: status == null ? null : {'status': status},
  ).toString();

  /// The mode a location belongs to, or null for top-level screens.
  static AppMode? modeOf(String path) {
    for (final mode in AppMode.values) {
      if (path == mode.path || path.startsWith('${mode.path}/')) return mode;
    }
    return null;
  }
}
