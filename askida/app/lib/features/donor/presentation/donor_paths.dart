import 'package:askida/routing/app_mode.dart';

/// Donor locations below `/donor` that only this feature builds. The
/// shared ones (shop, donation, donation history) are in `AppPaths`.
abstract final class DonorPaths {
  /// The donation form for one item of a shop (guarded: donors only).
  static String donate({required String shopSlug, required String itemId}) =>
      Uri(
        path: '${AppMode.donor.path}/donate',
        queryParameters: {'shop': shopSlug, 'item': itemId},
      ).toString();
}
