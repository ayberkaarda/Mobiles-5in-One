import 'dart:convert';
import 'dart:io';

import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/features/impact/impact_providers.dart';
import 'package:askida/features/impact/presentation/impact_card.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/fixtures.dart';
import '../../helpers/pump_design.dart';
import '../donor/donor_harness.dart';

ImpactSummary _summary() => ImpactSummary.fromJson(fixtureData('impact'));

void main() {
  group('donor impact', () {
    test('counts paid units and distinct shops only', () {
      final donations = fixtureList('donations').map(Donation.fromJson).first;
      final impact = DonorImpact.fromDonations([
        donations,
        donations.copyWith(id: 'b', qty: 2),
        donations.copyWith(id: 'c', shopId: 'other', qty: 1),
        donations.copyWith(id: 'd', status: DonationStatus.initiated, qty: 9),
        donations.copyWith(id: 'e', status: DonationStatus.refunded, qty: 9),
      ]);
      expect(impact.units, 6);
      expect(impact.shops, 2);
    });
  });

  group('copy', () {
    final tr = lookupAppLocalizations(const Locale('tr'));

    test('the methodology key is never shown raw', () {
      expect(
        impactMethodologyText(tr, 'impact.v1.daily_units'),
        tr.impactMethodologyDailyUnits,
      );
      expect(
        impactMethodologyText(tr, 'impact.v9.unknown'),
        tr.impactMethodologyGeneric,
      );
    });

    test('the area label follows the level', () {
      final s = _summary();
      expect(impactAreaLabel(tr, s), 'İstanbul');
      expect(
        impactAreaLabel(tr, s.copyWith(level: ImpactLevel.ilce, ilce: 'Şişli')),
        'Şişli, İstanbul',
      );
      expect(impactAreaLabel(tr, s.copyWith(level: ImpactLevel.tr)), 'Türkiye');
    });
  });

  group('card', () {
    testWidgets('shows units, never people, with the dated method', (
      tester,
    ) async {
      await tester.pumpDesign(
        ImpactCard(
          summary: _summary(),
          donor: const DonorImpact(units: 6, shops: 2),
        ),
      );
      expect(find.text('Askıda: İstanbul'), findsOneWidget);
      expect(find.text('151'), findsOneWidget);
      expect(find.text('12'), findsOneWidget);
      expect(find.textContaining('impact.v1'), findsNothing);
      expect(
        find.textContaining('Günlük ürün sayıları, saatlik güncellenir'),
        findsOneWidget,
      );
      expect(find.textContaining('4 Ekim 2026'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('Bıraktıkların: 6')), findsOne);
    });

    for (final (scale, size) in layoutCases) {
      testWidgets('fits at $scale and ${size?.width ?? 360} px', (
        tester,
      ) async {
        await tester.pumpDesign(
          ImpactCard(
            summary: _summary().copyWith(donated: 1240, redeemed: 98765),
            donor: const DonorImpact(units: 1, shops: 1),
          ),
          textScale: scale,
          size: size ?? phoneSize,
        );
        expectNoLayoutErrors(tester);
      });
    }

    testWidgets('English copy', (tester) async {
      await tester.pumpDesign(
        ImpactCard(
          summary: _summary(),
          donor: const DonorImpact(units: 1, shops: 1),
        ),
        locale: const Locale('en'),
      );
      expect(find.text('On the hook: İstanbul'), findsOneWidget);
      expect(
        find.textContaining('item you left on the hook, at 1 shop'),
        findsOneWidget,
      );
    });
  });

  group('donor block of the ARB files', () {
    Map<String, String> messages(String locale) {
      final raw = File('lib/l10n/app_$locale.arb').readAsStringSync();
      return {
        for (final e in (jsonDecode(raw) as Map<String, dynamic>).entries)
          if (!e.key.startsWith('@')) e.key: e.value as String,
      };
    }

    final prefixes = RegExp(
      '^(auth|donor|donate|donation|receipt|history|impact|settings|delete)',
    );

    test('tr and en carry the same donor keys, all non-empty', () {
      final tr = messages('tr').keys.where(prefixes.hasMatch).toSet();
      final en = messages('en').keys.where(prefixes.hasMatch).toSet();
      expect(tr, en);
      expect(tr.length, greaterThan(150));
      for (final locale in ['tr', 'en']) {
        for (final MapEntry(:key, :value) in messages(locale).entries) {
          if (prefixes.hasMatch(key)) {
            expect(value.trim(), isNotEmpty, reason: '$locale $key');
          }
        }
      }
    });

    test('no pitying words and no people counted', () {
      final forbidden = RegExp(
        r'muhtaç|fakir|yoksul|ihtiyaç\s+sahibi|needy|poor people|charity',
        caseSensitive: false,
      );
      for (final locale in ['tr', 'en']) {
        for (final MapEntry(:key, :value) in messages(locale).entries) {
          if (!prefixes.hasMatch(key)) continue;
          expect(forbidden.hasMatch(value), isFalse, reason: '$key: $value');
        }
      }
    });

    test('legal texts are labelled as samples', () {
      final tr = messages('tr');
      expect(tr['authKvkkConsent'], contains('örnek metin'));
      expect(tr['authProviderConsentNote'], contains('örnek metin'));
    });
  });
}
