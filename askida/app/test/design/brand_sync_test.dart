import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'brand_files.dart';

/// Flutter cannot bundle assets from outside the package, so the app keeps
/// copies of the brand fonts. These tests fail as soon as a copy drifts.
void main() {
  final tokens = readBrandTokens();
  final typography = tokens['typography'] as Map<String, dynamic>;
  final fontFiles = typography['fontFiles'] as Map<String, dynamic>;
  final flutterFonts = (fontFiles['flutter'] as List<dynamic>)
      .cast<Map<String, dynamic>>();
  final licence =
      (fontFiles['source'] as Map<String, dynamic>)['licence'] as String;
  final pubspec = File('pubspec.yaml').readAsStringSync();

  String baseName(String path) => path.split('/').last;

  test('tokens list the four static instances', () {
    expect(flutterFonts, hasLength(4));
  });

  for (final font in flutterFonts) {
    final brandPath = font['file'] as String;
    final name = baseName(brandPath);

    test('$name is byte-identical to the brand file', () {
      final brandBytes = File('${brandDir.path}/$brandPath').readAsBytesSync();
      final appBytes = File('assets/fonts/$name').readAsBytesSync();
      expect(appBytes.length, brandBytes.length);
      expect(appBytes, orderedEquals(brandBytes));
    });

    test('$name is declared in pubspec with family and weight', () {
      final family = font['family'] as String;
      final weight = font['weight'] as int;
      final familyBlock = RegExp(
        'family: $family\\s+fonts:((?:\\s+- asset: [^\\n]+\\s+weight: \\d+)+)',
      ).firstMatch(pubspec);
      expect(familyBlock, isNotNull, reason: family);
      expect(
        familyBlock!.group(1),
        contains('assets/fonts/$name\n          weight: $weight'),
      );
    });
  }

  test('the licence travels with the fonts', () {
    final brandText = File('${brandDir.path}/$licence').readAsStringSync();
    final appText = File('assets/fonts/OFL.txt').readAsStringSync();
    expect(appText, brandText);
  });
}
