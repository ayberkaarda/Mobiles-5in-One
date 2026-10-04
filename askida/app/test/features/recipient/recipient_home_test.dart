import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/design/widgets/rail_counter.dart';
import 'package:askida/design/widgets/shop_card.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/discovery/presentation/shop_map_view.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:askida/features/recipient/presentation/widgets/impact_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_shops_repository.dart';
import '../../helpers/pump_app.dart';
import 'recipient_helpers.dart';

Finder byKey(String key) => find.byKey(ValueKey(key));

void main() {
  group('onboarding', () {
    testWidgets('screen 1: station rail and one sentence, no account wall', (
      tester,
    ) async {
      final fakes = RecipientFakes();
      final app = await tester.pumpAskida(overrides: fakes.overrides);

      expect(app.location, '/recipient');
      expect(byKey('recipient-intro'), findsOneWidget);
      expect(find.text('Askıda bekleyeni al, soru sorulmaz.'), findsOneWidget);
      expect(find.text('Bırak'), findsOneWidget);
      expect(find.text('Al'), findsOneWidget);
      // Nothing asks for an account or a sign-in.
      expect(find.textContaining('Giriş'), findsNothing);
      expect(find.textContaining('hesap aç'), findsNothing);
      // Location is not asked for before the person chooses to continue.
      expect(fakes.location.requests, 0);
    });

    testWidgets('screen 2 -> 3 with the approximate device location', (
      tester,
    ) async {
      final fakes = RecipientFakes();
      await tester.pumpAskida(overrides: fakes.overrides);

      await tester.tap(byKey('recipient-intro-start'));
      await tester.pumpAndSettle();
      expect(byKey('recipient-location'), findsOneWidget);
      expect(
        find.text('Yakındaki askılar için yaklaşık konum'),
        findsOneWidget,
      );
      expect(byKey('recipient-pick-district'), findsOneWidget);

      await tester.tap(byKey('recipient-use-location'));
      await tester.pumpAndSettle();

      expect(fakes.location.requests, 1);
      expect(fakes.location.preciseCalls, [false]);
      // Only the two-decimal point leaves the device.
      final query = fakes.shops.lastNearby!;
      expect(query.lat, 41.06);
      expect(query.lng, 28.99);
      expect(query.radiusM, 3000);
      expect(query.hasAvailable, isTrue);

      expect(byKey('recipient-nearby'), findsOneWidget);
      expect(find.text('Yaklaşık konumun'), findsOneWidget);
      expect(find.byType(ShopCard), findsOneWidget);
      expect(find.byType(RailCounter), findsOneWidget);
      expect(find.text('ÖRNEK'), findsWidgets);
      // Impact for the nearest shop's district.
      expect(fakes.impact.lastQuery, (il: 'İstanbul', ilce: 'Şişli'));
      await tester.dragUntilVisible(
        find.byType(RecipientImpactCard),
        byKey('recipient-nearby'),
        const Offset(0, -200),
      );
      expect(find.text('Bugün İstanbul'), findsOneWidget);
      expect(find.text('184'), findsOneWidget);
    });

    testWidgets('granted permission skips screens 1 and 2', (tester) async {
      final fakes = RecipientFakes(permission: LocationPermissionState.granted);
      await tester.pumpAskida(overrides: fakes.overrides);

      expect(byKey('recipient-nearby'), findsOneWidget);
      expect(fakes.location.requests, 0);
      expect(fakes.shops.lastNearby!.lat, 41.06);
    });

    testWidgets('a returning device skips screen 1', (tester) async {
      final fakes = RecipientFakes();
      await tester.pumpAskida(overrides: fakes.overrides, session: anonSession);

      expect(byKey('recipient-intro'), findsNothing);
      expect(byKey('recipient-location'), findsOneWidget);
    });

    testWidgets('refused for good: only the district picker remains', (
      tester,
    ) async {
      final fakes = RecipientFakes(
        permission: LocationPermissionState.deniedForever,
      );
      await tester.pumpAskida(overrides: fakes.overrides, session: anonSession);

      expect(byKey('recipient-use-location'), findsNothing);
      expect(byKey('recipient-location-blocked'), findsOneWidget);

      await tester.tap(byKey('recipient-pick-district'));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        byKey('district-Ankara-Çankaya'),
        find.byType(BottomSheet),
        const Offset(0, -200),
      );
      await tester.tap(byKey('district-Ankara-Çankaya'));
      await tester.pumpAndSettle();

      final query = fakes.shops.lastNearby!;
      expect((query.lat, query.lng), (39.92, 32.85));
      expect(find.text('Çankaya, Ankara'), findsOneWidget);
      expect(fakes.impact.lastQuery, (il: 'Ankara', ilce: 'Çankaya'));
    });

    testWidgets('"Değiştir" returns to the location step', (tester) async {
      final fakes = RecipientFakes(permission: LocationPermissionState.granted);
      final app = await tester.pumpAskida(overrides: fakes.overrides);

      await tester.tap(byKey('recipient-change-area'));
      await tester.pumpAndSettle();
      expect(byKey('recipient-nearby'), findsNothing);
      expect(app.location, '/recipient');
    });
  });

  group('nearby list', () {
    testWidgets('a shop opens its detail', (tester) async {
      final fakes = RecipientFakes(permission: LocationPermissionState.granted);
      final app = await tester.pumpAskida(overrides: fakes.overrides);

      await tester.tap(find.text('[ÖRNEK] Köşe Fırını'));
      await tester.pumpAndSettle();
      expect(app.location, '/recipient/shop/$sampleSlug');
    });

    testWidgets('the map shows the same shops with fake tiles', (tester) async {
      final fakes = RecipientFakes(permission: LocationPermissionState.granted);
      await tester.pumpAskida(overrides: fakes.overrides);

      await tester.tap(find.text('Harita'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      final map = tester.widget<ShopMapView>(find.byType(ShopMapView));
      expect(map.center, const GeoPoint(lat: 41.06, lng: 28.99));
      expect(map.shops, hasLength(1));
      expect(fakes.tiles.requested, isNotEmpty);
    });

    testWidgets('nothing nearby: calm empty state, widen to 5 km', (
      tester,
    ) async {
      final fakes = RecipientFakes(permission: LocationPermissionState.granted)
        ..shops.shops = [];
      final app = await tester.pumpAskida(overrides: fakes.overrides);

      expect(
        find.text('Yakında askıda bekleyen bir şey görünmüyor'),
        findsOneWidget,
      );
      await tester.tap(byKey('recipient-widen'));
      await tester.pumpAndSettle();
      expect(fakes.shops.lastNearby!.radiusM, 5000);
      expect(app.container.read(recipientRadiusProvider), 5000);
      expect(byKey('recipient-widen'), findsNothing);
    });

    testWidgets('offline: the cached list is shown', (tester) async {
      final fakes = RecipientFakes();
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        session: anonSession,
      );
      await app.database.upsertShopSummaries(
        FakeShopsRepository.sampleShops(),
        testNow,
      );
      fakes.shops.failAlways(
        'nearby',
        const ApiProblem(code: ApiProblem.networkOffline, status: 0),
      );

      await tester.tap(byKey('recipient-use-location'));
      await tester.pumpAndSettle();

      expect(find.text('[ÖRNEK] Köşe Fırını'), findsOneWidget);
      expect(byKey('recipient-problem'), findsNothing);
    });

    testWidgets('offline with nothing cached: message and retry', (
      tester,
    ) async {
      final fakes = RecipientFakes(permission: LocationPermissionState.granted)
        ..shops.failNext(
          'nearby',
          const ApiProblem(code: ApiProblem.networkOffline, status: 0),
        );
      await tester.pumpAskida(overrides: fakes.overrides);

      expect(
        find.text(
          'İnternet bağlantısı yok. Bağlantını kontrol edip yeniden dene.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Yeniden dene'));
      await tester.pumpAndSettle();
      expect(find.byType(ShopCard), findsOneWidget);
    });

    testWidgets('impact failures leave the list alone', (tester) async {
      final fakes = RecipientFakes(permission: LocationPermissionState.granted)
        ..impact.failAlways(
          'impact',
          const ApiProblem(code: 'server_error', status: 500),
        );
      await tester.pumpAskida(overrides: fakes.overrides);

      expect(find.byType(ShopCard), findsOneWidget);
      expect(find.byType(RecipientImpactCard), findsNothing);
    });
  });

  group('layout', () {
    for (final (scale, width) in [(1.0, 360.0), (1.3, 360.0), (1.3, 320.0)]) {
      testWidgets('no overflow at text scale $scale, $width px', (
        tester,
      ) async {
        final fakes = RecipientFakes();
        await tester.pumpAskida(
          overrides: fakes.overrides,
          textScale: scale,
          size: Size(width, 640),
        );
        expect(tester.takeException(), isNull);

        await tester.drag(byKey('recipient-intro'), const Offset(0, -400));
        await tester.pumpAndSettle();
        await tester.tap(byKey('recipient-intro-start'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);

        await tester.drag(byKey('recipient-location'), const Offset(0, -400));
        await tester.pumpAndSettle();
        await tester.tap(byKey('recipient-use-location'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.dragUntilVisible(
          byKey('recipient-reset'),
          byKey('recipient-nearby'),
          const Offset(0, -200),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('interactive elements carry labels', (tester) async {
      final handle = tester.ensureSemantics();
      final fakes = RecipientFakes(permission: LocationPermissionState.granted);
      await tester.pumpAskida(overrides: fakes.overrides);

      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      handle.dispose();
    });
  });
}
