import 'package:askida/core/attest/attest_channel.dart';

/// What `POST anon/attest` needs from the device.
class AttestationResult {
  const new({required this.platform, required this.token});

  /// `android` or `ios`.
  final String platform;

  /// Opaque provider token (Play Integrity / DeviceCheck), or the dev
  /// fallback value in the dev flavor. Never logged.
  final String token;
}

/// The device cannot attest and the build has no fallback: the recipient
/// screen shows a blocking, calm message (prod flavor).
class AttestationUnavailable implements Exception {
  const new(this.failure);

  final AttestFailure failure;

  @override
  String toString() => 'AttestationUnavailable(${failure.name})';
}

/// Produces an attestation token bound to the `device_nonce`.
abstract interface class AttestationService {
  Future<AttestationResult> attest(String deviceNonce);
}

/// [AttestationService] over the `askida/attest` platform channel.
///
/// When the channel reports `unsupported` or `unavailable` (no provider in
/// this build, Play services missing), ONLY the dev flavor answers with
/// [devFallbackToken], which the server's simulated verifier accepts
/// outside production. The prod flavor throws [AttestationUnavailable].
class ChannelAttestationService implements AttestationService {
  new({
    required this._channel,
    required this.platform,
    required this.devFlavor,
  });

  /// Fixed value the dev flavor sends instead of a provider token.
  static const devFallbackToken = 'dev-flavor-attestation';

  final AttestChannel _channel;
  final String platform;
  final bool devFlavor;

  @override
  Future<AttestationResult> attest(String deviceNonce) async {
    try {
      final token = await _channel.requestToken(nonce: deviceNonce);
      return AttestationResult(platform: platform, token: token);
    } on AttestException catch (error) {
      final fallbackAllowed =
          error.failure == AttestFailure.unsupported ||
          error.failure == AttestFailure.unavailable;
      if (devFlavor && fallbackAllowed) {
        return AttestationResult(platform: platform, token: devFallbackToken);
      }
      throw AttestationUnavailable(error.failure);
    }
  }
}
