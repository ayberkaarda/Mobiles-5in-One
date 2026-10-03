import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Loads the bundled Bricolage Grotesque instances and the Material icon
/// font, so layout tests measure real glyphs and goldens show real text.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  await _loadFonts();
  await testMain();
}

Future<void> _loadFonts() async {
  const families = {
    'BricolageText': [
      'assets/fonts/BricolageGrotesque-Text-Regular.ttf',
      'assets/fonts/BricolageGrotesque-Text-SemiBold.ttf',
    ],
    'BricolageDisplay': [
      'assets/fonts/BricolageGrotesque-Display-SemiBold.ttf',
      'assets/fonts/BricolageGrotesque-Display-Bold.ttf',
    ],
    'MaterialIcons': ['fonts/MaterialIcons-Regular.otf'],
  };
  for (final MapEntry(key: family, value: files) in families.entries) {
    final loader = FontLoader(family);
    for (final file in files) {
      loader.addFont(rootBundle.load(file));
    }
    await loader.load();
  }
}
