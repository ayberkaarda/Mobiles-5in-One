import 'dart:convert';
import 'dart:math';

import 'package:askida/core/attest/attestation_service.dart';
import 'package:askida/core/http/api_client.dart';
import 'package:askida/data/models/auth_session.dart';
import 'package:askida/data/repositories/anon_repository.dart';
import 'package:askida/data/repositories/impl/json_body.dart';
import 'package:askida/data/session.dart';

/// Builds the `device_nonce` (URL-safe, 16..128 chars).
typedef NonceSource = String Function();

final Random _random = Random.secure();

/// 32 random bytes, base64url without padding (43 characters).
String randomDeviceNonce() => base64Url
    .encode(List<int>.generate(32, (_) => _random.nextInt(256)))
    .replaceAll('=', '');

class DioAnonRepository implements AnonRepository {
  new(
    this._api, {
    required this._attestation,
    this._session = const NoopSessionSink(),
    LocalDataEraser? eraseLocalData,
    this._nonce = randomDeviceNonce,
  }) : _erase = eraseLocalData;

  final ApiClient _api;
  final AttestationService _attestation;
  final SessionSink _session;
  final LocalDataEraser? _erase;
  final NonceSource _nonce;

  @override
  Future<AnonSession> attest() async {
    final deviceNonce = _nonce();
    final result = await _attestation.attest(deviceNonce);
    final answer = await _api.post(
      'anon/attest',
      data: {
        'platform': result.platform,
        'token': result.token,
        'device_nonce': deviceNonce,
      },
      auth: AuthScope.none,
    );
    final session = parse(() => AnonSession.fromJson(objectOf(answer)));
    await _api.tokens.writeAnon(session.token);
    _session.anonStored();
    return session;
  }

  @override
  Future<void> deleteMe() async {
    try {
      await _api.delete('anon/me', auth: AuthScope.anon);
    } finally {
      await _api.tokens.clearAnon();
      await _erase?.call();
      _session.anonCleared();
    }
  }
}
