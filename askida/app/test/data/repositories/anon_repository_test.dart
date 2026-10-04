import 'package:askida/core/attest/attest_channel.dart';
import 'package:askida/core/attest/attestation_service.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/repositories/impl/dio_anon_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http_mock_adapter/http_mock_adapter.dart';

import '../../fakes/fake_attestation_service.dart';
import '../../helpers/fake_api.dart';
import '../../helpers/fixtures.dart';

void main() {
  const nonce = 'device-nonce-0123456789abcdef';

  test(
    'attest posts platform, token and nonce, then stores the anon token',
    () async {
      final api = FakeApi(userToken: dummyToken());
      final attestation = FakeAttestationService();
      final anonToken = dummyToken('anon');
      api.adapter.onPost(
        'anon/attest',
        (s) => s.reply(200, anonSessionJson(token: anonToken)),
        data: {
          'platform': 'android',
          'token': FakeAttestationService.sampleToken,
          'device_nonce': nonce,
        },
      );
      final repo = DioAnonRepository(
        api.client,
        attestation: attestation,
        nonce: () => nonce,
      );

      final session = await repo.attest();

      expect(session.abilities, ['anon']);
      expect(await api.tokens.readAnon(), anonToken);
      expect(attestation.nonces, [nonce]);
      expect(api.last.headers.containsKey('Authorization'), isFalse);
    },
  );

  test('prod flavor without a provider never calls the server', () async {
    final api = FakeApi();
    final attestation = FakeAttestationService()
      ..failure = const AttestationUnavailable(AttestFailure.unsupported);
    final repo = DioAnonRepository(api.client, attestation: attestation);

    await expectLater(repo.attest(), throwsA(isA<AttestationUnavailable>()));
    expect(api.sent, isEmpty);
    expect(await api.tokens.readAnon(), isNull);
  });

  test('a refused attestation surfaces auth.token_invalid', () async {
    final api = FakeApi();
    api.adapter.onPost(
      'anon/attest',
      (s) => s.reply(
        401,
        '{"type":"https://askida.app/problems/auth.token_invalid",'
        '"title":"x","status":401,"code":"auth.token_invalid",'
        '"request_id":"req-attest-1"}',
        headers: FakeApi.problemHeaders(),
      ),
      data: Matchers.any,
    );
    final repo = DioAnonRepository(
      api.client,
      attestation: FakeAttestationService(),
    );
    await expectLater(
      repo.attest(),
      throwsA(
        isA<ApiProblem>().having((p) => p.code, 'code', 'auth.token_invalid'),
      ),
    );
    expect(api.unauthenticated, isEmpty);
  });

  test('deleteMe uses the anon token and wipes local data', () async {
    final anonToken = dummyToken('anon');
    final userToken = dummyToken();
    final api = FakeApi(userToken: userToken, anonToken: anonToken);
    var erased = 0;
    api.adapter.onDelete(
      'anon/me',
      (s) => s.reply(204, null),
      data: Matchers.any,
    );
    final repo = DioAnonRepository(
      api.client,
      attestation: FakeAttestationService(),
      eraseLocalData: () async => erased++,
    );

    await repo.deleteMe();

    expect(api.last.headers['Authorization'], 'Bearer $anonToken');
    expect(await api.tokens.readAnon(), isNull);
    expect(await api.tokens.readUser(), userToken);
    expect(erased, 1);
  });

  test('device nonces match the server pattern and differ', () {
    final a = randomDeviceNonce();
    final b = randomDeviceNonce();
    expect(a, matches(RegExp(r'^[A-Za-z0-9_-]{16,128}$')));
    expect(a, isNot(b));
  });
}
