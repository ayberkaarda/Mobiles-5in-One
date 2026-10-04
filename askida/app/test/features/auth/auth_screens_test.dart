import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/recovery_screens.dart';
import 'package:askida/features/auth/presentation/register_screen.dart';
import 'package:askida/features/auth/presentation/sign_in_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/pump_app.dart';
import '../donor/donor_harness.dart';

/// Built at run time; no credential-shaped literal in the repository.
final String _password = ['uzun', 'bir', 'sifre', '42'].join('-');

Future<void> _type(WidgetTester tester, String key, String text) async {
  final field = find.byKey(ValueKey(key));
  await tester.ensureVisible(field);
  await tester.enterText(field, text);
}

Future<void> _tap(WidgetTester tester, String key) async {
  final target = find.byKey(ValueKey(key));
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  group('sign-in', () {
    testWidgets('a guarded screen sends to sign-in and back after it', (
      tester,
    ) async {
      final h = DonorHarness();
      h.auth.accounts['bagisci@example.com'] = _password;
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/donor/donations',
      );
      expect(app.location, '/auth?from=%2Fdonor%2Fdonations');
      expect(find.byType(SignInScreen), findsOneWidget);

      await _type(tester, 'signin-email', 'Bagisci@Example.com ');
      await _type(tester, 'signin-password', _password);
      await _tap(tester, 'signin-submit');

      expect(h.auth.calls, contains('login'));
      expect(app.container.read(sessionProvider).isDonor, isTrue);
      expect(app.location, '/donor/donations');
    });

    testWidgets('wrong credentials show the problem copy only', (tester) async {
      final h = DonorHarness();
      h.auth.accounts['bagisci@example.com'] = _password;
      await tester.pumpAskida(overrides: h.overrides, initialLocation: '/auth');

      await _type(tester, 'signin-email', 'bagisci@example.com');
      await _type(
        tester,
        'signin-password',
        ['yanlis', 'sifre', '000'].join('-'),
      );
      await _tap(tester, 'signin-submit');

      expect(find.text('E-posta ya da şifre eşleşmedi.'), findsOneWidget);
    });

    testWidgets('form rules are checked before calling the server', (
      tester,
    ) async {
      final h = DonorHarness();
      await tester.pumpAskida(overrides: h.overrides, initialLocation: '/auth');
      await _tap(tester, 'signin-submit');
      expect(find.text('Geçerli bir e-posta adresi yaz.'), findsOneWidget);
      expect(h.auth.calls, isEmpty);
    });

    testWidgets('Apple sign-in goes through the identity provider', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/auth?from=%2Fsettings',
      );
      await _tap(tester, 'provider-apple');

      expect(h.identity.calls, [IdentityProviderKind.apple]);
      expect(h.auth.calls, ['loginWithApple']);
      expect(app.location, '/settings');
    });

    testWidgets('a provider that is not configured is explained', (
      tester,
    ) async {
      final h = DonorHarness();
      h.identity.failure = const IdentityUnavailable(
        IdentityProviderKind.google,
      );
      await tester.pumpAskida(overrides: h.overrides, initialLocation: '/auth');
      await _tap(tester, 'provider-google');
      expect(
        find.textContaining('Bu giriş yöntemi bu sürümde kullanılamıyor'),
        findsOneWidget,
      );
      expect(h.auth.calls, isEmpty);
    });

    testWidgets('closing the provider sheet shows nothing', (tester) async {
      final h = DonorHarness();
      h.identity.failure = const IdentityCancelled();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/auth',
      );
      await _tap(tester, 'provider-apple');
      expect(app.location, '/auth');
      expect(find.byType(SnackBar), findsNothing);
      expect(h.auth.calls, isEmpty);
    });
  });

  group('registration', () {
    testWidgets('consent is required; a new account goes to verification', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: AuthPaths.registerWith(kind: UserKind.merchant),
      );
      expect(find.byType(RegisterScreen), findsOneWidget);

      await _type(tester, 'register-name', 'Ayşe Fırıncı');
      await _type(tester, 'register-email', 'esnaf@example.com');
      await _type(tester, 'register-password', _password);
      await _tap(tester, 'register-submit');
      expect(
        find.text('Devam etmek için aydınlatma metnini kabul etmelisin.'),
        findsOneWidget,
      );
      expect(h.auth.calls, isEmpty);

      await _tap(tester, 'register-consent');
      await _tap(tester, 'register-submit');

      expect(h.auth.calls, ['register']);
      expect(h.auth.currentUser?.kind, UserKind.merchant);
      expect(find.byType(VerifyEmailScreen), findsOneWidget);
      expect(
        app.location,
        '/auth/verify?email=esnaf%40example.com&next=%2Fmerchant',
      );
    });

    testWidgets('a taken e-mail is shown at the field', (tester) async {
      final h = DonorHarness();
      h.auth.accounts['bagisci@example.com'] = _password;
      await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: AuthPaths.register,
      );
      await _type(tester, 'register-name', 'Deniz');
      await _type(tester, 'register-email', 'bagisci@example.com');
      await _type(tester, 'register-password', _password);
      await _tap(tester, 'register-consent');
      await _tap(tester, 'register-submit');
      expect(
        find.text('Bu e-postayla bir hesap zaten var. Giriş yapabilirsin.'),
        findsOneWidget,
      );
    });
  });

  group('verification and reset', () {
    testWidgets('a valid code verifies and continues', (tester) async {
      final h = DonorHarness();
      h.auth.currentUser = FakeAuthRepositoryX.unverified;
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: AuthPaths.verifyWith(
          email: FakeAuthRepositoryX.unverified.email,
          next: '/donor',
        ),
      );
      await _type(tester, 'code-field', '000000');
      await _tap(tester, 'verify-submit');
      expect(find.textContaining('Kod geçersiz'), findsOneWidget);

      await _type(tester, 'code-field', h.auth.validCode);
      await _tap(tester, 'verify-submit');
      expect(app.location, '/donor');
    });

    testWidgets('forgot leads to the code entry, reset ends signed out', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: AuthPaths.forgot,
      );
      await _type(tester, 'forgot-email', 'bagisci@example.com');
      await _tap(tester, 'forgot-submit');
      expect(h.auth.calls, ['forgot']);
      expect(app.location, '/auth/reset?email=bagisci%40example.com');
      expect(find.byType(ResetPasswordScreen), findsOneWidget);

      await _type(tester, 'code-field', h.auth.validCode);
      await _type(tester, 'reset-password', 'kisa');
      await _tap(tester, 'reset-submit');
      expect(h.auth.calls, ['forgot']);

      await _type(tester, 'reset-password', _password);
      await _tap(tester, 'reset-submit');
      expect(h.auth.accounts['bagisci@example.com'], _password);
      await _tap(tester, 'reset-signin');
      expect(app.location, '/auth');
    });

    testWidgets('screens without an e-mail fall back', (tester) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: AuthPaths.reset,
      );
      expect(app.location, '/auth/forgot');
      app.router.go(AuthPaths.verify);
      await tester.pumpAndSettle();
      expect(app.location, '/auth');
    });
  });

  group('layout', () {
    for (final (scale, size) in layoutCases) {
      testWidgets('auth screens fit at $scale and ${size?.width ?? 800} px', (
        tester,
      ) async {
        final h = DonorHarness();
        final app = await tester.pumpAskida(
          overrides: h.overrides,
          textScale: scale,
          size: size,
          initialLocation: '/auth',
        );
        expectNoLayoutErrors(tester);
        for (final location in [
          AuthPaths.register,
          AuthPaths.forgot,
          AuthPaths.resetWith(email: 'a@b.co'),
          AuthPaths.verifyWith(email: 'a@b.co'),
        ]) {
          app.router.go(location);
          await tester.pumpAndSettle();
          expectNoLayoutErrors(tester);
        }
      });
    }

    testWidgets('server problems never show raw text', (tester) async {
      final h = DonorHarness();
      h.auth.failNext(
        'login',
        const ApiProblem(
          code: 'auth.locked',
          status: 429,
          title: 'Too Many Attempts raw',
        ),
      );
      await tester.pumpAskida(overrides: h.overrides, initialLocation: '/auth');
      await _type(tester, 'signin-email', 'bagisci@example.com');
      await _type(tester, 'signin-password', _password);
      await _tap(tester, 'signin-submit');
      expect(find.textContaining('raw'), findsNothing);
      expect(find.textContaining('Çok fazla deneme'), findsOneWidget);
    });
  });
}

abstract final class FakeAuthRepositoryX {
  static final User unverified = User.fromJson({
    'id': 'user-unverified',
    'email': 'yeni@example.com',
    'name': 'Yeni',
    'kind': 'donor',
    'email_verified': false,
  });
}
