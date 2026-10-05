import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';

/// Locations of the recipient screens. `reserve` and `code` sit under the
/// prefixes the guards protect with the anonymous token.
abstract final class RecipientPaths {
  static final String home = AppMode.recipient.path;

  /// Anonymous entry (attestation); guards add `?from=`.
  static const String start = AppPaths.anonEntry;

  static const String code = '/recipient/code';

  static String shop(String slug) => AppPaths.shop(AppMode.recipient, slug);

  static String reserve(String slug, String itemId) =>
      '/recipient/reserve/${Uri.encodeComponent(slug)}/'
      '${Uri.encodeComponent(itemId)}';
}
