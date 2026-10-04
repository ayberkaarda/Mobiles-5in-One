/// Push token registration for signed-in accounts. Throws `ApiProblem`.
abstract interface class PushRepository {
  /// `PUT me/push-token` (204). [platform] is `android` or `ios`; called
  /// only when the push service produced a token.
  Future<void> registerToken(String platform, String token);
}
