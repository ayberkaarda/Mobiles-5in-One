import 'dart:convert';
import 'dart:io';

import 'package:askida/core/errors/problem_messages.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _arb(String locale) =>
    jsonDecode(File('lib/l10n/app_$locale.arb').readAsStringSync())
        as Map<String, dynamic>;

/// Codes the server emits today (ADR-0010 catalogue and the append-only
/// domain codes of phases 2 and 3).
const serverCodes = [
  'validation.failed',
  'auth.invalid_credentials',
  'auth.locked',
  'auth.unauthenticated',
  'auth.email_unverified',
  'auth.token_invalid',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'server_error',
  'bad_request',
  'method_not_allowed',
  'https_required',
  'service_unavailable',
  'shop.has_open_hooks',
  'shop.not_verified',
  'shop.not_payable',
  'anon.daily_cap',
  'anon.shop_cap',
  'hook.none_available',
  'hook.code_invalid',
  'hook.code_expired',
  'hook.wrong_shop',
  'donation.cap_exceeded',
  'donation.tx_cap_exceeded',
  'payment.mismatch',
];

void main() {
  test('every server code has its own message key', () {
    for (final code in serverCodes) {
      expect(problemMessageKeys, contains(code), reason: code);
    }
  });

  test('every message key exists in both ARB files', () {
    final keys = {...problemMessageKeys.values, genericProblemKey};
    for (final locale in ['tr', 'en']) {
      final arb = _arb(locale);
      for (final key in keys) {
        expect(arb, contains(key), reason: '$locale: $key');
      }
    }
  });

  test('unknown codes fall back to the generic message', () {
    expect(problemMessageKey('teapot.brewing'), genericProblemKey);
  });

  for (final locale in const [Locale('tr'), Locale('en')]) {
    test(
      '${locale.languageCode}: every key resolves to its own text',
      () async {
        final l10n = await AppLocalizations.delegate.load(locale);
        final arb = _arb(locale.languageCode);
        for (final MapEntry(key: code, value: key)
            in problemMessageKeys.entries) {
          expect(problemMessage(l10n, code), arb[key], reason: code);
        }
        expect(problemMessage(l10n, 'teapot.brewing'), arb[genericProblemKey]);
        const problem = ApiProblem(code: 'anon.daily_cap', status: 409);
        expect(problem.message(l10n), arb['problemAnonDailyCap']);
      },
    );
  }

  test('problem copy never shows server titles or pity words', () {
    final forbidden = RegExp(
      r'muhtaç|fakir|yoksul|ihtiyaç\s+sahibi|zavallı|yardıma muhtaç',
      caseSensitive: false,
    );
    for (final locale in ['tr', 'en']) {
      final arb = _arb(locale);
      for (final key in problemMessageKeys.values) {
        final text = arb[key] as String;
        expect(forbidden.hasMatch(text), isFalse, reason: text);
        expect(text, isNot(contains('The request')), reason: text);
      }
    }
  });
}
