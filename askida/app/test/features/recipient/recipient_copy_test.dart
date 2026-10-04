import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

Map<String, String> _messages(String locale) {
  final decoded = jsonDecode(
    File('lib/l10n/app_$locale.arb').readAsStringSync(),
  ) as Map<String, dynamic>;
  return {
    for (final entry in decoded.entries)
      if (!entry.key.startsWith('@')) entry.key: entry.value as String,
  };
}

void main() {
  final tr = _messages('tr');
  final en = _messages('en');
  final recipientKeys = tr.keys.where((k) => k.startsWith('recipient')).toSet();

  test('recipient copy exists in Turkish and English', () {
    expect(recipientKeys.length, greaterThan(60));
    expect(
      en.keys.where((k) => k.startsWith('recipient')).toSet(),
      recipientKeys,
    );
    for (final key in recipientKeys) {
      expect(tr[key], isNotEmpty, reason: key);
      expect(en[key], isNotEmpty, reason: key);
    }
  });

  test('recipient copy never pities or describes people', () {
    final forbidden = RegExp(
      r'muhtaç|fakir|yoksul|ihtiyaç\s+sahibi|yardıma\s+muhtaç|needy|poor\b|charity',
      caseSensitive: false,
    );
    for (final key in recipientKeys) {
      expect(forbidden.hasMatch(tr[key]!), isFalse, reason: tr[key]);
      expect(forbidden.hasMatch(en[key]!), isFalse, reason: en[key]);
    }
  });

  test('the flow says "askıdan al" and asks for no account', () {
    expect(tr['recipientTake'], 'Askıdan al');
    expect(tr['recipientIntroBody'], contains('Hesap açman'));
    expect(tr['recipientResetAction'], 'Verilerimi sıfırla');
  });

  test('recipient code never changes case or stores history', () {
    final sources = Directory('lib/features/recipient')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'));
    for (final file in sources) {
      final text = file.readAsStringSync();
      expect(text.contains('toUpperCase('), isFalse, reason: file.path);
      expect(text.contains('toLowerCase('), isFalse, reason: file.path);
      expect(text.contains('SharedPreferences'), isFalse, reason: file.path);
      expect(text.contains('print('), isFalse, reason: file.path);
    }
  });
}
