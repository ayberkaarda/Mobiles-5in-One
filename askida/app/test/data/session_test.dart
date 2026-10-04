import 'package:askida/core/env/app_env.dart';
import 'package:askida/core/http/api_client.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http_mock_adapter/http_mock_adapter.dart';

import '../fakes/fake_auth_repository.dart';
import '../helpers/fixtures.dart';
import '../helpers/test_database.dart';

void main() {
  test('session flags follow sign-in, sign-out and anon changes', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final controller = container.read(sessionProvider.notifier);

    expect(container.read(sessionProvider).isSignedIn, isFalse);
    controller.signedIn(FakeAuthRepository.sampleMerchant());
    expect(container.read(sessionProvider).isMerchant, isTrue);
    expect(container.read(sessionProvider).isDonor, isFalse);
    controller
      ..anonStored()
      ..signedOut();
    final state = container.read(sessionProvider);
    expect(state.isSignedIn, isFalse);
    expect(state.user, isNull);
    expect(state.hasAnonToken, isTrue);
  });

  test('restore loads the user when a token exists', () async {
    final tokens = InMemoryTokenStore(user: dummyToken());
    final auth = FakeAuthRepository(
      tokens: tokens,
      user: FakeAuthRepository.sampleDonor(),
    );
    final container = ProviderContainer(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
      ],
    );
    addTearDown(container.dispose);

    await container.read(sessionRestoreProvider.future);

    final state = container.read(sessionProvider);
    expect(state.restored, isTrue);
    expect(state.isDonor, isTrue);
    expect(state.hasAnonToken, isFalse);
  });

  test('restore offline keeps the token, user unknown', () async {
    final tokens = InMemoryTokenStore(user: dummyToken(), anon: dummyToken());
    final auth = FakeAuthRepository(tokens: tokens)
      ..failAlways(
        'me',
        const ApiProblem(code: ApiProblem.networkOffline, status: 0),
      );
    final container = ProviderContainer(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        authRepositoryProvider.overrideWithValue(auth),
      ],
    );
    addTearDown(container.dispose);

    await container.read(sessionRestoreProvider.future);

    final state = container.read(sessionProvider);
    expect(state.hasUserToken, isTrue);
    expect(state.user, isNull);
    expect(state.isSignedIn, isFalse);
    expect(state.hasAnonToken, isTrue);
  });

  test('a 401 through the real client signs the session out', () async {
    final tokens = InMemoryTokenStore(user: dummyToken());
    final container = ProviderContainer(
      overrides: [
        appEnvProvider.overrideWithValue(
          AppEnv.parse('http://10.0.2.2:58080/api/v1'),
        ),
        tokenStoreProvider.overrideWithValue(tokens),
        appDatabaseProvider.overrideWithValue(testDatabase()),
      ],
    );
    addTearDown(container.dispose);
    container
        .read(sessionProvider.notifier)
        .signedIn(FakeAuthRepository.sampleDonor());
    final client = container.read(apiClientProvider);
    DioAdapter(dio: client.dio).onGet(
      'me',
      (s) => s.reply(
        401,
        '{"type":"https://askida.app/problems/auth.unauthenticated",'
        '"title":"x","status":401,"code":"auth.unauthenticated",'
        '"request_id":"req-401-session"}',
        headers: {
          'content-type': ['application/problem+json'],
        },
      ),
    );

    final repo = container.read(authRepositoryProvider);
    await expectLater(repo.me(), throwsA(anything));

    expect(container.read(sessionProvider).isSignedIn, isFalse);
    expect(await tokens.readUser(), isNull);
    expect(client.dio.options.baseUrl, 'http://10.0.2.2:58080/api/v1/');
    expect(AuthScope.values, hasLength(4));
  });
}
