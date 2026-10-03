import 'dart:io';

import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'brand_files.dart';

/// `#RRGGBB` or `#RRGGBBAA` (alpha last, as in the token file).
Color hexColor(String hex) {
  final digits = hex.substring(1);
  final rgb = int.parse(digits.substring(0, 6), radix: 16);
  final alpha = digits.length == 8
      ? int.parse(digits.substring(6, 8), radix: 16)
      : 0xFF;
  return Color((alpha << 24) | rgb);
}

void main() {
  final tokens = readBrandTokens();
  final color = tokens['color'] as Map<String, dynamic>;
  final schemes = color['scheme'] as Map<String, dynamic>;
  final palette = color['palette'] as Map<String, dynamic>;
  final typography = tokens['typography'] as Map<String, dynamic>;

  Map<String, Color> tokenScheme(String name) => {
    for (final e in (schemes[name] as Map<String, dynamic>).entries)
      e.key: hexColor(e.value as String),
  };

  Color paletteColor(String name) =>
      hexColor((palette[name] as Map<String, dynamic>)['value'] as String);

  final themes = <String, (AskidaColors, ThemeData)>{
    'light': (AskidaColors.light, AskidaTheme.light()),
    'dark': (AskidaColors.dark, AskidaTheme.dark()),
  };

  for (final MapEntry(key: name, value: (colors, theme)) in themes.entries) {
    group('$name scheme', () {
      final expected = tokenScheme(name);

      test('AskidaColors has exactly the token roles', () {
        expect(colors.byToken.keys.toSet(), expected.keys.toSet());
      });

      test('every role equals its token', () {
        for (final role in expected.keys) {
          expect(colors.byToken[role], expected[role], reason: role);
        }
      });

      test('the theme carries the extension', () {
        expect(theme.extension<AskidaColors>(), same(colors));
        expect(theme.brightness.name, name);
      });

      test('ColorScheme maps the roles', () {
        final cs = theme.colorScheme;
        final mapping = <String, Color>{
          'primary': cs.primary,
          'onPrimary': cs.onPrimary,
          'secondary': cs.secondary,
          'onSecondary': cs.onSecondary,
          'danger': cs.error,
          'onDanger': cs.onError,
          'surface': cs.surface,
          'text': cs.onSurface,
          'borderStrong': cs.outline,
          'border': cs.outlineVariant,
          'overlay': cs.scrim,
        };
        for (final MapEntry(key: role, value: actual) in mapping.entries) {
          expect(actual, expected[role], reason: role);
        }
        expect(cs.secondaryContainer, expected['secondary']);
        expect(cs.onSecondaryContainer, expected['onSecondary']);
        expect(cs.onSurfaceVariant, expected['textMuted']);
        expect(theme.scaffoldBackgroundColor, expected['background']);
      });

      test('accent is never a button or surface colour', () {
        final cs = theme.colorScheme;
        final accent = expected['accent'];
        for (final slot in [
          cs.primary,
          cs.secondary,
          cs.surface,
          cs.secondaryContainer,
          theme.scaffoldBackgroundColor,
        ]) {
          expect(slot, isNot(accent));
        }
      });
    });
  }

  test('QR panel is Kömür on White in both schemes', () {
    expect(AskidaColors.qrInk, paletteColor('komur'));
    expect(AskidaColors.qrPaper, paletteColor('white'));
  });

  test('every colour literal in lib/design is a token value', () {
    final allowed = <Color>{
      for (final p in palette.values)
        hexColor((p as Map<String, dynamic>)['value'] as String),
      for (final s in schemes.keys) ...tokenScheme(s).values,
      for (final s in ['light', 'dark'])
        hexColor(
          (((tokens['elevation'] as Map<String, dynamic>)['sheet']
                      as Map<String, dynamic>)[s]
                  as Map<String, dynamic>)['color']
              as String,
        ),
    };
    final literal = RegExp(r'Color\(0x([0-9A-Fa-f]{8})\)');
    final files = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .where((f) => !f.path.replaceAll(r'\', '/').contains('/l10n/gen/'));
    var found = 0;
    for (final file in files) {
      for (final m in literal.allMatches(file.readAsStringSync())) {
        found++;
        final value = Color(int.parse(m.group(1)!, radix: 16));
        expect(allowed, contains(value), reason: '${file.path}: ${m[0]}');
      }
    }
    expect(found, greaterThan(48));
  });

  test('sheet shadow equals the elevation token', () {
    final sheet =
        (tokens['elevation'] as Map<String, dynamic>)['sheet']
            as Map<String, dynamic>;
    for (final (name, brightness) in [
      ('light', Brightness.light),
      ('dark', Brightness.dark),
    ]) {
      final t = sheet[name] as Map<String, dynamic>;
      final shadow = AskidaElevation.sheetShadow(brightness);
      expect(shadow.color, hexColor(t['color'] as String));
      expect(shadow.offset.dy, t['y']);
      expect(shadow.blurRadius, t['blur']);
      expect(shadow.spreadRadius, t['spread']);
    }
  });

  group('typography', () {
    final scale = typography['scale'] as Map<String, dynamic>;
    final cuts = typography['cuts'] as Map<String, dynamic>;
    final appStyles = {
      for (final e in scale.entries)
        if ((e.value as Map<String, dynamic>).containsKey('app'))
          e.key: e.value as Map<String, dynamic>,
    };

    test('every app style of the scale exists', () {
      expect(AskidaTypography.byToken.keys.toSet(), appStyles.keys.toSet());
    });

    for (final MapEntry(key: name, value: spec) in appStyles.entries) {
      test('$name matches the token', () {
        final style = AskidaTypography.byToken[name]!;
        final app = spec['app'] as Map<String, dynamic>;
        final size = (app['size'] as num).toDouble();
        final cut = cuts[spec['cut']] as Map<String, dynamic>;
        expect(style.fontFamily, cut['flutterFamily']);
        expect(style.fontSize, size);
        expect(style.height! * size, closeTo(app['lineHeight'] as num, 1e-9));
        expect(style.fontWeight!.value, spec['weight']);
        expect(
          style.letterSpacing,
          closeTo((spec['tracking'] as num) * size, 1e-9),
        );
        final hasFigures = spec.containsKey('features');
        expect(
          style.fontFeatures ?? const <FontFeature>[],
          hasFigures
              ? containsAll(const [
                  FontFeature.tabularFigures(),
                  FontFeature.liningFigures(),
                ])
              : isEmpty,
        );
      });
    }

    final minDisplay =
        ((cuts['display'] as Map<String, dynamic>)['minSize'] as num)
            .toDouble();
    for (final MapEntry(key: name, value: theme) in themes.entries) {
      test('$name text theme: weights 400/600/700, Display at 22 and up', () {
        final tt = theme.$2.textTheme;
        final styles = [
          tt.displayLarge,
          tt.displayMedium,
          tt.displaySmall,
          tt.headlineLarge,
          tt.headlineMedium,
          tt.headlineSmall,
          tt.titleLarge,
          tt.titleMedium,
          tt.titleSmall,
          tt.bodyLarge,
          tt.bodyMedium,
          tt.bodySmall,
          tt.labelLarge,
          tt.labelMedium,
          tt.labelSmall,
          ...AskidaTypography.byToken.values,
        ].nonNulls;
        for (final style in styles) {
          expect([
            FontWeight.w400,
            FontWeight.w600,
            FontWeight.w700,
          ], contains(style.fontWeight));
          if (style.fontFamily == AskidaTypography.displayFamily) {
            expect(style.fontSize, greaterThanOrEqualTo(minDisplay));
          }
        }
        expect(tt.bodyLarge!.fontSize, 16);
        expect(tt.bodyMedium!.fontSize, 16);
        expect(tt.bodyLarge!.color, theme.$1.text);
      });
    }
  });

  group('dimensions and motion', () {
    test('spacing grid', () {
      final spacing = (tokens['spacing'] as Map<String, dynamic>).map(
        (k, v) => MapEntry(k, (v as num).toDouble()),
      );
      expect(AskidaSpacing.byToken, spacing);
    });

    test('layout', () {
      final layout = tokens['layout'] as Map<String, dynamic>;
      expect(AskidaLayout.screenGutter, layout['screenGutter']);
      expect(AskidaLayout.rowMinHeight, layout['rowMinHeight']);
      expect(AskidaLayout.touchTarget, layout['touchTarget']);
    });

    test('radius', () {
      final r = tokens['radius'] as Map<String, dynamic>;
      expect(AskidaRadius.tag, r['tag']);
      expect(AskidaRadius.chip, r['chip']);
      expect(AskidaRadius.button, r['button']);
      expect(AskidaRadius.input, r['input']);
      expect(AskidaRadius.card, r['card']);
      expect(AskidaRadius.row, r['row']);
      expect(AskidaRadius.sheet, r['sheet']);
      expect(AskidaRadius.dialog, r['dialog']);
    });

    test('stroke', () {
      final s = tokens['stroke'] as Map<String, dynamic>;
      expect(AskidaStroke.rail, s['rail']);
      expect(AskidaStroke.icon, s['icon']);
      expect(AskidaStroke.border, s['border']);
      expect(AskidaStroke.focus, s['focus']);
      expect(AskidaStroke.focusOffset, s['focusOffset']);
    });

    test('motion', () {
      final motion = tokens['motion'] as Map<String, dynamic>;
      final d = motion['duration'] as Map<String, dynamic>;
      expect(AskidaMotion.instant.inMilliseconds, d['instant']);
      expect(AskidaMotion.fast.inMilliseconds, d['fast']);
      expect(AskidaMotion.base.inMilliseconds, d['base']);
      expect(AskidaMotion.enter.inMilliseconds, d['enter']);
      expect(AskidaMotion.settle.inMilliseconds, d['settle']);
      final easing = motion['easing'] as Map<String, dynamic>;
      List<double> cubic(Cubic c) => [c.a, c.b, c.c, c.d];
      expect(
        cubic(AskidaMotion.easeIn),
        (easing['in'] as List<dynamic>).map((v) => (v as num).toDouble()),
      );
      expect(
        cubic(AskidaMotion.easeOut),
        (easing['out'] as List<dynamic>).map((v) => (v as num).toDouble()),
      );
    });
  });

  group('component themes', () {
    for (final MapEntry(key: name, value: (c, theme)) in themes.entries) {
      test('$name buttons, inputs, cards and sheets', () {
        const states = <WidgetState>{};
        final filled = theme.filledButtonTheme.style!;
        expect(filled.minimumSize!.resolve(states)!.height, 48);
        final shape = filled.shape!.resolve(states)! as RoundedRectangleBorder;
        expect(shape.borderRadius, BorderRadius.circular(10));
        expect(theme.colorScheme.primary, c.primary);
        expect(theme.colorScheme.onPrimary, c.onPrimary);
        expect(
          filled.side!.resolve({WidgetState.focused}),
          isA<BorderSide>()
              .having((s) => s.color, 'color', c.focusRing)
              .having((s) => s.width, 'width', 2),
        );

        expect(theme.outlinedButtonTheme.style, isNull);

        final input = theme.inputDecorationTheme;
        final enabled = input.enabledBorder! as OutlineInputBorder;
        expect(enabled.borderRadius, BorderRadius.circular(10));
        expect(enabled.borderSide.color, c.borderStrong);
        final focused = input.focusedBorder! as OutlineInputBorder;
        expect(focused.borderSide.color, c.focusRing);
        expect(focused.borderSide.width, 2);

        final card = theme.cardTheme;
        expect(card.elevation, 0);
        final cardShape = card.shape! as RoundedRectangleBorder;
        expect(cardShape.borderRadius, BorderRadius.circular(14));
        expect(cardShape.side.color, c.border);
        expect(cardShape.side.width, 1);

        final sheet = theme.bottomSheetTheme;
        final sheetShape = sheet.shape! as RoundedRectangleBorder;
        expect(
          sheetShape.borderRadius,
          const BorderRadius.vertical(top: Radius.circular(20)),
        );
        expect(
          sheet.shadowColor,
          AskidaElevation.sheetShadow(theme.brightness).color,
        );

        final segment = theme.segmentedButtonTheme.style!;
        expect(
          segment.backgroundColor!.resolve({WidgetState.selected}),
          c.primary,
        );
        expect(segment.backgroundColor!.resolve(states), c.secondary);
        expect(
          segment.foregroundColor!.resolve({WidgetState.selected}),
          c.onPrimary,
        );
        expect(segment.foregroundColor!.resolve(states), c.text);
      });
    }
  });
}
