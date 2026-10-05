import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the two bearer tokens live: the account token (donor or merchant)
/// and the anonymous device token (recipient). They are separate keys so
/// signing out of an account never touches the anonymous identity and the
/// other way round. Never in shared preferences, logs or crash output.
abstract interface class TokenStore {
  Future<String?> readUser();
  Future<void> writeUser(String token);
  Future<void> clearUser();

  Future<String?> readAnon();
  Future<void> writeAnon(String token);
  Future<void> clearAnon();

  /// Account deletion, identity reset: both tokens go.
  Future<void> clearAll();
}

/// [TokenStore] on the platform keystore/keychain.
///
/// Android: flutter_secure_storage 11 always encrypts with AES-GCM under a
/// Keystore-wrapped key (the former `encryptedSharedPreferences` switch no
/// longer exists). iOS: first unlock, this device only (no iCloud sync).
class SecureTokenStore implements TokenStore {
  new({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(storageNamespace: 'askida_tokens'),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  static const userKey = 'askida.user_token';
  static const anonKey = 'askida.anon_token';

  final FlutterSecureStorage _storage;

  @override
  Future<String?> readUser() => _storage.read(key: userKey);

  @override
  Future<void> writeUser(String token) =>
      _storage.write(key: userKey, value: token);

  @override
  Future<void> clearUser() => _storage.delete(key: userKey);

  @override
  Future<String?> readAnon() => _storage.read(key: anonKey);

  @override
  Future<void> writeAnon(String token) =>
      _storage.write(key: anonKey, value: token);

  @override
  Future<void> clearAnon() => _storage.delete(key: anonKey);

  @override
  Future<void> clearAll() async {
    await _storage.delete(key: userKey);
    await _storage.delete(key: anonKey);
  }
}

/// In-memory [TokenStore] for tests and widget previews.
class InMemoryTokenStore implements TokenStore {
  new({this._user, this._anon});

  String? _user;
  String? _anon;

  @override
  Future<String?> readUser() async => _user;

  @override
  Future<void> writeUser(String token) async => _user = token;

  @override
  Future<void> clearUser() async => _user = null;

  @override
  Future<String?> readAnon() async => _anon;

  @override
  Future<void> writeAnon(String token) async => _anon = token;

  @override
  Future<void> clearAnon() async => _anon = null;

  @override
  Future<void> clearAll() async {
    _user = null;
    _anon = null;
  }
}
