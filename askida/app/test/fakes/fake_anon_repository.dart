import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/models/auth_session.dart';
import 'package:askida/data/repositories/anon_repository.dart';
import 'package:askida/data/session.dart';

import '../helpers/fixtures.dart';
import 'scriptable.dart';

/// In-memory [AnonRepository]: attest stores a run-time anon token.
/// Script `failNext('attest', const AttestationUnavailable(...))` to test
/// the prod-flavor blocking message.
class FakeAnonRepository with Scriptable implements AnonRepository {
  new({TokenStore? tokens, this._session = const NoopSessionSink()})
    : tokens = tokens ?? InMemoryTokenStore();

  final TokenStore tokens;
  final SessionSink _session;

  /// Times the local data was wiped by [deleteMe].
  int erasures = 0;

  @override
  Future<AnonSession> attest() async {
    record('attest');
    final session = AnonSession.fromJson(anonSessionJson());
    await tokens.writeAnon(session.token);
    _session.anonStored();
    return session;
  }

  @override
  Future<void> deleteMe() async {
    try {
      record('deleteMe');
    } finally {
      await tokens.clearAnon();
      erasures++;
      _session.anonCleared();
    }
  }
}
