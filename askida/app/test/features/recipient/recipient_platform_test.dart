import 'package:askida/features/recipient/data/screen_brightness.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel(ChannelScreenBrightness.channelName);
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('asks the platform for full brightness and back', () async {
    final calls = <MethodCall>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return null;
    });

    final brightness = ChannelScreenBrightness();
    await brightness.setFull(enabled: true);
    await brightness.setFull(enabled: false);

    expect(calls.map((c) => c.method), [
      'setFullBrightness',
      'setFullBrightness',
    ]);
    expect(calls.map((c) => c.arguments), [
      {'enabled': true},
      {'enabled': false},
    ]);
  });

  test('a platform without the handler is not an error', () async {
    await expectLater(
      ChannelScreenBrightness().setFull(enabled: true),
      completes,
    );
  });

  test('a refused change is not an error', () async {
    messenger.setMockMethodCallHandler(
      channel,
      (call) async => throw PlatformException(code: 'denied'),
    );
    await expectLater(
      ChannelScreenBrightness().setFull(enabled: true),
      completes,
    );
  });
}
