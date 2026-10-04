import 'package:askida/core/attest/attest_channel.dart';
import 'package:askida/core/attest/attestation_service.dart';
import 'package:askida/core/env/flavor.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel(AttestChannel.channelName);
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  ChannelAttestationService service({required bool dev}) =>
      ChannelAttestationService(
        channel: AttestChannel(),
        platform: 'android',
        devFlavor: dev,
      );

  test('passes the device nonce to the platform', () async {
    Object? arguments;
    messenger.setMockMethodCallHandler(channel, (call) async {
      arguments = call.arguments;
      return 'provider-result';
    });

    final result = await service(dev: false).attest('nonce-0123456789abcd');

    expect(result.token, 'provider-result');
    expect(result.platform, 'android');
    expect(arguments, {'nonce': 'nonce-0123456789abcd'});
  });

  test(
    'dev flavor falls back to the fixed dev token when unsupported',
    () async {
      final result = await service(dev: true).attest('nonce-0123456789abcd');
      expect(result.token, ChannelAttestationService.devFallbackToken);
    },
  );

  test('dev flavor falls back when the provider is unavailable', () async {
    messenger.setMockMethodCallHandler(
      channel,
      (call) async => throw PlatformException(code: 'unavailable'),
    );
    final result = await service(dev: true).attest('nonce-0123456789abcd');
    expect(result.token, ChannelAttestationService.devFallbackToken);
  });

  test('prod flavor never sends the dev token', () async {
    await expectLater(
      service(dev: false).attest('nonce-0123456789abcd'),
      throwsA(
        isA<AttestationUnavailable>().having(
          (e) => e.failure,
          'failure',
          AttestFailure.unsupported,
        ),
      ),
    );
  });

  test('an unknown failure is never papered over, even in dev', () async {
    messenger.setMockMethodCallHandler(
      channel,
      (call) async => throw PlatformException(code: 'tampered'),
    );
    await expectLater(
      service(dev: true).attest('nonce-0123456789abcd'),
      throwsA(isA<AttestationUnavailable>()),
    );
  });

  group('flavor resolution', () {
    test('the define wins', () {
      expect(resolveDevFlavor(define: 'dev'), isTrue);
      expect(resolveDevFlavor(define: 'prod', flutterFlavor: 'dev'), isFalse);
    });

    test('without a define the Flutter flavor decides', () {
      expect(resolveDevFlavor(flutterFlavor: 'dev'), isTrue);
      expect(resolveDevFlavor(flutterFlavor: 'prod'), isFalse);
    });

    test('nothing known means prod', () {
      expect(resolveDevFlavor(), isFalse);
      expect(kIsDevFlavor, isFalse, reason: 'tests run without the define');
    });
  });
}
