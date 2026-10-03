import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:flutter/material.dart';

/// The 24 colour roles of `brand/tokens.json` (`color.scheme.light|dark`).
///
/// Roles that have a Material slot are also mapped into [ColorScheme]
/// (see [AskidaTheme]); everything is available here by its token name.
/// `test/design/tokens_test.dart` checks every value against the token file.
@immutable
class AskidaColors extends ThemeExtension<AskidaColors> {
  const new({
    required this.background,
    required this.surface,
    required this.surfaceRaised,
    required this.surfaceSunken,
    required this.text,
    required this.textMuted,
    required this.border,
    required this.borderStrong,
    required this.primary,
    required this.onPrimary,
    required this.primaryText,
    required this.secondary,
    required this.onSecondary,
    required this.accent,
    required this.onAccent,
    required this.accentText,
    required this.info,
    required this.success,
    required this.warning,
    required this.danger,
    required this.dangerText,
    required this.onDanger,
    required this.focusRing,
    required this.overlay,
  });

  static const light = AskidaColors(
    background: Color(0xFFF4F0E8),
    surface: Color(0xFFFBF8F3),
    surfaceRaised: Color(0xFFFFFFFF),
    surfaceSunken: Color(0xFFEAE4D9),
    text: Color(0xFF2B2B2B),
    textMuted: Color(0xFF5F574E),
    border: Color(0xFFE0D8CB),
    borderStrong: Color(0xFF827767),
    primary: Color(0xFF2B2B2B),
    onPrimary: Color(0xFFFBF8F3),
    primaryText: Color(0xFF2B2B2B),
    secondary: Color(0xFFE4DAC9),
    onSecondary: Color(0xFF2B2B2B),
    accent: Color(0xFFC8763A),
    onAccent: Color(0xFF1C1814),
    accentText: Color(0xFF99521F),
    info: Color(0xFF25607F),
    success: Color(0xFF4E6B3A),
    warning: Color(0xFF875610),
    danger: Color(0xFFB23A48),
    dangerText: Color(0xFFAD3444),
    onDanger: Color(0xFFFFFFFF),
    focusRing: Color(0xFF25607F),
    overlay: Color(0x992B2B2B),
  );

  static const dark = AskidaColors(
    background: Color(0xFF171411),
    surface: Color(0xFF211D18),
    surfaceRaised: Color(0xFF2B2621),
    surfaceSunken: Color(0xFF100E0B),
    text: Color(0xFFF3EEE6),
    textMuted: Color(0xFFB3A99C),
    border: Color(0xFF352E27),
    borderStrong: Color(0xFF8C8176),
    primary: Color(0xFFF3EEE6),
    onPrimary: Color(0xFF171411),
    primaryText: Color(0xFFF3EEE6),
    secondary: Color(0xFF352E27),
    onSecondary: Color(0xFFF3EEE6),
    accent: Color(0xFFC8763A),
    onAccent: Color(0xFF171411),
    accentText: Color(0xFFE6A26C),
    info: Color(0xFF6FB0D4),
    success: Color(0xFF9CBF7F),
    warning: Color(0xFFE9A23B),
    danger: Color(0xFFE36B78),
    dangerText: Color(0xFFF0919B),
    onDanger: Color(0xFF171411),
    focusRing: Color(0xFFE9A23B),
    overlay: Color(0xB3000000),
  );

  /// The QR panel is ink on white in both schemes (Kömür on White).
  static const qrInk = Color(0xFF2B2B2B);
  static const qrPaper = Color(0xFFFFFFFF);

  final Color background;
  final Color surface;
  final Color surfaceRaised;
  final Color surfaceSunken;
  final Color text;
  final Color textMuted;
  final Color border;
  final Color borderStrong;
  final Color primary;
  final Color onPrimary;
  final Color primaryText;
  final Color secondary;
  final Color onSecondary;
  final Color accent;
  final Color onAccent;
  final Color accentText;
  final Color info;
  final Color success;
  final Color warning;
  final Color danger;
  final Color dangerText;
  final Color onDanger;
  final Color focusRing;
  final Color overlay;

  /// Every role keyed by its token name.
  Map<String, Color> get byToken => {
    'background': background,
    'surface': surface,
    'surfaceRaised': surfaceRaised,
    'surfaceSunken': surfaceSunken,
    'text': text,
    'textMuted': textMuted,
    'border': border,
    'borderStrong': borderStrong,
    'primary': primary,
    'onPrimary': onPrimary,
    'primaryText': primaryText,
    'secondary': secondary,
    'onSecondary': onSecondary,
    'accent': accent,
    'onAccent': onAccent,
    'accentText': accentText,
    'info': info,
    'success': success,
    'warning': warning,
    'danger': danger,
    'dangerText': dangerText,
    'onDanger': onDanger,
    'focusRing': focusRing,
    'overlay': overlay,
  };

