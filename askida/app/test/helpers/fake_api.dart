import 'dart:convert';

import 'package:askida/core/http/api_client.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:dio/dio.dart';
import 'package:http_mock_adapter/http_mock_adapter.dart';

import 'fixtures.dart';

/// A real [ApiClient] whose transport is an in-process mock server
/// (`http_mock_adapter`). Responses are configured per route with bodies
/// from `test/fixtures`; every request the client actually sent (after the
/// interceptors) is recorded in [sent].
class FakeApi {
  new({String? userToken, String? anonToken, String languageTag = 'tr'})
    : tokens = InMemoryTokenStore(user: userToken, anon: anonToken) {
    client = ApiClient(
      baseUrl: Uri.parse(baseUrl),
      tokens: tokens,
      languageTag: () => languageTag,
      requestId: () => 'req-${++_requestCount}-test',
      onUnauthenticated: unauthenticated.add,
    );
    adapter = DioAdapter(dio: client.dio);
    client.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          sent.add(options);
          handler.next(options);
        },
      ),
    );
    uploads = DioAdapter(dio: client.uploadDio);
  }

  static const baseUrl = 'http://10.0.2.2:58080/api/v1';

  final InMemoryTokenStore tokens;
  late final ApiClient client;
  late final DioAdapter adapter;

  /// Mock server of the presigned storage client.
  late final DioAdapter uploads;

  /// Requests that left the client, in order.
  final List<RequestOptions> sent = [];

  /// Scopes reported through the 401 callback.
  final List<AuthScope> unauthenticated = [];

  int _requestCount = 0;

  RequestOptions get last => sent.last;

  /// Headers of a problem+json answer.
  static Map<String, List<String>> problemHeaders({int? retryAfter}) => {
    Headers.contentTypeHeader: ['application/problem+json'],
    if (retryAfter != null) 'retry-after': ['$retryAfter'],
  };

  /// Replies to [method] [path] with a problem fixture.
  void replyProblem(
    String method,
    String path,
    String fixtureName, {
    Object? data = Matchers.any,
    Map<String, dynamic>? query,
    int? retryAfter,
  }) {
    final problem = fixture(fixtureName);
    final status = problem['status'] as int;
    // The mock server only encodes `application/json` bodies itself.
    final body = jsonEncode(problem);
    final headers = problemHeaders(retryAfter: retryAfter);
    switch (method) {
      case 'GET':
        adapter.onGet(
          path,
          (s) => s.reply(status, body, headers: headers),
          queryParameters: query,
        );
      case 'POST':
        adapter.onPost(
          path,
          (s) => s.reply(status, body, headers: headers),
          data: data,
        );
      case 'PUT':
        adapter.onPut(
          path,
          (s) => s.reply(status, body, headers: headers),
          data: data,
        );
      case 'PATCH':
        adapter.onPatch(
          path,
          (s) => s.reply(status, body, headers: headers),
          data: data,
        );
      case 'DELETE':
        adapter.onDelete(
          path,
          (s) => s.reply(status, body, headers: headers),
          data: data,
        );
      default:
        throw ArgumentError.value(method, 'method');
    }
  }
}
