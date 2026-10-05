import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/data/repositories/impl/dio_auth_repository.dart';
import 'package:askida/data/session.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http_mock_adapter/http_mock_adapter.dart';

import '../../helpers/fake_api.dart';
import '../../helpers/fixtures.dart';

class _RecordingSink implements SessionSink {
  final events = <String>[];
  User? user;

  @override
  void signedIn(User user) {
    events.add('signedIn');
    this.user = user;
  }

  @override
  void userUpdated(User user) {
    events.add('userUpdated');
    this.user = user;
  }

  @override
  void signedOut() => events.add('signedOut');
  @override
  void anonStored() => events.add('anonStored');
  @override
  void anonCleared() => events.add('anonCleared');
}

void main() {
  late FakeApi api;
  late _RecordingSink sink;
  late DioAuthRepository repo;
  var erased = 0;

  setUp(() {
    api = FakeApi();
    sink = _RecordingSink();
    erased = 0;
    repo = DioAuthRepository(
      api.client,
      platform: 'android',
      session: sink,
      eraseLocalData: () async => erased++,
    );
  });

  test('register sends the server fields and stores the token', () async {
    final token = dummyToken();
    api.adapter.onPost(
      'auth/register',
      (s) => s.reply(201, authSessionJson(token: token)),
      data: {
        'email': 'bagisci@example.com',
        'password': 'uzun-bir-sifre',
        'name': 'Deniz Yılmaz',
        'kind': 'donor',
        'device_name': 'Pixel 8',
        'platform': 'android',
        'kvkk_text_version': '2026-10',
      },
    );

    final session = await repo.register(
      email: 'bagisci@example.com',
      password: 'uzun-bir-sifre',
      name: 'Deniz Yılmaz',
      kind: UserKind.donor,
      deviceName: 'Pixel 8',
      kvkkTextVersion: '2026-10',
    );

    expect(session.user.kind, UserKind.donor);
    expect(await api.tokens.readUser(), token);
    expect(api.last.headers.containsKey('Authorization'), isFalse);
    expect(sink.events, ['signedIn']);
  });

  test('login answers the token body and stores it', () async {
    final token = dummyToken();
    api.adapter.onPost(
      'auth/login',
      (s) => s.reply(
        200,
        authSessionJson(fixtureName: 'auth_session_merchant', token: token),
      ),
      data: {
        'email': 'esnaf@example.com',
        'password': 'uzun-bir-sifre',
        'device_name': 'Pixel 8',
        'platform': 'android',
      },
    );

    final session = await repo.login(
      'esnaf@example.com',
      'uzun-bir-sifre',
      'Pixel 8',
    );

    expect(session.abilities, ['merchant']);
    expect(await api.tokens.readUser(), token);
    expect(sink.user?.kind, UserKind.merchant);
  });

  test('a failed login leaves no token and maps the problem', () async {
    api.adapter.onPost(
      'auth/login',
      (s) => s.reply(
        429,
        '{"type":"https://askida.app/problems/auth.locked","title":"x",'
        '"status":429,"code":"auth.locked","request_id":"req-locked-1"}',
        headers: FakeApi.problemHeaders(retryAfter: 900),
      ),
      data: Matchers.any,
    );

    await expectLater(
      repo.login('esnaf@example.com', 'yanlis', 'Pixel 8'),
      throwsA(
        isA<ApiProblem>()
            .having((p) => p.code, 'code', 'auth.locked')
            .having((p) => p.retryAfter, 'retryAfter', 900),
      ),
    );
    expect(await api.tokens.readUser(), isNull);
    expect(sink.events, isEmpty);
  });

  test('Apple sign-in omits unset creation fields', () async {
    api.adapter.onPost(
      'auth/apple',
      (s) => s.reply(200, authSessionJson()),
      data: {
        'id_token': 'apple-identity-value',
        'nonce': 'nonce-value-0123456789',
        'device_name': 'iPhone',
        'platform': 'android',
      },
    );
    await repo.loginWithApple(
      idToken: 'apple-identity-value',
      nonce: 'nonce-value-0123456789',
      deviceName: 'iPhone',
    );
    expect(api.last.data, isNot(contains('kind')));
  });

  test('Google sign-in sends creation fields for a new account', () async {
    api.adapter.onPost(
      'auth/google',
      (s) => s.reply(201, authSessionJson()),
      data: {
        'id_token': 'google-identity-value',
        'nonce': 'nonce-value-0123456789',
        'device_name': 'Pixel 8',
        'platform': 'android',
        'name': 'Deniz',
        'kind': 'donor',
        'kvkk_text_version': '2026-10',
      },
    );
    await repo.loginWithGoogle(
      idToken: 'google-identity-value',
      nonce: 'nonce-value-0123456789',
      deviceName: 'Pixel 8',
      name: 'Deniz',
      kind: UserKind.donor,
      kvkkTextVersion: '2026-10',
    );
    expect(sink.events, ['signedIn']);
  });

  test('logout clears the token even when the call fails', () async {
    await api.tokens.writeUser(dummyToken());
    api.replyProblem('POST', 'auth/logout', 'problem_unauthenticated');

    await expectLater(repo.logout(), throwsA(isA<ApiProblem>()));

    expect(await api.tokens.readUser(), isNull);
    expect(sink.events, contains('signedOut'));
  });

  test('verify, forgot and reset send email and code', () async {
    api.adapter
      ..onPost(
        'auth/verify-email',
        (s) => s.reply(200, {'email_verified': true}),
        data: {'email': 'a@example.com', 'code': '123456'},
      )
      ..onPost(
        'auth/forgot',
        (s) => s.reply(202, {'status': 'accepted'}),
        data: {'email': 'a@example.com'},
      )
      ..onPost(
        'auth/reset',
        (s) => s.reply(204, null),
        data: {
          'email': 'a@example.com',
          'code': '654321',
          'password': 'yeni-uzun-sifre',
        },
      );

    await repo.verifyEmail('123456', email: 'a@example.com');
    await repo.forgot('a@example.com');
    await repo.reset('654321', 'yeni-uzun-sifre', email: 'a@example.com');

    expect(api.sent.map((r) => r.path), [
      'auth/verify-email',
      'auth/forgot',
      'auth/reset',
    ]);
    expect(
      api.sent.every((r) => !r.headers.containsKey('Authorization')),
      isTrue,
    );
  });

  test('me and updateMe read the data wrapper', () async {
    await api.tokens.writeUser(dummyToken());
    api.adapter
      ..onGet('me', (s) => s.reply(200, fixture('user')))
      ..onPatch(
        'me',
        (s) => s.reply(200, {
          'data': {...fixtureData('user'), 'name': 'Deniz Y.'},
        }),
        data: {'name': 'Deniz Y.'},
      );

    expect((await repo.me()).email, 'bagisci@example.com');
    expect((await repo.updateMe('Deniz Y.')).name, 'Deniz Y.');
    expect(sink.events, ['signedIn', 'userUpdated']);
  });

  test('deleteMe sends the proof, clears the token and local data', () async {
    await api.tokens.writeUser(dummyToken());
    api.adapter.onDelete(
      'me',
      (s) => s.reply(202, fixture('deletion_pending')),
      data: {'password': 'uzun-bir-sifre'},
    );

    final pending = await repo.deleteMe(const PasswordReauth('uzun-bir-sifre'));

    expect(pending.status, 'pending');
    expect(await api.tokens.readUser(), isNull);
    expect(erased, 1);
    expect(sink.events, ['signedOut']);
  });

  test('provider re-auth body', () {
    expect(
      const ProviderReauth(
        provider: IdentityProviderKind.google,
        idToken: 'identity-value',
        nonce: 'nonce-value-0123456789',
      ).toJson(),
      {
        'provider': 'google',
        'id_token': 'identity-value',
        'nonce': 'nonce-value-0123456789',
      },
    );
  });

  test('a merchant with open hooks cannot delete; nothing is wiped', () async {
    await api.tokens.writeUser(dummyToken());
    api.adapter.onDelete(
      'me',
      (s) => s.reply(
        409,
        '{"type":"https://askida.app/problems/shop.has_open_hooks",'
        '"title":"x","status":409,"code":"shop.has_open_hooks",'
        '"request_id":"req-open-1"}',
        headers: FakeApi.problemHeaders(),
      ),
      data: Matchers.any,
    );

    await expectLater(
      repo.deleteMe(const PasswordReauth('uzun-bir-sifre')),
      throwsA(
        isA<ApiProblem>().having((p) => p.code, 'code', 'shop.has_open_hooks'),
      ),
    );
    expect(await api.tokens.readUser(), isNotNull);
    expect(erased, 0);
  });

  test('a malformed answer becomes client.bad_response', () async {
    api.adapter.onGet('me', (s) => s.reply(200, {'data': 'nope'}));
    await api.tokens.writeUser(dummyToken());
    await expectLater(
      repo.me(),
      throwsA(
        isA<ApiProblem>().having((p) => p.code, 'code', ApiProblem.badResponse),
      ),
    );
  });
}
