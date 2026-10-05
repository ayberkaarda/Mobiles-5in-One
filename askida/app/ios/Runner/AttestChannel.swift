import DeviceCheck
import Flutter

/// iOS side of the `askida/attest` channel: a DeviceCheck token.
///
/// DeviceCheck tokens carry no caller nonce; the `device_nonce` the Dart side
/// passes travels to the server inside the `POST anon/attest` body, and the
/// server validates the token with Apple (`validate_device_token`) using the
/// key from its own environment. No key ships with the app.
///
/// Failure codes match the Dart side: `unsupported` when DeviceCheck is not
/// available (simulator, old devices), `unavailable` when token generation
/// fails, `unknown` for anything else. The provider's own error text never
/// crosses the channel.
final class AttestChannel {
  static let channelName = "askida/attest"
  static let requestTokenMethod = "requestToken"
  static let errorUnsupported = "unsupported"
  static let errorUnavailable = "unavailable"
  static let errorUnknown = "unknown"

  private let channel: FlutterMethodChannel

  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: AttestChannel.channelName, binaryMessenger: messenger)
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case AttestChannel.requestTokenMethod:
        let arguments = call.arguments as? [String: Any]
        guard let nonce = arguments?["nonce"] as? String, !nonce.isEmpty else {
          result(
            FlutterError(
              code: AttestChannel.errorUnknown,
              message: "A device nonce is required.",
              details: nil))
          return
        }
        AttestChannel.requestToken(result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  private static func requestToken(result: @escaping FlutterResult) {
    let device = DCDevice.current
    guard device.isSupported else {
      result(
        FlutterError(
          code: errorUnsupported,
          message: "DeviceCheck is not available on this device.",
          details: nil))
      return
    }
    device.generateToken { data, error in
      DispatchQueue.main.async {
        if let data = data, error == nil {
          result(data.base64EncodedString())
        } else {
          result(
            FlutterError(
              code: errorUnavailable,
              message: "DeviceCheck could not provide a token.",
              details: nil))
        }
      }
    }
  }

  deinit {
    channel.setMethodCallHandler(nil)
  }
}
