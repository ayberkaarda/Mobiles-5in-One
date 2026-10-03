@Tags(['golden'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/design_samples.dart';
import '../helpers/pump_design.dart';
import 'token_sheet.dart';

/// Goldens are rendered and compared on the Windows host only; see
/// dart_test.yaml. Regenerate with:
///   flutter test --update-goldens --tags golden
void main() {
  final cases = <String, (Widget, Size)>{
    'token_sheet': (const TokenSheet(), const Size(360, 1180)),
    for (final MapEntry(key: name, value: widget) in designSamples().entries)
      name: (
        widget,
        switch (name) {
          'code_tag' => const Size(360, 860),
          'mode_switcher' || 'askida_tag' => const Size(360, 260),
          'shop_card' => const Size(360, 320),
          _ => const Size(360, 520),
        },
      ),
  };

  for (final MapEntry(key: name, value: (widget, size)) in cases.entries) {
    for (final brightness in Brightness.values) {
      testWidgets('$name ${brightness.name}', (tester) async {
        await tester.pumpDesign(widget, brightness: brightness, size: size);
        await expectLater(
          find.byType(Scaffold),
          matchesGoldenFile('goldens/${name}_${brightness.name}.png'),
        );
      });
    }
  }
}
