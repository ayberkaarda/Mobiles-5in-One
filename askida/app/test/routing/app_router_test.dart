import 'package:askida/data/session.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/widgets/mode_switcher.dart';
import 'package:askida/features/auth/auth_routes.dart';
import 'package:askida/features/donor/donor_routes.dart';
import 'package:askida/features/merchant/merchant_routes.dart';
import 'package:askida/features/recipient/recipient_routes.dart';
import 'package:askida/features/settings/settings_routes.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_router.dart';
import 'package:askida/routing/feature_routes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../fakes/fake_auth_repository.dart';
import '../helpers/pump_app.dart';

/// A router with a few registered feature routes, as the workers will add.
GoRouter _routerWith({
  required SessionState Function() session,
  Listenable? refresh,
  ModeTracker? modes,
}) => buildAppRouter(
  readSession: session,
  refreshListenable: refresh,
  modes: modes,
  childRoutesFor: (mode) => [
    GoRoute(
      path: 'shop/:slug',
      builder: (context, state) =>
          Text('${mode.name} shop ${state.pathParameters['slug']}'),
    ),
    if (mode == AppMode.merchant)
      GoRoute(
        path: 'redemptions',
        builder: (context, state) => const Text('redemptions'),
      ),
    if (mode == AppMode.donor)
      GoRoute(
        path: 'donation/:id',
        builder: (context, state) => Text(
          'receipt ${state.pathParameters['id']} '
          '${state.uri.queryParameters['status']}',
        ),
      ),
  ],
  topLevelRoutes: [
    GoRoute(
      path: '/auth',
      builder: (context, state) =>
          Text('auth from ${state.uri.queryParameters['from']}'),
    ),
  ],
);

Future<void> _pumpRouter(WidgetTester tester, GoRouter router) async {
  addTearDown(router.dispose);
  await tester.pumpWidget(
    MaterialApp.router(
      theme: AskidaTheme.light(),
      locale: const Locale('tr', 'TR'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      routerConfig: router,
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('every feature route list is registered', () {
    expect(allFeatureRoutes, [
      ...authRoutes,
      ...recipientRoutes,
      ...merchantRoutes,
      ...donorRoutes,
      ...settingsRoutes,
    ]);
    expect(topLevelFeatureRoutes, [...authRoutes, ...settingsRoutes]);
    expect(modeChildRoutes(AppMode.recipient), same(recipientRoutes));
    expect(modeChildRoutes(AppMode.donor), same(donorRoutes));
    expect(modeChildRoutes(AppMode.merchant), same(merchantRoutes));
  });

  testWidgets('unknown locations land on the current mode home', (
    tester,
  ) async {
    final app = await tester.pumpAskida(locale: const Locale('tr'));
    app.router.go('/donor');
    await tester.pumpAndSettle();

    app.router.go('/nowhere/at/all');
    await tester.pumpAndSettle();

    expect(app.location, '/donor');
    expect(find.text('Askıda bıraktığın bir şey yok'), findsOneWidget);
  });

  testWidgets('an unknown deep link opens the current mode home', (
    tester,
  ) async {
    final app = await tester.pumpAskida(locale: const Locale('tr'));
    app.router.go('/merchant');
    await tester.pumpAndSettle();

    app.deepLinks.add(Uri.parse('askida://elsewhere/1'));
    await tester.pumpAndSettle();

    expect(app.location, '/merchant');
    expect(find.byType(ModeSwitcher), findsOneWidget);
  });

  testWidgets('shop links open in the current mode (merchant -> donor)', (
    tester,
  ) async {
    final tracker = ModeTracker();
    final router = _routerWith(
      session: () => const SessionState(restored: true),
      modes: tracker,
    );
    await _pumpRouter(tester, router);

    openDeepLink(router, tracker, Uri.parse('askida://shop/ornek-firin'));
    await tester.pumpAndSettle();
    expect(find.text('recipient shop ornek-firin'), findsOneWidget);

    router.go('/merchant');
    await tester.pumpAndSettle();
    openDeepLink(
      router,
      tracker,
      Uri.parse('https://askida.app/dukkan/ornek-firin'),
    );
    await tester.pumpAndSettle();
    expect(find.text('donor shop ornek-firin'), findsOneWidget);
  });

  testWidgets('the checkout return link opens the receipt', (tester) async {
    final tracker = ModeTracker();
    final router = _routerWith(
      session: () => SessionState(
        user: FakeAuthRepository.sampleDonor(),
        hasUserToken: true,
        restored: true,
      ),
      modes: tracker,
    );
    await _pumpRouter(tester, router);

    openDeepLink(
      router,
      tracker,
      Uri.parse('askida://donation/abc-1?status=paid'),
    );
    await tester.pumpAndSettle();

    expect(find.text('receipt abc-1 paid'), findsOneWidget);
  });

  testWidgets('guards send a guest to auth with from, then let a merchant in', (
    tester,
  ) async {
    var session = const SessionState(restored: true);
    final refresh = ValueNotifier(0);
    addTearDown(refresh.dispose);
    final router = _routerWith(session: () => session, refresh: refresh);
    await _pumpRouter(tester, router);

    router.go('/merchant/redemptions');
    await tester.pumpAndSettle();
    expect(find.text('auth from /merchant/redemptions'), findsOneWidget);

    session = SessionState(
      user: FakeAuthRepository.sampleMerchant(),
      hasUserToken: true,
      restored: true,
    );
    router.go('/merchant/redemptions');
    await tester.pumpAndSettle();
    expect(find.text('redemptions'), findsOneWidget);

    // Signing out on a protected screen re-runs the guard.
    session = const SessionState(restored: true);
    refresh.value++;
    await tester.pumpAndSettle();
    expect(find.text('auth from /merchant/redemptions'), findsOneWidget);
  });

  testWidgets('the app router follows session changes', (tester) async {
    final app = await tester.pumpAskida(
      locale: const Locale('tr'),
      session: SessionState(
        user: FakeAuthRepository.sampleDonor(),
        hasUserToken: true,
        restored: true,
      ),
    );
    expect(app.container.read(sessionProvider).isDonor, isTrue);

    app.container.read(sessionProvider.notifier).signedOut();
    await tester.pumpAndSettle();

    expect(app.container.read(sessionProvider).isSignedIn, isFalse);
    expect(app.location, '/recipient');
  });
}
