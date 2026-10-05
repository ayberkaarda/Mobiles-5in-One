import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:intl/intl.dart';

/// Distance to a shop as people read it: `450 m`, `1,2 km`, `12 km`.
abstract final class Distance {
  /// Under 1 km the metres are rounded to 10 (at least 10 m); from 1 km one
  /// decimal with the locale's separator; from 10 km whole kilometres.
  static String format(AppLocalizations l10n, int meters) {
    if (meters < 995) {
      final rounded = ((meters / 10).round() * 10).clamp(10, 990);
      return l10n.shopDistanceMeters(rounded);
    }
    final km = meters / 1000;
    final pattern = km < 9.95 ? '0.0' : '0';
    return l10n.shopDistanceKm(
      NumberFormat(pattern, l10n.localeName).format(km),
    );
  }
}
