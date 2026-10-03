import 'dart:io';

import 'package:askida/app.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/pump_app.dart';

/// Dart casing is not locale aware (it turns `i` into `I`), so the app never
/// upper-cases text: uppercase exists only as the literal code and `ÖRNEK`.
void main() {
  List<File> sources() =>
      Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .where((f) => !f.path.replaceAll(r'\', '/').contains('/l10n/gen/'))
          .toList();

  test('lib contains no upper-case transform', () {
    final transform = RegExp(r'toUpperCase\(');
    final files = sources();
    expect(files, isNotEmpty);
    for (final file in files) {
      final source = file.readAsStringSync();
      expect(transform.hasMatch(source), isFalse, reason: file.path);
    }
  });

  test('the app defaults to tr_TR', () {
    expect(AskidaApp.defaultLocale, const Locale('tr', 'TR'));
    expect(AppLocalizations.supportedLocales.first, const Locale('tr'));
  });

  testWidgets('MaterialApp runs in tr_TR without an override', (tester) async {
    await tester.pumpAskida();
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.locale, const Locale('tr', 'TR'));
    final context = tester.element(find.byType(Scaffold).first);
    expect(Localizations.localeOf(context).languageCode, 'tr');
  });
}