  /// The colours of the current theme. Falls back to the light scheme when
  /// a widget is pumped without the Askıda theme.
  static AskidaColors of(BuildContext context) =>
      Theme.of(context).extension<AskidaColors>() ?? light;

  @override
  AskidaColors copyWith({
    Color? background,
    Color? surface,
    Color? surfaceRaised,
    Color? surfaceSunken,
    Color? text,
    Color? textMuted,
    Color? border,
    Color? borderStrong,
    Color? primary,
    Color? onPrimary,
    Color? primaryText,
    Color? secondary,
    Color? onSecondary,
    Color? accent,
    Color? onAccent,
    Color? accentText,
    Color? info,
    Color? success,
    Color? warning,
    Color? danger,
    Color? dangerText,
    Color? onDanger,
    Color? focusRing,
    Color? overlay,
  }) => AskidaColors(
    background: background ?? this.background,
    surface: surface ?? this.surface,
    surfaceRaised: surfaceRaised ?? this.surfaceRaised,
    surfaceSunken: surfaceSunken ?? this.surfaceSunken,
    text: text ?? this.text,
    textMuted: textMuted ?? this.textMuted,
    border: border ?? this.border,
    borderStrong: borderStrong ?? this.borderStrong,
    primary: primary ?? this.primary,
    onPrimary: onPrimary ?? this.onPrimary,
    primaryText: primaryText ?? this.primaryText,
    secondary: secondary ?? this.secondary,
    onSecondary: onSecondary ?? this.onSecondary,
    accent: accent ?? this.accent,
    onAccent: onAccent ?? this.onAccent,
    accentText: accentText ?? this.accentText,
    info: info ?? this.info,
    success: success ?? this.success,
    warning: warning ?? this.warning,
    danger: danger ?? this.danger,
    dangerText: dangerText ?? this.dangerText,
    onDanger: onDanger ?? this.onDanger,
    focusRing: focusRing ?? this.focusRing,
    overlay: overlay ?? this.overlay,
  );

  @override
  AskidaColors lerp(AskidaColors? other, double t) {
    if (other == null) return this;
    Color mix(Color a, Color b) => Color.lerp(a, b, t)!;
    return AskidaColors(
      background: mix(background, other.background),
      surface: mix(surface, other.surface),
      surfaceRaised: mix(surfaceRaised, other.surfaceRaised),
      surfaceSunken: mix(surfaceSunken, other.surfaceSunken),
      text: mix(text, other.text),
      textMuted: mix(textMuted, other.textMuted),
      border: mix(border, other.border),
      borderStrong: mix(borderStrong, other.borderStrong),
      primary: mix(primary, other.primary),
      onPrimary: mix(onPrimary, other.onPrimary),
      primaryText: mix(primaryText, other.primaryText),
      secondary: mix(secondary, other.secondary),
      onSecondary: mix(onSecondary, other.onSecondary),
      accent: mix(accent, other.accent),
      onAccent: mix(onAccent, other.onAccent),
      accentText: mix(accentText, other.accentText),
      info: mix(info, other.info),
      success: mix(success, other.success),
      warning: mix(warning, other.warning),
      danger: mix(danger, other.danger),
      dangerText: mix(dangerText, other.dangerText),
      onDanger: mix(onDanger, other.onDanger),
      focusRing: mix(focusRing, other.focusRing),
      overlay: mix(overlay, other.overlay),
    );
  }
}

abstract final class AskidaTheme {
  static ThemeData light() => build(AskidaColors.light, Brightness.light);

  static ThemeData dark() => build(AskidaColors.dark, Brightness.dark);

  /// Material slots filled from the roles. The tonal button reads the
  /// secondary container, so it gets the quiet secondary fill as well.
  static ColorScheme colorScheme(AskidaColors c, Brightness brightness) =>
      ColorScheme(
        brightness: brightness,
        primary: c.primary,
        onPrimary: c.onPrimary,
        secondary: c.secondary,
        onSecondary: c.onSecondary,
        secondaryContainer: c.secondary,
        onSecondaryContainer: c.onSecondary,
        error: c.danger,
        onError: c.onDanger,
        surface: c.surface,
        onSurface: c.text,
        onSurfaceVariant: c.textMuted,
        outline: c.borderStrong,
        outlineVariant: c.border,
        scrim: c.overlay,
        surfaceTint: Colors.transparent,
      );

