import 'dart:convert';
import 'dart:typed_data';

import 'package:askida/core/http/api_client.dart';
import 'package:askida/core/http/request_id.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http_mock_adapter/http_mock_adapter.dart';

import '../helpers/fake_api.dart';
import '../helpers/fixtures.dart';

void main() {
  group('request headers', () {
    test('user routes carry the user token and the standard headers', () async {
      final userToken = dummyToken();
      final api = FakeApi(userToken: userToken, anonToken: dummyToken('anon'));
      api.adapter.onGet('me', (s) => s.reply(200, fixture('user')));

      await api.client.get('me');

      final headers = api.last.headers;
      expect(headers['Authorization'], 'Bearer $userToken');
      expect(headers['Accept'], 'application/json');
      expect(headers['Accept-Language'], 'tr');
      expect(headers['X-Request-Id'], 'req-1-test');
      expect(api.last.uri.toString(), '${FakeApi.baseUrl}/me');
    });

    test('anon routes carry only the anon token', () async {
      final anonToken = dummyToken('anon');
      final api = FakeApi(userToken: dummyToken(), anonToken: anonToken);
      api.adapter.onDelete(
        'anon/me',
        (s) => s.reply(204, null),
        data: Matchers.any,
      );

      await api.client.delete('anon/me', auth: AuthScope.anon);

      expect(api.last.headers['Authorization'], 'Bearer $anonToken');
    });

    test('public routes never send a token', () async {
      final api = FakeApi(userToken: dummyToken(), anonToken: dummyToken());
      api.adapter.onGet(
        'impact',
        (s) => s.reply(200, fixture('impact')),
        queryParameters: {'il': 'İstanbul'},
      );

      await api.client.get(
        'impact',
        query: {'il': 'İstanbul', 'ilce': null},
        auth: AuthScope.none,
      );

      expect(api.last.headers.containsKey('Authorization'), isFalse);
      expect(api.last.queryParameters, {'il': 'İstanbul'});
    });

    test('no token stored means no Authorization header', () async {
      final api = FakeApi();
      api.adapter.onGet('me', (s) => s.reply(200, fixture('user')));
      await api.client.get('me');
      expect(api.last.headers.containsKey('Authorization'), isFalse);
    });

    test('Accept-Language follows the app language', () async {
      final api = FakeApi(languageTag: 'en');
      api.adapter.onGet('me', (s) => s.reply(200, fixture('user')));
      await api.client.get('me');
      expect(api.last.headers['Accept-Language'], 'en');
    });

    test('random request ids are UUIDs the server accepts', () {
      final ids = {for (var i = 0; i < 50; i++) randomRequestId()};
      expect(ids, hasLength(50));
      for (final id in ids) {
        expect(
          id,
          matches(
            RegExp(
              '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-'
              r'[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            ),
          ),
        );
      }
    });
  });

  group('problem parsing', () {
    test('problem+json becomes an ApiProblem with field errors', () async {
      final api = FakeApi()
        ..replyProblem('POST', 'auth/login', 'problem_validation');

      await expectLater(
        api.client.post(
          'auth/login',
          data: {'email': 'x'},
          auth: AuthScope.none,
        ),
        throwsA(
          isA<ApiProblem>()
              .having((p) => p.code, 'code', 'validation.failed')
              .having((p) => p.status, 'status', 422)
              .having((p) => p.requestId, 'requestId', isNotNull)
              .having((p) => p.codesFor('email'), 'email', ['email']),
        ),
      );
    });

    test('Retry-After is kept on rate limits', () async {
      final api = FakeApi(anonToken: dummyToken('anon'))
        ..replyProblem(
          'POST',
          'hooks/reserve',
          'problem_rate_limited',
          retryAfter: 42,
        );

      await expectLater(
        api.client.post('hooks/reserve', data: {}, auth: AuthScope.anon),
        throwsA(
          isA<ApiProblem>()
              .having((p) => p.code, 'code', 'rate_limited')
              .having((p) => p.retryAfter, 'retryAfter', 42),
        ),
      );
    });

    test('a body without a code maps by status, never raw text', () async {
      final api = FakeApi();
      api.adapter.onGet(
        'me',
        (s) => s.reply(
          502,
          '<html>Bad gateway</html>',
          headers: {
            Headers.contentTypeHeader: ['text/html'],
          },
        ),
      );

      await expectLater(
        api.client.get('me'),
        throwsA(
          isA<ApiProblem>()
              .having((p) => p.code, 'code', 'server_error')
              .having((p) => p.title, 'title', isNull),
        ),
      );
    });

    test('transport failures map to network codes', () {
      final options = RequestOptions(path: 'me');
      ApiProblem map(DioExceptionType type, [Object? error]) =>
          problemFromDioException(
            DioException(requestOptions: options, type: type, error: error),
          );
      expect(
        map(DioExceptionType.connectionTimeout).code,
        ApiProblem.networkTimeout,
      );
      expect(
        map(DioExceptionType.receiveTimeout).code,
        ApiProblem.networkTimeout,
      );
      expect(
        map(DioExceptionType.connectionError).code,
        ApiProblem.networkOffline,
      );
      expect(map(DioExceptionType.cancel).code, ApiProblem.cancelled);
      expect(map(DioExceptionType.unknown).code, ApiProblem.badResponse);
    });

    test('timeouts are configured', () {
      final client = ApiClient(
        baseUrl: Uri.parse(FakeApi.baseUrl),
        tokens: InMemoryTokenStore(),
      );
      expect(client.dio.options.connectTimeout, ApiClient.connectTimeout);
      expect(client.dio.options.receiveTimeout, ApiClient.transferTimeout);
      expect(client.dio.options.sendTimeout, ApiClient.transferTimeout);
      expect(client.dio.options.baseUrl, '${FakeApi.baseUrl}/');
    });

    test('no logging interceptor is installed', () {
      final client = ApiClient(
        baseUrl: Uri.parse(FakeApi.baseUrl),
        tokens: InMemoryTokenStore(),
      );
      expect(client.dio.interceptors.whereType<LogInterceptor>(), isEmpty);
      expect(
        client.uploadDio.interceptors.whereType<LogInterceptor>(),
        isEmpty,
      );
    });
  });

  group('401 handling', () {
    test(
      'auth.unauthenticated on a user route clears the user token',
      () async {
        final anonToken = dummyToken('anon');
        final api = FakeApi(userToken: dummyToken(), anonToken: anonToken)
          ..replyProblem('GET', 'me', 'problem_unauthenticated');

        await expectLater(api.client.get('me'), throwsA(isA<ApiProblem>()));

        expect(await api.tokens.readUser(), isNull);
        expect(await api.tokens.readAnon(), anonToken);
        expect(api.unauthenticated, [AuthScope.user]);
      },
    );

    test(
      'auth.unauthenticated on an anon route clears the anon token',
      () async {
        final userToken = dummyToken();
        final api = FakeApi(userToken: userToken, anonToken: dummyToken('anon'))
          ..replyProblem('POST', 'hooks/reserve', 'problem_unauthenticated');

        await expectLater(
          api.client.post('hooks/reserve', data: {}, auth: AuthScope.anon),
          throwsA(isA<ApiProblem>()),
        );

        expect(await api.tokens.readAnon(), isNull);
        expect(await api.tokens.readUser(), userToken);
        expect(api.unauthenticated, [AuthScope.anon]);
      },
    );

    test('wrong credentials on a public route keep everything', () async {
      final userToken = dummyToken();
      final api = FakeApi(userToken: userToken);
      api.adapter.onPost(
        'auth/login',
        (s) => s.reply(
          401,
          jsonEncode({
            'type': 'https://askida.app/problems/auth.invalid_credentials',
            'title': 'The credentials are incorrect.',
            'status': 401,
            'code': 'auth.invalid_credentials',
            'request_id': 'req-test-401',
          }),
          headers: FakeApi.problemHeaders(),
        ),
        data: Matchers.any,
      );

      await expectLater(
        api.client.post('auth/login', data: {}, auth: AuthScope.none),
        throwsA(
          isA<ApiProblem>().having(
            (p) => p.code,
            'code',
            'auth.invalid_credentials',
          ),
        ),
      );
      expect(await api.tokens.readUser(), userToken);
      expect(api.unauthenticated, isEmpty);
    });
  });

  test('presigned uploads go to the storage URL without the bearer', () async {
    final api = FakeApi(userToken: dummyToken());
    final url = Uri.parse('https://storage.askida.test/upload/doc-1');
    RequestOptions? seen;
    api.client.uploadDio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          seen = options;
          handler.next(options);
        },
      ),
    );
    api.uploads.onPut(
      url.toString(),
      (s) => s.reply(200, null),
      data: Matchers.any,
    );

    await api.client.putBytes(
      url,
      Uint8List.fromList([0x25, 0x50, 0x44, 0x46]),
      mime: 'application/pdf',
      headers: {'Content-Type': 'application/pdf'},
    );

    expect(seen, isNotNull);
    expect(seen!.headers.containsKey('Authorization'), isFalse);
    expect(seen!.headers.containsKey('X-Request-Id'), isFalse);
    expect(seen!.uri, url);
    expect(seen!.method, 'PUT');
    expect(seen!.headers[Headers.contentTypeHeader], 'application/pdf');
  });
}
