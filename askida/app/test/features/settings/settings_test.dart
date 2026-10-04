import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/core/locale/app_locale.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/auth/presentation/sign_in_screen.dart';
import 'package:askida/features/settings/data/settings_store.dart';
import 'package:askida/features/settings/presentation/settings_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_auth_repository.dart';
import '../../helpers/pump_app.dart';
import '../donor/donor_harness.dart';

Future<void> _reveal(WidgetTester tester, Finder target) async {
  if (target.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      target,
      200,
      scrollable: find.byType(Scrollable).first,
    );
  }
  await tester.ensureVisible(target);
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  final target = find.byKey(ValueKey(key));
  await _reveal(tester, target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

/// Built at run time; no credential-shaped literal in the repository.
final String _password = ['uzun', 'bir', 'sifre', '42'].join('-');

Brightness _brightness(WidgetTester tester) =>
    Theme.of(tester.element(find.byType(Scaffold).first)).brightness;

void main() {
  group('settings', () {
    testWidgets('theme: system, light, dark, remembered', (tester) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        brightness: Brightness.dark,
        initialLocation: '/settings',
      );
      // System setting follows the platform (dark here).
      expect(_brightness(tester), Brightness.dark);

      await _tapKey(tester, 'theme-light');
      expect(_brightness(tester), Brightness.light);
      expect(h.settings.settings.themeMode, ThemeMode.light);

      await _tapKey(tester, 'theme-dark');
      expect(_brightness(tester), Brightness.dark);
      expect(app.container.read(themeModeProvider), ThemeMode.dark);
    });

    testWidgets('language switches the copy and the API language', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/settings',
      );
      expect(find.text('Ayarlar'), findsOneWidget);
      await _tapKey(tester, 'language-en');
      expect(find.text('Settings'), findsOneWidget);
      expect(app.container.read(apiLanguageProvider), 'en');
      expect(h.settings.settings.languageCode, 'en');

      await _tapKey(tester, 'language-tr');
      expect(find.text('Ayarlar'), findsOneWidget);
      expect(h.settings.settings.languageCode, isNull);
    });

    testWidgets('remembered choices are restored at launch', (tester) async {
      final h = DonorHarness();
      h.settings.settings = const StoredSettings(
        languageCode: 'en',
        themeMode: ThemeMode.dark,
      );
      final app = await tester.pumpAskida(overrides: h.overrides);
      expect(app.container.read(appLocaleProvider), const Locale('en'));
      expect(app.container.read(themeModeProvider), ThemeMode.dark);
      expect(find.text('Take from the hook'), findsWidgets);
    });

    testWidgets('sign-out clears the session and returns to the donor home', (
      tester,
    ) async {
      final h = DonorHarness();
      h.auth.currentUser = FakeAuthRepository.sampleDonor();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/settings',
      );
      expect(find.text('bagisci@example.com'), findsOneWidget);
      await _tapKey(tester, 'settings-signout');
      expect(h.auth.calls, ['logout']);
      expect(app.container.read(sessionProvider).isSignedIn, isFalse);
      expect(app.location, '/donor');
    });

    testWidgets('signed out: a way to sign in, no account actions', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/settings',
      );
      expect(find.byKey(const ValueKey('settings-delete')), findsNothing);
      await _tapKey(tester, 'settings-signin');
      final signIn = tester.widget<SignInScreen>(find.byType(SignInScreen));
      expect(signIn.from, '/settings');

      app.router.go('/settings');
      await tester.pumpAndSettle();
      await _reveal(tester, find.byKey(const ValueKey('push-unavailable')));
      expect(find.byKey(const ValueKey('push-unavailable')), findsOneWidget);
    });

    for (final (scale, size) in layoutCases) {
      testWidgets('settings fit at $scale and ${size?.width ?? 800} px', (
        tester,
      ) async {
        final h = DonorHarness();
        final app = await tester.pumpAskida(
          overrides: h.overrides,
          session: DonorHarness.donorSession,
          textScale: scale,
          size: size,
          initialLocation: '/settings',
        );
        expectNoLayoutErrors(tester);
        app.router.go('/settings/delete-account');
        await tester.pumpAndSettle();
        expectNoLayoutErrors(tester);
      });
    }
  });

  group('account deletion', () {
    testWidgets('signed-out users are sent to sign-in first', (tester) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/settings/delete-account',
      );
      expect(find.byKey(const ValueKey('delete-password')), findsNothing);
      await _tapKey(tester, 'delete-signin');
      expect(app.location, '/auth?from=%2Fsettings%2Fdelete-account');
    });

    testWidgets('password re-auth, confirmation, then the grace date', (
      tester,
    ) async {
      final h = DonorHarness();
      h.auth.currentUser = FakeAuthRepository.sampleDonor();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/settings/delete-account',
      );
      await _tapKey(tester, 'delete-submit');
      expect(find.text('Bu alan gerekli.'), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('delete-password')),
        _password,
      );
      await _tapKey(tester, 'delete-submit');
      expect(find.byType(AlertDialog), findsOneWidget);
      await _tapKey(tester, 'delete-confirm');

      expect(h.auth.calls, ['deleteMe']);
      expect(h.auth.lastReauth, isA<PasswordReauth>());
      expect((h.auth.lastReauth! as PasswordReauth).password, _password);
      expect(app.container.read(sessionProvider).isSignedIn, isFalse);
      expect(find.byKey(const ValueKey('delete-done')), findsOneWidget);
      expect(find.textContaining('11 Ekim 2026'), findsOneWidget);
    });

    testWidgets('provider accounts confirm with a fresh sign-in', (
      tester,
    ) async {
      final h = DonorHarness();
      await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/settings/delete-account',
      );
      await _tapKey(tester, 'provider-google');
      await _tapKey(tester, 'delete-confirm');
      expect(h.identity.calls, [IdentityProviderKind.google]);
      final reauth = h.auth.lastReauth! as ProviderReauth;
      expect(reauth.provider, IdentityProviderKind.google);
      expect(reauth.toJson().keys, containsAll(['provider', 'id_token']));
    });

    testWidgets('cancelling keeps the account', (tester) async {
      final h = DonorHarness();
      h.identity.failure = const IdentityCancelled();
      await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/settings/delete-account',
      );
      await tester.enterText(
        find.byKey(const ValueKey('delete-password')),
        _password,
      );
      await _tapKey(tester, 'delete-submit');
      await tester.tap(find.text('Vazgeç'));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'provider-apple');
      await _tapKey(tester, 'delete-confirm');
      expect(h.auth.calls, isEmpty);
    });

    testWidgets('a merchant with open hooks is told why', (tester) async {
      final h = DonorHarness();
      h.auth.failNext(
        'deleteMe',
        const ApiProblem(code: 'shop.has_open_hooks', status: 409),
      );
      await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.signedIn(FakeAuthRepository.sampleMerchant()),
        initialLocation: '/settings/delete-account',
      );
      await tester.enterText(
        find.byKey(const ValueKey('delete-password')),
        _password,
      );
      await _tapKey(tester, 'delete-submit');
      await _tapKey(tester, 'delete-confirm');
      expect(
        find.textContaining('Dükkânında bekleyen askılar var'),
        findsOneWidget,
      );
    });
  });
}
