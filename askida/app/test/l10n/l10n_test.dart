import 'dart:convert';
import 'dart:io';

import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/pump_app.dart';

Map<String, String> _arbMessages(String locale) {
  final raw = File('lib/l10n/app_$locale.arb').readAsStringSync();
  final decoded = jsonDecode(raw) as Map<String, dynamic>;
  return {
    for (final entry in decoded.entries)
      if (!entry.key.startsWith('@')) entry.key: entry.value as String,
  };
}

void main() {
  test('Turkish is the first supported locale', () {
    expect(AppLocalizations.supportedLocales.first, const Locale('tr'));
    expect(
      AppLocalizations.supportedLocales,
      containsAll(const [Locale('tr'), Locale('en')]),
    );
  });

  test('tr and en define the same message keys', () {
    expect(_arbMessages('en').keys.toSet(), _arbMessages('tr').keys.toSet());
  });

  test('copy never uses pitying words', () {
    final forbidden = RegExp(
      r'muhtaç|fakir|yoksul|ihtiyaç\s+sahibi',
      caseSensitive: false,
    );
    for (final locale in ['tr', 'en']) {
      final messages = _arbMessages(locale);
      // Covers the design keys added with the rail components as well.
      expect(
        messages.keys,
        containsAll(const [
          'sampleLabel',
          'recipientCounterLead',
          'recipientCounterTail',
          'codeValidUntil',
          'codeValidFor',
          'shopVerified',
          'shopAvailableCaption',
          'shopNoneAvailable',
        ]),
      );
      for (final value in messages.values) {
        expect(forbidden.hasMatch(value), isFalse, reason: value);
      }
    }
  });

  test('the sample label is a literal uppercase string', () {
    expect(_arbMessages('tr')['sampleLabel'], 'ÖRNEK');
  });

  testWidgets('renders Turkish copy for the tr locale', (tester) async {
    await tester.pumpAskida(locale: const Locale('tr'));
    expect(find.text('Askıdan al'), findsWidgets);
    expect(find.text('Askıya bırak'), findsOneWidget);
  });

  testWidgets('renders English copy for the en locale', (tester) async {
    await tester.pumpAskida(locale: const Locale('en'));
    expect(find.text('Take from the hook'), findsWidgets);
    expect(find.text('Nothing is waiting on the hook nearby'), findsOneWidget);
  });

  testWidgets('falls back to Turkish for an unsupported locale', (
    tester,
  ) async {
    await tester.pumpAskida(locale: const Locale('de'));
    expect(
      find.text('Yakında askıda bekleyen bir şey görünmüyor'),
      findsOneWidget,
    );
  });
}
