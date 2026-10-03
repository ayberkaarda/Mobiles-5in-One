import 'package:flutter/widgets.dart';

/// Spacing, layout, radius, stroke, elevation and motion values from
/// `brand/tokens.json`. `test/design/tokens_test.dart` checks every value
/// here against the token file.

/// The 4 pt grid. Names follow the token keys (`s4` = token `4` = 16).
abstract final class AskidaSpacing {
  static const double s0 = 0;
  static const double s1 = 4;
  static const double s2 = 8;
  static const double s3 = 12;
  static const double s4 = 16;
  static const double s6 = 24;
  static const double s8 = 32;
  static const double s12 = 48;
  static const double s16 = 64;
  static const double s24 = 96;

  /// Keyed by the token name, for tests and token sheets.
  static const Map<String, double> byToken = {
    '0': s0,
    '1': s1,
    '2': s2,
    '3': s3,
    '4': s4,
    '6': s6,
    '8': s8,
    '12': s12,
    '16': s16,
    '24': s24,
  };
}

abstract final class AskidaLayout {
  static const double screenGutter = 16;
  static const double rowMinHeight = 56;
  static const double touchTarget = 48;
}

/// Radius by element class; nothing else is used.
abstract final class AskidaRadius {
  static const double tag = 6;
  static const double chip = 6;
  static const double button = 10;
  static const double input = 10;
  static const double card = 14;
  static const double row = 14;
  static const double sheet = 20;
  static const double dialog = 20;
}

abstract final class AskidaStroke {
  static const double rail = 2;
  static const double icon = 1.75;
  static const double border = 1;
  static const double focus = 2;
  static const double focusOffset = 2;
}

/// The one shadow of the system, used only by bottom sheets and dialogs.
abstract final class AskidaElevation {
  static const double sheetY = 8;
  static const double sheetBlur = 24;
  static const double sheetSpread = 0;
  static const Color sheetShadowLight = Color(0x292B2B2B);
  static const Color sheetShadowDark = Color(0x80000000);

  static BoxShadow sheetShadow(Brightness brightness) => BoxShadow(
    color: brightness == Brightness.light ? sheetShadowLight : sheetShadowDark,
    offset: const Offset(0, sheetY),
    blurRadius: sheetBlur,
  );
}

abstract final class AskidaMotion {
  static const Duration instant = Duration.zero;
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration base = Duration(milliseconds: 200);
  static const Duration enter = Duration(milliseconds: 320);
  static const Duration settle = Duration(milliseconds: 480);

  /// Easing for things arriving.
  static const Cubic easeIn = Cubic(0.22, 1, 0.36, 1);

  /// Easing for things leaving.
  static const Cubic easeOut = Cubic(0.4, 0, 1, 1);

  /// Whether the platform asked for reduced motion.
  static bool reduced(BuildContext context) =>
      MediaQuery.maybeDisableAnimationsOf(context) ?? false;

  /// [duration], or zero when the platform asked for reduced motion.
  static Duration of(BuildContext context, Duration duration) =>
      reduced(context) ? instant : duration;
}
