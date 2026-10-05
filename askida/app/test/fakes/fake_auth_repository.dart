import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/auth_session.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/data/session.dart';

import '../helpers/fixtures.dart';
import 'scriptable.dart';

/// In-memory [AuthRepository]. Accounts are kept in [accounts]
/// (email -> password); sign-ins write a run-time token into [tokens] and
/// notify the session sink, like the real implementation.
class FakeAuthRepository with Scriptable implements AuthRepository {
  new({TokenStore? tokens, this._session = const NoopSessionSink(), User? user})
    : tokens = tokens ?? InMemoryTokenStore(),
      currentUser = user;

  final TokenStore tokens;
  final SessionSink _session;

  /// email -> password of accounts that can sign in.
  final Map<String, String> accounts = {};

  /// The signed-in account, if any.
  User? currentUser;

  /// Last `DELETE me` proof received.
  Reauth? lastReauth;

  /// Codes accepted by [verifyEmail] and [reset].
  String validCode = '123456';

  static const _invalid = ApiProblem(
    code: 'auth.invalid_credentials',
    status: 401,
  );
  static const _tokenInvalid = ApiProblem(
    code: 'auth.token_invalid',
    status: 422,
  );

  /// The donor of the `user` fixture.
  static User sampleDonor() => User.fromJson(fixtureData('user'));

  /// The merchant of the `auth_session_merchant` fixture.
  static User sampleMerchant() => User.fromJson(
    fixture('auth_session_merchant')['user'] as Map<String, dynamic>,
  );

  Future<AuthSession> _issue(User user) async {
    final session = AuthSession(
      token: dummyToken(),
      tokenType: 'Bearer',
      expiresAt: DateTime.utc(2026, 11, 3),
      abilities: [user.kind.name],
      user: user,
    );
    await tokens.writeUser(session.token);
    currentUser = user;
    _session.signedIn(user);
    return session;
  }

  @override
  Future<AuthSession> register({
    required String email,
    required String password,
    required String name,
    required UserKind kind,
    required String deviceName,
    required String kvkkTextVersion,
  }) async {
    record('register');
    if (accounts.containsKey(email.toLowerCase())) {
      throw const ApiProblem(
        code: 'validation.failed',
        status: 422,
        fieldErrors: [FieldError(field: 'email', code: 'unique')],
      );
    }
    accounts[email.toLowerCase()] = password;
    return await _issue(
      User(
        id: 'user-${accounts.length}',
        email: email,
        name: name,
        kind: kind,
        emailVerified: false,
      ),
    );
  }

  @override
  Future<AuthSession> login(
    String email,
    String password,
    String deviceName,
  ) async {
    record('login');
    if (accounts[email.toLowerCase()] != password) throw _invalid;
    return await _issue(
      currentUser?.email == email
          ? currentUser!
          : sampleDonor().copyWith(email: email),
    );
  }

  @override
  Future<AuthSession> loginWithApple({
    required String idToken,
    required String nonce,
    required String deviceName,
    String? name,
    UserKind? kind,
    String? kvkkTextVersion,
  }) async {
    record('loginWithApple');
    return await _issue(
      sampleDonor().copyWith(kind: kind ?? UserKind.donor, name: name ?? ''),
    );
  }

  @override
  Future<AuthSession> loginWithGoogle({
    required String idToken,
    required String nonce,
    required String deviceName,
    String? name,
    UserKind? kind,
    String? kvkkTextVersion,
  }) async {
    record('loginWithGoogle');
    return await _issue(
      sampleDonor().copyWith(kind: kind ?? UserKind.donor, name: name ?? ''),
    );
  }

  @override
  Future<void> logout() async {
    try {
      record('logout');
    } finally {
      await tokens.clearUser();
      currentUser = null;
      _session.signedOut();
    }
  }

  @override
  Future<void> verifyEmail(String code, {required String email}) async {
    record('verifyEmail');
    if (code != validCode) throw _tokenInvalid;
    final user = currentUser;
    if (user != null && user.email == email) {
      currentUser = user.copyWith(emailVerified: true);
      _session.userUpdated(currentUser!);
    }
  }

  @override
  Future<void> forgot(String email) async => record('forgot');

  @override
  Future<void> reset(String code, String password, {required String email}) {
    record('reset');
    if (code != validCode) throw _tokenInvalid;
    accounts[email.toLowerCase()] = password;
    return Future.value();
  }

  @override
  Future<User> me() async {
    record('me');
    final user = currentUser;
    if (user == null) {
      throw const ApiProblem(code: 'auth.unauthenticated', status: 401);
    }
    _session.signedIn(user);
    return user;
  }

  @override
  Future<User> updateMe(String name) async {
    record('updateMe');
    final user = (currentUser ?? sampleDonor()).copyWith(name: name);
    currentUser = user;
    _session.userUpdated(user);
    return user;
  }

  @override
  Future<DeletionPending> deleteMe(Reauth reauth) async {
    record('deleteMe');
    lastReauth = reauth;
    await tokens.clearUser();
    currentUser = null;
    _session.signedOut();
    return DeletionPending.fromJson(fixture('deletion_pending'));
  }
}
