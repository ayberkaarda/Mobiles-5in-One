import 'package:flutter/material.dart';

/// The app type scale from `brand/tokens.json` (`typography.scale.*.app`).
///
/// One family in two optical sizes: [displayFamily] only at 22 pt and above,
/// [textFamily] for everything smaller. Weights are 400, 600 and 700 only.
/// Tabular and lining figures are set on [numeral], [numeralXL] and [code]
/// and nowhere else. Styles carry no colour; the theme applies it.
abstract final class AskidaTypography {
  static const String displayFamily = 'BricolageDisplay';
  static const String textFamily = 'BricolageText';

  static const List<FontFeature> _figures = [
    FontFeature.tabularFigures(),
    FontFeature.liningFigures(),
  ];

  static TextStyle _style({
    required String family,
    required double size,
    required double lineHeight,
    required FontWeight weight,
    double tracking = 0,
    List<FontFeature>? features,
  }) => TextStyle(
    fontFamily: family,
    fontSize: size,
    height: lineHeight / size,
    fontWeight: weight,
    letterSpacing: tracking * size,
    fontFeatures: features,
    leadingDistribution: TextLeadingDistribution.even,
  );

  static final TextStyle display = _style(
    family: displayFamily,
    size: 40,
    lineHeight: 44,
    weight: FontWeight.w700,
    tracking: -0.01,
  );

  static final TextStyle headline = _style(
    family: displayFamily,
    size: 32,
    lineHeight: 36,
    weight: FontWeight.w700,
  );

  static final TextStyle title1 = _style(
    family: displayFamily,
    size: 26,
    lineHeight: 30,
    weight: FontWeight.w600,
  );

  static final TextStyle title2 = _style(
    family: displayFamily,
    size: 22,
    lineHeight: 28,
    weight: FontWeight.w600,
  );

  static final TextStyle title3 = _style(
    family: textFamily,
    size: 18,
    lineHeight: 24,
    weight: FontWeight.w600,
  );

  static final TextStyle bodyLarge = _style(
    family: textFamily,
    size: 18,
    lineHeight: 28,
    weight: FontWeight.w400,
  );

  static final TextStyle body = _style(
    family: textFamily,
    size: 16,
    lineHeight: 24,
    weight: FontWeight.w400,
  );

  static final TextStyle bodyStrong = _style(
    family: textFamily,
    size: 16,
    lineHeight: 24,
    weight: FontWeight.w600,
  );

  static final TextStyle label = _style(
    family: textFamily,
    size: 14,
    lineHeight: 20,
    weight: FontWeight.w600,
  );

  static final TextStyle footnote = _style(
    family: textFamily,
    size: 13,
    lineHeight: 18,
    weight: FontWeight.w400,
  );

  static final TextStyle caption = _style(
    family: textFamily,
    size: 12,
    lineHeight: 16,
    weight: FontWeight.w600,
    tracking: 0.01,
  );

  static final TextStyle numeral = _style(
    family: displayFamily,
    size: 28,
    lineHeight: 32,
    weight: FontWeight.w600,
    features: _figures,
  );

  static final TextStyle numeralXL = _style(
    family: displayFamily,
    size: 56,
    lineHeight: 56,
    weight: FontWeight.w700,
    tracking: -0.02,
    features: _figures,
  );

  static final TextStyle code = _style(
    family: textFamily,
    size: 32,
    lineHeight: 40,
    weight: FontWeight.w600,
    tracking: 0.12,
    features: _figures,
  );

  /// Every style keyed by its token name.
  static final Map<String, TextStyle> byToken = {
    'display': display,
    'headline': headline,
    'title1': title1,
    'title2': title2,
    'title3': title3,
    'bodyLarge': bodyLarge,
    'body': body,
    'bodyStrong': bodyStrong,
    'label': label,
    'footnote': footnote,
    'caption': caption,
    'numeral': numeral,
    'numeralXL': numeralXL,
    'code': code,
  };

  /// Material text roles mapped onto the scale. Body text never goes below
  /// 16, so both `bodyLarge` and `bodyMedium` are [body].
  static TextTheme textTheme(Color color) => TextTheme(
    displayLarge: display,
    displayMedium: headline,
    displaySmall: title1,
    headlineLarge: headline,
    headlineMedium: title1,
    headlineSmall: title2,
    titleLarge: title2,
    titleMedium: title3,
    titleSmall: bodyStrong,
    bodyLarge: body,
    bodyMedium: body,
    bodySmall: footnote,
    labelLarge: label,
    labelMedium: caption,
    labelSmall: caption,
  ).apply(bodyColor: color, displayColor: color);
}
