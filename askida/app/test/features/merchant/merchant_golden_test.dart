@Tags(['golden'])
library;

import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:askida/features/merchant/merchant_home_screen.dart';
import 'package:askida/features/merchant/presentation/screens/catalog_screen.dart';
import 'package:askida/features/merchant/presentation/screens/payouts_screen.dart';
import 'package:askida/features/merchant/presentation/screens/redeem_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/pump_app.dart';
import 'merchant_harness.dart';

/// Merchant screens rendered on the Windows host (see dart_test.yaml).
/// Regenerate with:
///   flutter test --update-goldens --tags golden test/features/merchant
void main() {
  final owner = ownerShop(state: VerificationState.verified);
  final screens = <String, Widget>{
    'dashboard': MerchantDashboard(
      shop: MerchantShop(mine: MyShop.fromOwnerShop(owner), owner: owner),
    ),
    'redeem_success': RedeemSuccessView(
      result: RedeemResult(
        message: '',
        item: const NamedItem(name: 'Ekmek'),
        // Local time, so the golden does not depend on the host zone.
        redeemedAt: DateTime(2026, 10, 4, 9, 45),
      ),
      onNext: () {},
    ),
    'catalog': const CatalogScreen(),
    'payouts': const PayoutsScreen(),
  };
  const cases = [
    ('1x', 1.0, Size(360, 780), Brightness.light),
    ('1_3x_320', 1.3, Size(320, 640), Brightness.light),
    ('dark', 1.0, Size(360, 780), Brightness.dark),
  ];

  for (final MapEntry(key: name, value: screen) in screens.entries) {
    for (final (label, scale, size, brightness) in cases) {
      testWidgets('$name $label', (tester) async {
        final h = MerchantHarness(state: VerificationState.verified);
        await tester.pumpScreen(
          Scaffold(body: SafeArea(child: screen)),
          overrides: h.overrides,
          textScale: scale,
          size: size,
          brightness: brightness,
        );
        expect(tester.takeException(), isNull);
        await expectLater(
          find.byType(Scaffold),
          matchesGoldenFile('goldens/merchant_${name}_$label.png'),
        );
      });
    }
  }
}
