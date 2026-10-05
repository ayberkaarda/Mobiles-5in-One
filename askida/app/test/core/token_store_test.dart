import 'package:askida/core/storage/secure_token_store.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/fixtures.dart';

void main() {
  Future<void> exercise(TokenStore store) async {
    final user = dummyToken();
    final anon = dummyToken('anon');
    await store.writeUser(user);
    await store.writeAnon(anon);
    expect(await store.readUser(), user);
    expect(await store.readAnon(), anon);

    await store.clearUser();
    expect(await store.readUser(), isNull);
    expect(await store.readAnon(), anon, reason: 'separate keys');

    await store.writeUser(user);
    await store.clearAnon();
    expect(await store.readAnon(), isNull);
    expect(await store.readUser(), user);

    await store.writeAnon(anon);
    await store.clearAll();
    expect(await store.readUser(), isNull);
    expect(await store.readAnon(), isNull);
  }

  test('secure store keeps user and anon tokens under separate keys', () async {
    FlutterSecureStorage.setMockInitialValues({});
    await exercise(SecureTokenStore());
    expect(SecureTokenStore.userKey, isNot(SecureTokenStore.anonKey));
  });

  test('in-memory store behaves the same', () async {
    await exercise(InMemoryTokenStore());
  });
}
