import Flutter

/// iOS side of the `askida/attest` channel.
///
/// DeviceCheck is wired in with the anonymous recipient flow (Phase 4).
/// Until then every token request fails with `unsupported`, so the app can
/// never mistake a missing attestation for a successful one.
final class AttestChannel {
  static let channelName = "askida/attest"
  static let requestTokenMethod = "requestToken"
  static let errorUnsupported = "unsupported"

  private let channel: FlutterMethodChannel

  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: AttestChannel.channelName, binaryMessenger: messenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case AttestChannel.requestTokenMethod:
        result(
          FlutterError(
            code: AttestChannel.errorUnsupported,
            message: "Device attestation is not available in this build.",
            details: nil))
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  deinit {
    channel.setMethodCallHandler(nil)
  }
}
