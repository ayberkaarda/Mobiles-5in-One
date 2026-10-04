import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Turns the display to full brightness (and keeps it awake) while the code
/// is shown to the shop, so the scanner reads it on a dim phone.
abstract interface class ScreenBrightness {
  Future<void> setFull({required bool enabled});
}

/// [ScreenBrightness] over the `askida/screen` channel (Android:
/// `ScreenChannel.kt`). A platform without the handler keeps its brightness;
/// the full-brightness view is still white with the largest code.
class ChannelScreenBrightness implements ScreenBrightness {
  new({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel(channelName);

  static const channelName = 'askida/screen';
  static const setFullMethod = 'setFullBrightness';

  final MethodChannel _channel;

  @override
  Future<void> setFull({required bool enabled}) async {
    try {
      await _channel.invokeMethod<void>(setFullMethod, {'enabled': enabled});
    } on MissingPluginException {
      // No handler on this platform: nothing to change.
    } on PlatformException {
      // The window refused the change; the view still works.
    }
  }
}

final screenBrightnessProvider = Provider<ScreenBrightness>(
  (ref) => ChannelScreenBrightness(),
);
