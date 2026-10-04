import 'package:askida/core/http/api_client.dart';
import 'package:askida/data/models/auth_session.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/data/repositories/impl/json_body.dart';
import 'package:askida/data/session.dart';

class DioAuthRepository implements AuthRepository {
  new(
    this._api, {
    required this.platform,
    this._session = const NoopSessionSink(),
    LocalDataEraser? eraseLocalData,
  }) : _erase = eraseLocalData;

  final ApiClient _api;

  /// `android` or `ios`, sent with every sign-in.
  final String platform;
  final SessionSink _session;
  final LocalDataEraser? _erase;

  Future<AuthSession> _signIn(String path, Map<String, Object?> body) async {
    final answer = await _api.post(
      path,
      data: {
        for (final e in body.entries)
          if (e.value != null) e.key: e.value,
      },
      auth: AuthScope.none,
    );
    final session = parse(() => AuthSession.fromJson(objectOf(answer)));
    await _api.tokens.writeUser(session.token);
    _session.signedIn(session.user);
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
  }) => _signIn('auth/register', {
    'email': email,
    'password': password,
    'name': name,
    'kind': kind.name,
    'device_name': deviceName,
    'platform': platform,
    'kvkk_text_version': kvkkTextVersion,
  });

  @override
  Future<AuthSession> login(String email, String password, String deviceName) =>
      _signIn('auth/login', {
        'email': email,
        'password': password,
        'device_name': deviceName,
        'platform': platform,
      });

  Map<String, Object?> _identityBody({
    required String idToken,
    required String nonce,
    required String deviceName,
    String? name,
    UserKind? kind,
    String? kvkkTextVersion,
  }) => {
    'id_token': idToken,
    'nonce': nonce,
    'device_name': deviceName,
    'platform': platform,
    'name': name,
    'kind': kind?.name,
    'kvkk_text_version': kvkkTextVersion,
  };

  @override
  Future<AuthSession> loginWithApple({
    required String idToken,
    required String nonce,
    required String deviceName,
    String? name,
    UserKind? kind,
    String? kvkkTextVersion,
  }) => _signIn(
    'auth/apple',
    _identityBody(
      idToken: idToken,
      nonce: nonce,
      deviceName: deviceName,
      name: name,
      kind: kind,
      kvkkTextVersion: kvkkTextVersion,
    ),
  );

  @override
  Future<AuthSession> loginWithGoogle({
    required String idToken,
    required String nonce,
    required String deviceName,
    String? name,
    UserKind? kind,
    String? kvkkTextVersion,
  }) => _signIn(
    'auth/google',
    _identityBody(
      idToken: idToken,
      nonce: nonce,
      deviceName: deviceName,
      name: name,
      kind: kind,
      kvkkTextVersion: kvkkTextVersion,
    ),
  );

  @override
  Future<void> logout() async {
    try {
      await _api.post('auth/logout');
    } finally {
      await _api.tokens.clearUser();
      _session.signedOut();
    }
  }

  @override
  Future<void> verifyEmail(String code, {required String email}) async {
    await _api.post(
      'auth/verify-email',
      data: {'email': email, 'code': code},
      auth: AuthScope.none,
    );
  }

  @override
  Future<void> forgot(String email) async {
    await _api.post(
      'auth/forgot',
      data: {'email': email},
      auth: AuthScope.none,
    );
  }

  @override
  Future<void> reset(
    String code,
    String password, {
    required String email,
  }) async {
    await _api.post(
      'auth/reset',
      data: {'email': email, 'code': code, 'password': password},
      auth: AuthScope.none,
    );
  }

  @override
  Future<User> me() async {
    final answer = await _api.get('me');
    final user = parse(() => User.fromJson(objectOf(answer)));
    _session.signedIn(user);
    return user;
  }

  @override
  Future<User> updateMe(String name) async {
    final answer = await _api.patch('me', data: {'name': name});
    final user = parse(() => User.fromJson(objectOf(answer)));
    _session.userUpdated(user);
    return user;
  }

  @override
  Future<DeletionPending> deleteMe(Reauth reauth) async {
    final answer = await _api.delete('me', data: reauth.toJson());
    final pending = parse(() => DeletionPending.fromJson(objectOf(answer)));
    await _api.tokens.clearUser();
    await _erase?.call();
    _session.signedOut();
    return pending;
  }
}
