import 'package:askida/data/models/auth_session.dart';
import 'package:askida/data/models/user.dart';

/// Identity providers accepted by `auth/apple`, `auth/google` and the
/// re-authentication of `DELETE me`.
enum IdentityProviderKind { apple, google }

/// Proof of identity for `DELETE me`.
sealed class Reauth {
  const new();

  Map<String, Object> toJson();
}

/// Password accounts send their password.
final class PasswordReauth extends Reauth {
  const new(this.password);

  final String password;

  @override
  Map<String, Object> toJson() => {'password': password};
}

/// Apple/Google accounts send a fresh identity token and its raw nonce.
final class ProviderReauth extends Reauth {
  const new({
    required this.provider,
    required this.idToken,
    required this.nonce,
  });

  final IdentityProviderKind provider;
  final String idToken;
  final String nonce;

  @override
  Map<String, Object> toJson() => {
    'provider': provider.name,
    'id_token': idToken,
    'nonce': nonce,
  };
}

/// Donor and merchant accounts. Every method throws `ApiProblem`.
///
/// Successful sign-ins store the user token in the secure store and update
/// the session; [logout] and [deleteMe] wipe the token (and, for deletion,
/// the offline database).
abstract interface class AuthRepository {
  /// `POST auth/register` (201). [kind] is donor or merchant.
  Future<AuthSession> register({
    required String email,
    required String password,
    required String name,
    required UserKind kind,
    required String deviceName,
    required String kvkkTextVersion,
  });

  /// `POST auth/login`.
  Future<AuthSession> login(String email, String password, String deviceName);

  /// `POST auth/apple`. [name], [kind] and [kvkkTextVersion] are required by
  /// the server only when the account is created.
  Future<AuthSession> loginWithApple({
    required String idToken,
    required String nonce,
    required String deviceName,
    String? name,
    UserKind? kind,
    String? kvkkTextVersion,
  });

  /// `POST auth/google`; same rules as [loginWithApple].
  Future<AuthSession> loginWithGoogle({
    required String idToken,
    required String nonce,
    required String deviceName,
    String? name,
    UserKind? kind,
    String? kvkkTextVersion,
  });

  /// `POST auth/logout` (204). The local token is cleared even when the
  /// call fails.
  Future<void> logout();

  /// `POST auth/verify-email` with the 6-digit [code] mailed to [email].
  Future<void> verifyEmail(String code, {required String email});

  /// `POST auth/forgot` (202, always accepted).
  Future<void> forgot(String email);

  /// `POST auth/reset` (204). Every token of the user is revoked server side.
  Future<void> reset(String code, String password, {required String email});

  /// `GET me`.
  Future<User> me();

  /// `PATCH me` (only the name may change).
  Future<User> updateMe(String name);

  /// `DELETE me` (202): deactivates now, erases after the grace period.
  Future<DeletionPending> deleteMe(Reauth reauth);
}
