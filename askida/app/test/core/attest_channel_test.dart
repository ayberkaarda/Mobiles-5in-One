import 'package:askida/core/attest/attest_channel.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel(AttestChannel.channelName);
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  void answerWith(Future<Object?> Function(MethodCall call) handler) =>
      messenger.setMockMethodCallHandler(channel, handler);

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('returns the token when the platform succeeds', () async {
    final calls = <String>[];
    answerWith((call) async {
      calls.add(call.method);
      return 'attestation-result';
    });

    expect(await AttestChannel().requestToken(), 'attestation-result');
    expect(calls, [AttestChannel.requestTokenMethod]);
  });

  test('maps the unsupported platform error', () async {
    answerWith(
      (call) async => throw PlatformException(
        code: 'unsupported',
        message: 'Device attestation is not available in this build.',
      ),
    );

    await expectLater(
      AttestChannel().requestToken(),
      throwsA(
        isA<AttestException>()
            .having((e) => e.failure, 'failure', AttestFailure.unsupported)
            .having((e) => e.message, 'message', contains('not available')),
      ),
    );
  });

  test('maps an unknown platform error code to unknown', () async {
    answerWith((call) async => throw PlatformException(code: 'something-else'));

    await expectLater(
      AttestChannel().requestToken(),
      throwsA(
        isA<AttestException>().having(
          (e) => e.failure,
          'failure',
          AttestFailure.unknown,
        ),
      ),
    );
  });

  test('treats an empty token as a failure, never as success', () async {
    answerWith((call) async => '');

    await expectLater(
      AttestChannel().requestToken(),
      throwsA(
        isA<AttestException>().having(
          (e) => e.failure,
          'failure',
          AttestFailure.unknown,
        ),
      ),
    );
  });

  test('reports unsupported when no native handler is registered', () async {
    await expectLater(
      AttestChannel().requestToken(),
      throwsA(
        isA<AttestException>().having(
          (e) => e.failure,
          'failure',
          AttestFailure.unsupported,
        ),
      ),
    );
  });
}
