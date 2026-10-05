@Tags(['golden'])
library;

import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/features/donor/presentation/donation_screens.dart';
import 'package:askida/features/donor/presentation/donor_shop_screen.dart';
import 'package:askida/features/impact/impact_providers.dart';
import 'package:askida/features/impact/presentation/impact_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_shops_repository.dart';
import '../../helpers/fixtures.dart';
import '../../helpers/pump_design.dart';

/// Goldens of the donor-side building blocks, light and dark, at text
/// scale 1.0 and 1.3 (Windows host only, see dart_test.yaml). Regenerate:
///   flutter test --update-goldens --tags golden test/features
void main() {
  final summary = ImpactSummary.fromJson(fixtureData('impact'));
  final donation = Donation.fromJson(fixtureData('donation'));
  final items = FakeShopsRepository.samplePublicShop().items;

  final cases = <String, (Widget, Size)>{
    'impact_card': (
      ImpactCard(
        summary: summary,
        donor: const DonorImpact(units: 6, shops: 2),
      ),
      const Size(360, 520),
    ),
    'donor_rows': (
      Column(
        children: [
          for (final item in items) ...[
            DonorItemRow(item: item, onTap: () {}),
            const SizedBox(height: 8),
          ],
          DonationRow(donation: donation, onTap: () {}),
        ],
      ),
      const Size(320, 520),
    ),
  };

  for (final MapEntry(key: name, value: (widget, size)) in cases.entries) {
    for (final brightness in Brightness.values) {
      for (final scale in [1.0, 1.3]) {
        final suffix = scale == 1.0 ? '' : '_x13';
        testWidgets('$name ${brightness.name} $scale', (tester) async {
          await tester.pumpDesign(
            widget,
            brightness: brightness,
            textScale: scale,
            size: size,
          );
          await expectLater(
            find.byType(Scaffold),
            matchesGoldenFile('goldens/${name}_${brightness.name}$suffix.png'),
          );
        });
      }
    }
  }
}
