import 'package:askida/core/attest/attestation_service.dart';

/// [AttestationService] answering a fixed token, or throwing [failure].
class FakeAttestationService implements AttestationService {
  /// Accepted by the server's simulated verifier (any value not starting
  /// with `reject` or `unavailable`).
  static const sampleToken = 'simulated-attestation';

  String platform = 'android';
  String token = sampleToken;
  Exception? failure;

  /// Nonces received, in order.
  final List<String> nonces = [];

  @override
  Future<AttestationResult> attest(String deviceNonce) async {
    nonces.add(deviceNonce);
    final error = failure;
    if (error != null) throw error;
    return AttestationResult(platform: platform, token: token);
  }
}
