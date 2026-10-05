import 'package:askida/design/theme.dart';
import 'package:askida/features/recipient/presentation/code_screen.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../helpers/pump_app.dart';
import 'recipient_helpers.dart';

Finder byKey(String key) => find.byKey(ValueKey(key));

/// The code screen with a clock the test moves (the shared pump helpers
/// pin the clock).
Future<(RecipientFakes, ProviderContainer, GoRouter)> pumpMovingClock(
  WidgetTester tester,
) async {
  tester.view
    ..physicalSize = const Size(360, 1100)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final fakes = RecipientFakes();
  final container = ProviderContainer(
    overrides: [...fakes.overrides, fakes.clockOverride],
  );
  addTearDown(container.dispose);
  container
      .read(activeCodeProvider.notifier)
      .hold(sampleReservation(), shopSlug: sampleSlug);
  final router = GoRouter(
    initialLocation: '/recipient/code',
    routes: [
      GoRoute(
        path: '/recipient/code',
        builder: (context, state) => const CodeScreen(),
      ),
      GoRoute(
        path: '/recipient/shop/:slug',
        builder: (context, state) =>
            Text('shop ${state.pathParameters['slug']}'),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        theme: AskidaTheme.light(),
        locale: const Locale('tr', 'TR'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: router,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (fakes, container, router);
}

void main() {
  testWidgets('counts down once a second from the server expiry', (
    tester,
  ) async {
    final (fakes, _, _) = await pumpMovingClock(tester);
    expect(find.text('Kalan süre 10:00'), findsOneWidget);

    fakes.now = testNow.add(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Kalan süre 09:59'), findsOneWidget);

    fakes.now = testNow.add(const Duration(minutes: 9, seconds: 30));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Kalan süre 00:30'), findsOneWidget);
  });

  testWidgets('at expiry the tag is replaced and leads back to the shop', (
    tester,
  ) async {
    final (fakes, container, router) = await pumpMovingClock(tester);

    fakes.now = testNow.add(const Duration(minutes: 10));
    await tester.pump(const Duration(seconds: 1));
    expect(byKey('recipient-code-expired'), findsOneWidget);
    expect(find.text('K7M2 QX9R'), findsNothing);
    expect(find.text('Kodun süresi doldu'), findsOneWidget);

    // No automatic refresh: nothing new was asked for.
    expect(fakes.hooks.calls, isEmpty);

    await tester.tap(byKey('recipient-code-back-to-shop'));
    await tester.pumpAndSettle();
    expect(container.read(activeCodeProvider), isNull);
    expect(find.text('shop $sampleSlug'), findsOneWidget);
    expect(
      router.routerDelegate.currentConfiguration.uri.path,
      '/recipient/shop/$sampleSlug',
    );
  });

  testWidgets('the full-brightness view closes itself at expiry', (
    tester,
  ) async {
    final (fakes, _, _) = await pumpMovingClock(tester);

    await tester.tap(find.text('Kodu esnafa göster'));
    await tester.pumpAndSettle();
    expect(byKey('recipient-full-brightness'), findsOneWidget);

    fakes.now = testNow.add(const Duration(minutes: 10, seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(byKey('recipient-full-brightness'), findsNothing);
    expect(fakes.brightness.calls, [true, false]);
    expect(byKey('recipient-code-expired'), findsOneWidget);
  });
}
