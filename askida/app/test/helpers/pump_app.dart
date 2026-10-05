import 'package:askida/app.dart';
import 'package:askida/core/env/app_env.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/core/time/clock.dart';
import 'package:askida/data/db/app_database.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/routing/app_router.dart';
import 'package:askida/routing/deep_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../fakes/fake_deep_link_source.dart';
import 'test_database.dart';

final testEnv = AppEnv.parse('http://10.0.2.2:58080/api/v1');

/// "Now" in widget tests unless a test passes its own.
final testNow = DateTime(2026, 10, 4, 9, 41);

/// Handles of a pumped app.
class TestApp {
  new({
    required this.container,
    required this.tokens,
    required this.deepLinks,
    required this.database,
  });

  final ProviderContainer container;
  final InMemoryTokenStore tokens;
  final FakeDeepLinkSource deepLinks;
  final AppDatabase database;

  GoRouter get router => container.read(appRouterProvider);

  /// Current location of the app router.
  String get location =>
      router.routerDelegate.currentConfiguration.uri.toString();
}

/// Overrides every app seam with an in-process stand-in: env, token store,
/// database, deep links, clock and session restore. [extra] overrides
/// come last and win (repositories, push, location, tiles...).
List<Override> testOverrides({
  required InMemoryTokenStore tokens,
  required AppDatabase database,
  required FakeDeepLinkSource deepLinks,
  required DateTime now,
  required SessionState session,
  List<Override> extra = const [],
}) => [
  appEnvProvider.overrideWithValue(testEnv),
  tokenStoreProvider.overrideWithValue(tokens),
  appDatabaseProvider.overrideWithValue(database),
  deepLinkSourceProvider.overrideWithValue(deepLinks),
  clockProvider.overrideWithValue(() => now),
  sessionRestoreProvider.overrideWith((ref) async {
    ref
        .read(sessionProvider.notifier)
        .restored(
          hasUserToken: session.hasUserToken,
          hasAnonToken: session.hasAnonToken,
          user: session.user,
        );
  }),
  ...extra,
];

void _configureView(
  WidgetTester tester, {
  required double textScale,
  required Brightness brightness,
  Size? size,
}) {
  tester.platformDispatcher
    ..textScaleFactorTestValue = textScale
    ..platformBrightnessTestValue = brightness;
  addTearDown(tester.platformDispatcher.clearAllTestValues);
  if (size != null) {
    tester.view
      ..physicalSize = size
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }
}

extension PumpApp on WidgetTester {
  /// Pumps the real app (`AskidaApp`: real theme, real router, tr/en
  /// delegates) with [testOverrides]. [session] is what the restore step
  /// reports; by default nobody is signed in.
  Future<TestApp> pumpAskida({
    Locale? locale,
    List<Override> overrides = const [],
    SessionState session = const SessionState(restored: true),
    double textScale = 1,
    Brightness brightness = Brightness.light,
    Size? size,
    DateTime? now,
    String? initialLocation,
    bool settle = true,
  }) async {
    _configureView(
      this,
      textScale: textScale,
      brightness: brightness,
      size: size,
    );
    final tokens = InMemoryTokenStore();
    final database = testDatabase();
    final deepLinks = FakeDeepLinkSource();
    addTearDown(database.close);
    addTearDown(deepLinks.close);
    final container = ProviderContainer(
      overrides: testOverrides(
        tokens: tokens,
        database: database,
        deepLinks: deepLinks,
        now: now ?? testNow,
        session: session,
        extra: overrides,
      ),
    );
    addTearDown(container.dispose);
    await pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: AskidaApp(locale: locale),
      ),
    );
    final app = TestApp(
      container: container,
      tokens: tokens,
      deepLinks: deepLinks,
      database: database,
    );
    if (initialLocation != null) app.router.go(initialLocation);
    if (settle) await pumpAndSettle();
    return app;
  }

  /// Pumps one [screen] inside `MaterialApp.router` with the real theme and
  /// the tr delegates, for feature screen tests that do not need the shell.
  /// Extra [routes] let the screen navigate (`context.go('/x')`).
  Future<ProviderContainer> pumpScreen(
    Widget screen, {
    List<Override> overrides = const [],
    List<RouteBase> routes = const [],
    Locale locale = const Locale('tr', 'TR'),
    double textScale = 1,
    Brightness brightness = Brightness.light,
    Size? size,
    DateTime? now,
    bool settle = true,
  }) async {
    _configureView(
      this,
      textScale: textScale,
      brightness: brightness,
      size: size,
    );
    final database = testDatabase();
    final deepLinks = FakeDeepLinkSource();
    addTearDown(database.close);
    addTearDown(deepLinks.close);
    final container = ProviderContainer(
      overrides: testOverrides(
        tokens: InMemoryTokenStore(),
        database: database,
        deepLinks: deepLinks,
        now: now ?? testNow,
        session: const SessionState(restored: true),
        extra: overrides,
      ),
    );
    addTearDown(container.dispose);
    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (context, state) => screen),
        ...routes,
      ],
    );
    addTearDown(router.dispose);
    await pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          debugShowCheckedModeBanner: false,
          theme: AskidaTheme.light(),
          darkTheme: AskidaTheme.dark(),
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    if (settle) await pumpAndSettle();
    return container;
  }
}
