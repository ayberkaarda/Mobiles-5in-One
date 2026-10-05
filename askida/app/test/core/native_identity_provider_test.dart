import 'package:askida/core/auth/native_identity_provider.dart';
import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:mocktail/mocktail.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

class _MockApple extends Mock implements AppleSignInClient;

class _MockGoogle extends Mock implements GoogleSignInClient;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const rawNonce = 'raw-nonce-for-tests-0123456789';
  late _MockApple apple;
  late _MockGoogle google;

  NativeIdentityProvider provider({String? googleClient = 'client.example'}) =>
      NativeIdentityProvider(
        googleServerClientId: googleClient,
        apple: apple,
        google: google,
        rawNonce: () => rawNonce,
      );

  setUp(() {
    apple = _MockApple();
    google = _MockGoogle();
  });

  group('Apple', () {
    test('sends sha256 of the raw nonce and returns the raw one', () async {
      when(apple.isAvailable).thenAnswer((_) async => true);
      when(() => apple.credential(hashedNonce: any(named: 'hashedNonce')))
          .thenAnswer(
            (_) async => (identityToken: 'apple-identity', givenName: 'Deniz'),
          );

      final credential = await provider().signInWithApple();

      expect(credential.provider, IdentityProviderKind.apple);
      expect(credential.idToken, 'apple-identity');
      expect(credential.rawNonce, rawNonce);
      expect(credential.name, 'Deniz');
      verify(
        () => apple.credential(
          hashedNonce: NativeIdentityProvider.sha256Hex(rawNonce),
        ),
      ).called(1);
    });

    test('sha256 helper', () {
      expect(
        NativeIdentityProvider.sha256Hex('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    test('a closed sheet is IdentityCancelled', () async {
      when(apple.isAvailable).thenAnswer((_) async => true);
      when(() => apple.credential(hashedNonce: any(named: 'hashedNonce')))
          .thenThrow(
            const SignInWithAppleAuthorizationException(
              code: AuthorizationErrorCode.canceled,
              message: 'closed',
            ),
          );
      await expectLater(
        provider().signInWithApple(),
        throwsA(isA<IdentityCancelled>()),
      );
    });

    test(
      'unavailable, failing or empty answers are IdentityUnavailable',
      () async {
        when(apple.isAvailable).thenAnswer((_) async => false);
        await expectLater(
          provider().signInWithApple(),
          throwsA(isA<IdentityUnavailable>()),
        );

        when(apple.isAvailable).thenAnswer((_) async => true);
        when(() => apple.credential(hashedNonce: any(named: 'hashedNonce')))
            .thenAnswer((_) async => (identityToken: null, givenName: null));
        await expectLater(
          provider().signInWithApple(),
          throwsA(isA<IdentityUnavailable>()),
        );
      },
    );

    test(
      'the real SDK on a non-Apple host ends in IdentityUnavailable',
      () async {
        const channel = MethodChannel(
          'com.aboutyou.dart_packages.sign_in_with_apple',
        );
        final messenger =
            TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
        final calls = <String>[];
        messenger.setMockMethodCallHandler(channel, (call) async {
          calls.add(call.method);
          return call.method == 'isAvailable' ? true : null;
        });
        addTearDown(() => messenger.setMockMethodCallHandler(channel, null));

        await expectLater(
          const NativeIdentityProvider().signInWithApple(),
          throwsA(isA<IdentityUnavailable>()),
        );
        expect(calls, contains('isAvailable'));
      },
    );
  });

  group('Google', () {
    test('passes the raw nonce and client id, returns the id token', () async {
      when(
        () => google.authenticate(
          serverClientId: any(named: 'serverClientId'),
          nonce: any(named: 'nonce'),
        ),
      ).thenAnswer((_) async => (idToken: 'google-identity', displayName: 'D'));

      final credential = await provider().signInWithGoogle();

      expect(credential.idToken, 'google-identity');
      expect(credential.rawNonce, rawNonce);
      verify(
        () => google.authenticate(
          serverClientId: 'client.example',
          nonce: rawNonce,
        ),
      ).called(1);
    });

    test(
      'no client id means IdentityUnavailable without calling the SDK',
      () async {
        await expectLater(
          provider(googleClient: null).signInWithGoogle(),
          throwsA(isA<IdentityUnavailable>()),
        );
        verifyNever(
          () => google.authenticate(
            serverClientId: any(named: 'serverClientId'),
            nonce: any(named: 'nonce'),
          ),
        );
      },
    );

    test('cancel and SDK errors are mapped', () async {
      when(
        () => google.authenticate(
          serverClientId: any(named: 'serverClientId'),
          nonce: any(named: 'nonce'),
        ),
      ).thenThrow(
        const GoogleSignInException(code: GoogleSignInExceptionCode.canceled),
      );
      await expectLater(
        provider().signInWithGoogle(),
        throwsA(isA<IdentityCancelled>()),
      );

      when(
        () => google.authenticate(
          serverClientId: any(named: 'serverClientId'),
          nonce: any(named: 'nonce'),
        ),
      ).thenThrow(MissingPluginException('no plugin'));
      await expectLater(
        provider().signInWithGoogle(),
        throwsA(isA<IdentityUnavailable>()),
      );
    });

    test(
      'the real SDK without a platform plugin ends in IdentityUnavailable',
      () async {
        await expectLater(
          const NativeIdentityProvider(googleServerClientId: 'client.example')
              .signInWithGoogle(),
          throwsA(isA<IdentityUnavailable>()),
        );
      },
    );
  });
}
