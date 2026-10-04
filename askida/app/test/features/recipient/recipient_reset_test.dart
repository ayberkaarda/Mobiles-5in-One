import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/discovery/presentation/coarse_location.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_shops_repository.dart';
import '../../helpers/fixtures.dart';
import '../../helpers/pump_app.dart';
import 'recipient_helpers.dart';

Finder byKey(String key) => find.byKey(ValueKey(key));

Future<void> reset(WidgetTester tester) async {
  await tester.dragUntilVisible(
    byKey('recipient-reset'),
    byKey('recipient-nearby'),
    const Offset(0, -200),
  );
  await tester.tap(byKey('recipient-reset'));
  await tester.pumpAndSettle();
  expect(find.text('Verilerimi sıfırla'), findsWidgets);
  await tester.tap(byKey('recipient-reset-confirm'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('"Verilerimi sıfırla" deletes the anonymous identity', (
    tester,
  ) async {
    final fakes = RecipientFakes(permission: LocationPermissionState.granted);
    final app = await tester.pumpAskida(
      overrides: fakes.overrides,
      session: anonSession,
    );
    await app.tokens.writeAnon(dummyToken('anon'));
    app.container
        .read(activeCodeProvider.notifier)
        .hold(sampleReservation(), shopSlug: sampleSlug);
    app.container.read(recipientRadiusProvider.notifier).widen();
    await tester.pumpAndSettle();
    expect(
      await app.database.shopsNear(41.06, 28.99, radiusM: 5000, now: testNow),
      isNotEmpty,
    );

    await reset(tester);

    expect(fakes.anon!.calls, ['deleteMe']);
    expect(await app.tokens.readAnon(), isNull);
    final session = app.container.read(sessionProvider);
    expect(session.hasAnonToken, isFalse);
    expect(app.container.read(activeCodeProvider), isNull);
    expect(app.container.read(coarseLocationProvider).point, isNull);
    expect(app.container.read(recipientRadiusProvider), 3000);
    expect(find.text('Verilerin sıfırlandı.'), findsOneWidget);
    // Back to the first onboarding screen.
    expect(byKey('recipient-intro'), findsOneWidget);
  });

  testWidgets('server unreachable: device data wiped, honest message', (
    tester,
  ) async {
    final fakes = RecipientFakes(permission: LocationPermissionState.granted)
      ..configureAnon = (anon) => anon.failNext(
        'deleteMe',
        const ApiProblem(code: ApiProblem.networkOffline, status: 0),
      );
    final app = await tester.pumpAskida(
      overrides: fakes.overrides,
      session: anonSession,
    );

    await reset(tester);

    expect(app.container.read(sessionProvider).hasAnonToken, isFalse);
    expect(find.textContaining('Cihazdaki veriler silindi.'), findsOneWidget);
  });

  testWidgets('without an identity only the device cache is wiped', (
    tester,
  ) async {
    final fakes = RecipientFakes(permission: LocationPermissionState.granted);
    // Default session: restored, no identity.
    final app = await tester.pumpAskida(overrides: fakes.overrides);
    await app.database.upsertShopSummaries(
      FakeShopsRepository.sampleShops(),
      testNow,
    );

    await reset(tester);

    expect(fakes.anon?.calls ?? const <String>[], isEmpty);
    expect(
      await app.database.shopsNear(41.06, 28.99, radiusM: 5000, now: testNow),
      isEmpty,
    );
    expect(find.text('Verilerin sıfırlandı.'), findsOneWidget);
  });

  testWidgets('cancel keeps everything', (tester) async {
    final fakes = RecipientFakes(permission: LocationPermissionState.granted);
    final app = await tester.pumpAskida(
      overrides: fakes.overrides,
      session: anonSession,
    );
    await tester.dragUntilVisible(
      byKey('recipient-reset'),
      byKey('recipient-nearby'),
      const Offset(0, -200),
    );
    await tester.tap(byKey('recipient-reset'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Vazgeç'));
    await tester.pumpAndSettle();

    expect(fakes.anon?.calls ?? const <String>[], isEmpty);
    expect(app.container.read(sessionProvider).hasAnonToken, isTrue);
    expect(
      app.container.read(coarseLocationProvider).point,
      const GeoPoint(lat: 41.06, lng: 28.99),
    );
  });
}
