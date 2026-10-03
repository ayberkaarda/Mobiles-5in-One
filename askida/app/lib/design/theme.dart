import 'package:flutter/material.dart';

/// Brand palette from the product specification (section 2).
///
/// Kept in one place until `brand/tokens.json` lands; the theme below only
/// reads from here.
abstract final class AskidaPalette {
  /// Ekmek Kabuğu, primary.
  static const ekmekKabugu = Color(0xFFC8763A);

  /// Zeytin, secondary.
  static const zeytin = Color(0xFF4E6B3A);

  /// Un Beyazı, surface.
  static const unBeyazi = Color(0xFFFBF8F3);

  /// Kömür, text.
  static const komur = Color(0xFF2B2B2B);

  /// Gün Batımı, accent.
  static const gunBatimi = Color(0xFFE9A23B);

  /// Deniz, info.
  static const deniz = Color(0xFF2C6E91);

  /// Nar, danger.
  static const nar = Color(0xFFB23A48);
}

abstract final class AskidaTheme {
  static ThemeData light() => _build(
    const ColorScheme(
      brightness: Brightness.light,
      primary: AskidaPalette.ekmekKabugu,
      onPrimary: AskidaPalette.komur,
      secondary: AskidaPalette.zeytin,
      onSecondary: AskidaPalette.unBeyazi,
      tertiary: AskidaPalette.gunBatimi,
      onTertiary: AskidaPalette.komur,
      error: AskidaPalette.nar,
      onError: AskidaPalette.unBeyazi,
      surface: AskidaPalette.unBeyazi,
      onSurface: AskidaPalette.komur,
    ),
  );

  static ThemeData dark() => _build(
    const ColorScheme(
      brightness: Brightness.dark,
      primary: AskidaPalette.ekmekKabugu,
      onPrimary: AskidaPalette.komur,
      secondary: AskidaPalette.zeytin,
      onSecondary: AskidaPalette.unBeyazi,
      tertiary: AskidaPalette.gunBatimi,
      onTertiary: AskidaPalette.komur,
      error: AskidaPalette.nar,
      onError: AskidaPalette.unBeyazi,
      surface: AskidaPalette.komur,
      onSurface: AskidaPalette.unBeyazi,
    ),
  );

  static ThemeData _build(ColorScheme scheme) => ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surface,
      indicatorColor: scheme.primary.withValues(alpha: 0.24),
    ),
  );
}