  static WidgetStateProperty<BorderSide?> _focusSide(AskidaColors c) =>
      WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.focused)
            ? BorderSide(
                color: c.focusRing,
                width: AskidaStroke.focus,
                strokeAlign: BorderSide.strokeAlignOutside,
              )
            : null,
      );

  static ThemeData build(AskidaColors c, Brightness brightness) {
    final scheme = colorScheme(c, brightness);
    final textTheme = AskidaTypography.textTheme(c.text);
    const buttonShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(AskidaRadius.button)),
    );
    const buttonSize = Size(64, AskidaLayout.touchTarget);
    const buttonPadding = EdgeInsets.symmetric(horizontal: AskidaSpacing.s6);
    final sheetShadow = brightness == Brightness.light
        ? AskidaElevation.sheetShadowLight
        : AskidaElevation.sheetShadowDark;

    OutlineInputBorder inputBorder(Color color, double width) =>
        OutlineInputBorder(
          borderRadius: const BorderRadius.all(
            Radius.circular(AskidaRadius.input),
          ),
          borderSide: BorderSide(color: color, width: width),
        );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      extensions: [c],
      fontFamily: AskidaTypography.textFamily,
      textTheme: textTheme,
      scaffoldBackgroundColor: c.background,
      canvasColor: c.background,
      dividerColor: c.border,
      appBarTheme: AppBarTheme(
        backgroundColor: c.background,
        foregroundColor: c.text,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge,
      ),
      filledButtonTheme: FilledButtonThemeData(
        // Colours come from the scheme, so FilledButton is primary/onPrimary
        // and FilledButton.tonal is secondary/onSecondary.
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(buttonSize),
          padding: const WidgetStatePropertyAll(buttonPadding),
          shape: const WidgetStatePropertyAll(buttonShape),
          elevation: const WidgetStatePropertyAll(0),
          textStyle: WidgetStatePropertyAll(AskidaTypography.label),
          side: _focusSide(c),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(buttonSize),
          shape: const WidgetStatePropertyAll(buttonShape),
          foregroundColor: WidgetStatePropertyAll(c.primaryText),
          textStyle: WidgetStatePropertyAll(
            AskidaTypography.label.copyWith(
              decoration: TextDecoration.underline,
            ),
          ),
          side: _focusSide(c),
        ),
      ),
      inputDecorationTheme: InputDecorationThemeData(
        filled: true,
        fillColor: c.surfaceSunken,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AskidaSpacing.s4,
          vertical: AskidaSpacing.s3,
        ),
        labelStyle: AskidaTypography.body.copyWith(color: c.textMuted),
        hintStyle: AskidaTypography.body.copyWith(color: c.textMuted),
        helperStyle: AskidaTypography.footnote.copyWith(color: c.textMuted),
        errorStyle: AskidaTypography.footnote.copyWith(color: c.dangerText),
        border: inputBorder(c.borderStrong, AskidaStroke.border),
        enabledBorder: inputBorder(c.borderStrong, AskidaStroke.border),
        disabledBorder: inputBorder(c.border, AskidaStroke.border),
        focusedBorder: inputBorder(c.focusRing, AskidaStroke.focus),
        errorBorder: inputBorder(c.dangerText, AskidaStroke.border),
        focusedErrorBorder: inputBorder(c.dangerText, AskidaStroke.focus),
      ),
      cardTheme: CardThemeData(
        color: c.surface,
        elevation: 0,
        shadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.all(
            Radius.circular(AskidaRadius.card),
          ),
          side: BorderSide(color: c.border),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: c.surfaceRaised,
        modalBackgroundColor: c.surfaceRaised,
        surfaceTintColor: Colors.transparent,
        elevation: AskidaElevation.sheetY,
        modalElevation: AskidaElevation.sheetY,
        shadowColor: sheetShadow,
        modalBarrierColor: c.overlay,
        showDragHandle: false,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(AskidaRadius.sheet),
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: c.surfaceRaised,
        surfaceTintColor: Colors.transparent,
        elevation: AskidaElevation.sheetY,
        shadowColor: sheetShadow,
        barrierColor: c.overlay,
        titleTextStyle: textTheme.titleMedium,
        contentTextStyle: textTheme.bodyMedium,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(AskidaRadius.dialog)),
        ),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(buttonSize),
          shape: const WidgetStatePropertyAll(buttonShape),
          textStyle: WidgetStatePropertyAll(AskidaTypography.label),
          backgroundColor: WidgetStateProperty.resolveWith(
            (states) =>
                states.contains(WidgetState.selected) ? c.primary : c.secondary,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (states) =>
                states.contains(WidgetState.selected) ? c.onPrimary : c.text,
          ),
          side: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.focused)
                ? BorderSide(color: c.focusRing, width: AskidaStroke.focus)
                : BorderSide(color: c.secondary),
          ),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: c.secondary,
        labelStyle: AskidaTypography.caption.copyWith(color: c.text),
        side: BorderSide.none,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(AskidaRadius.chip)),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: c.border,
        thickness: AskidaStroke.border,
        space: AskidaStroke.border,
      ),
      iconTheme: IconThemeData(color: c.text, size: 24),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: c.primary),
    );
  }
}
