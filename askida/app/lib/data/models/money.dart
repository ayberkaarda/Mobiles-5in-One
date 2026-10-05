import 'dart:ui' show FontFeature;

import 'package:intl/intl.dart';

/// Money in integer minor units (kuruş, TRY). Never a double on the wire or
/// in state; only formatting turns it into text.
extension type const Money(int minor) {
  /// Figure features the amount should be drawn with (widgets pick the
  /// font; this is the hint so columns of amounts line up).
  static const List<FontFeature> tabularFigures = [
    FontFeature.tabularFigures(),
    FontFeature.liningFigures(),
  ];

  /// `₺45,00` and `₺1.234,50` in Turkish, `₺45.00` and `₺1,234.50` in
  /// English. Built from integers, so no rounding can occur.
  String format([String locale = 'tr']) {
    final symbols = NumberFormat.decimalPattern(locale).symbols;
    final negative = minor < 0;
    final abs = minor.abs();
    final whole = NumberFormat('#,##0', locale).format(abs ~/ 100);
    final cents = (abs % 100).toString().padLeft(2, '0');
    return '${negative ? '-' : ''}₺$whole${symbols.DECIMAL_SEP}$cents';
  }
}
