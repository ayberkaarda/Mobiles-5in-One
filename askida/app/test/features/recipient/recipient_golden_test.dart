@Tags(['golden'])
library;

import 'package:askida/data/models/shop.dart';
import 'package:askida/features/recipient/presentation/code_screen.dart';
import 'package:askida/features/recipient/presentation/location_step.dart';
import 'package:askida/features/recipient/presentation/nearby_shops_view.dart';
import 'package:askida/features/recipient/presentation/onboarding_intro.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:askida/features/recipient/presentation/shop_detail_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/pump_app.dart';
import 'recipient_helpers.dart';

/// Recipient screens at text scale 1.0 (360 px) and 1.3 (320 px), light and
/// dark for the code ticket. Rendered and compared on the Windows host only
/// (see dart_test.yaml). Regenerate with:
///   flutter test --update-goldens --tags golden test/features/recipient
void main() {
  const goldenKey = ValueKey('recipient-golden');
  const point = GeoPoint(lat: 41.06, lng: 28.99);

  final screens = <String, (Widget, double)>{
    'intro': (OnboardingIntro(onStart: () {}), 760),
    'location': (const LocationStep(), 640),
    'nearby': (const NearbyShopsView(point: point), 1500),
    'shop': (const RecipientShopScreen(slug: sampleSlug), 900),
    'code': (const CodeScreen(), 1100),
  };

  final variants = <(String, double, double, Brightness)>[
    ('360_1.0_light', 360, 1, Brightness.light),
    ('320_1.3_light', 320, 1.3, Brightness.light),
  ];

  for (final MapEntry(key: name, value: (screen, height)) in screens.entries) {
    final cases = [
      ...variants,
      if (name == 'code') ('360_1.0_dark', 360.0, 1.0, Brightness.dark),
    ];
    for (final (label, width, scale, brightness) in cases) {
      testWidgets('$name $label', (tester) async {
        final fakes = RecipientFakes();
        final container = await tester.pumpScreen(
          RepaintBoundary(
            key: goldenKey,
            child: Scaffold(body: screen),
          ),
          overrides: fakes.overrides,
          textScale: scale,
          brightness: brightness,
          size: Size(width, height * (scale > 1 ? 1.3 : 1)),
        );
        if (name == 'code') {
          container
              .read(activeCodeProvider.notifier)
              .hold(sampleReservation(), shopSlug: sampleSlug);
        }
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await expectLater(
          find.byKey(goldenKey),
          matchesGoldenFile('goldens/${name}_$label.png'),
        );
      });
    }
  }
}
