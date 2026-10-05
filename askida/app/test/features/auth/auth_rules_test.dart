import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/field_errors.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_auth_repository.dart';

void main() {
  group('AuthRules', () {
    test('e-mail and password rules follow the server', () {
      expect(AuthRules.isEmail('bagisci@example.com'), isTrue);
      expect(AuthRules.isEmail(' bagisci@example.com '), isTrue);
      expect(AuthRules.isEmail('bagisci@'), isFalse);
      expect(AuthRules.isEmail('no at sign'), isFalse);
      expect(AuthRules.isPassword('a' * 9), isFalse);
      expect(AuthRules.isPassword('a' * 10), isTrue);
      expect(AuthRules.isPassword('a' * 129), isFalse);
      expect(AuthRules.isCode('123456'), isTrue);
      expect(AuthRules.isCode('12345'), isFalse);
      expect(AuthRules.isCode('12a456'), isFalse);
      expect(
        AuthRules.normaliseEmail(' Bagisci@Example.COM '),
        'bagisci@example.com',
      );
    });

    test('the KVKK version matches the server pattern', () {
      expect(
        RegExp(r'^[A-Za-z0-9._-]{1,32}$').hasMatch(AuthRules.kvkkTextVersion),
        isTrue,
      );
    });
  });

  group('return locations', () {
    test('only in-app paths outside /auth are followed', () {
      expect(safeReturnLocation('/donor/donations'), '/donor/donations');
      expect(
        safeReturnLocation('/donor/donate?shop=a&item=b'),
        '/donor/donate?shop=a&item=b',
      );
      for (final unsafe in [
        null,
        '',
        'donor',
        '//evil.example/x',
        'https://evil.example/',
        'askida://shop/x',
        '/auth',
        '/auth/register',
      ]) {
        expect(safeReturnLocation(unsafe), isNull, reason: '$unsafe');
      }
    });

    test('a sign-in continues to from, else the home of the account', () {
      final donor = FakeAuthRepository.sampleDonor();
      final merchant = FakeAuthRepository.sampleMerchant();
      expect(homeAfterSignIn(donor), '/donor');
      expect(homeAfterSignIn(merchant), '/merchant');
      expect(homeAfterSignIn(donor, from: '/settings'), '/settings');
      expect(homeAfterSignIn(merchant, from: '//x'), '/merchant');
    });

    test('auth paths carry their parameters', () {
      expect(AuthPaths.signIn(), '/auth');
      expect(
        AuthPaths.signIn(from: '/donor/donations'),
        '/auth?from=%2Fdonor%2Fdonations',
      );
      expect(
        AuthPaths.registerWith(kind: UserKind.merchant),
        '/auth/register?kind=merchant',
      );
      expect(
        AuthPaths.verifyWith(email: 'a@b.co', next: '/donor'),
        '/auth/verify?email=a%40b.co&next=%2Fdonor',
      );
      expect(AuthPaths.forgotWith(), '/auth/forgot');
    });
  });

  group('field errors', () {
    final l10n = lookupAppLocalizations(const Locale('tr'));

    test('server codes map to copy, never to raw text', () {
      const problem = ApiProblem(
        code: 'validation.failed',
        status: 422,
        title: 'raw server text',
        fieldErrors: [
          FieldError(field: 'email', code: 'unique'),
          FieldError(field: 'password', code: 'uncompromised'),
          FieldError(field: 'name', code: 'something_new'),
        ],
      );
      expect(fieldErrorText(l10n, problem, 'email'), l10n.authFieldEmailTaken);
      expect(
        fieldErrorText(l10n, problem, 'password'),
        l10n.authFieldPasswordBreached,
      );
      expect(fieldErrorText(l10n, problem, 'name'), l10n.authFieldInvalid);
      expect(fieldErrorText(l10n, problem, 'code'), isNull);
      expect(explainedInline(problem), isTrue);
    });

    test('non-validation problems are not field errors', () {
      const problem = ApiProblem(code: 'rate_limited', status: 429);
      expect(fieldErrorText(l10n, problem, 'email'), isNull);
      expect(explainedInline(problem), isFalse);
      const device = ApiProblem(
        code: 'validation.failed',
        status: 422,
        fieldErrors: [FieldError(field: 'device_name', code: 'required')],
      );
      expect(explainedInline(device), isFalse);
    });
  });
}
