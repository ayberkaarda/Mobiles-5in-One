import 'package:askida/core/push/push_message.dart';

/// Push transport seam (ADR-0004: the app works without Firebase files).
///
/// [init] asks for permission and obtains a device [token] when a
/// transport is configured; [onMessage] emits the notifications the user
/// opened. The token is registered with `PushRepository.registerToken` only
/// when it is not null.
abstract interface class PushService {
  Future<void> init();

  /// Device push token, or null when there is none (no transport, refused
  /// permission). Never logged.
  String? get token;

  Stream<PushMessage> get onMessage;
}

/// The default in this repository: no Firebase configuration ships, so
/// there is no token and no message. Registration is skipped.
class NoopPushService implements PushService {
  const new();

  @override
  Future<void> init() async {}

  @override
  String? get token => null;

  @override
  Stream<PushMessage> get onMessage => const Stream.empty();
}
