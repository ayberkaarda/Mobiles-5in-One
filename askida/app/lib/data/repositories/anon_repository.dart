import 'package:askida/data/models/auth_session.dart';

/// The anonymous recipient identity. There is no account and no history
/// on the device beyond the active reservation in memory.
abstract interface class AnonRepository {
  /// Runs the platform attestation with a fresh device nonce, calls
  /// `POST anon/attest` and stores the anon token. Throws
  /// `AttestationUnavailable` (prod flavor, no provider) or `ApiProblem`.
  Future<AnonSession> attest();

  /// `DELETE anon/me` (204): the server forgets the device; the token and the
  /// offline database are wiped locally even when the call fails.
  Future<void> deleteMe();
}
