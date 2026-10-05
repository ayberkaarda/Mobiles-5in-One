import 'dart:async';
import 'dart:convert';
import 'dart:io' show SocketException;
import 'dart:typed_data';

import 'package:askida/core/http/request_id.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:dio/dio.dart';

/// Which bearer token a route takes.
enum AuthScope {
  /// Public route (`auth/*`, `anon/attest`, `impact`).
  none,

  /// Donor or merchant account token.
  user,

  /// Anonymous recipient device token (`hooks/reserve`, `anon/me`).
  anon,

  /// Shop directory reads (`GET shops`, `GET shops/{slug}`), open to donors,
  /// merchants and anonymous recipient devices: the account token when one
  /// is stored, otherwise the anon token.
  directory,
}

/// Called after a `401 auth.unauthenticated` cleared the token of [scope].
typedef UnauthenticatedCallback = void Function(AuthScope scope);

/// The one HTTP client of the app.
///
/// * Base URL from `AppEnv` (`API_BASE_URL`).
/// * Adds `Authorization: Bearer` by route scope, `X-Request-Id`,
///   `Accept: application/json` and `Accept-Language`.
/// * Turns every failure into an [ApiProblem] (problem+json parsed, transport
///   failures mapped to `network.*` / `client.*` codes).
/// * A `401 auth.unauthenticated` on an authenticated route clears that
///   token and calls [UnauthenticatedCallback].
/// * Never logs bodies or headers: no logging interceptor is installed.
class ApiClient {
  new({
    required Uri baseUrl,
    required TokenStore tokens,
    UnauthenticatedCallback? onUnauthenticated,
    String Function()? languageTag,
    RequestIdSource requestId = randomRequestId,
    Dio? dio,
    Dio? uploadDio,
  }) : _tokens = tokens,
       dio = dio ?? Dio(),
       uploadDio = uploadDio ?? Dio() {
    final base = baseUrl.toString();
    this.dio.options
      ..baseUrl = base.endsWith('/') ? base : '$base/'
      ..connectTimeout = connectTimeout
      ..sendTimeout = transferTimeout
      ..receiveTimeout = transferTimeout
      ..responseType = ResponseType.json
      ..followRedirects = false;
    this.dio.interceptors.add(
      _ApiInterceptor(
        tokens: tokens,
        languageTag: languageTag ?? () => 'tr',
        requestId: requestId,
        onUnauthenticated: onUnauthenticated,
      ),
    );
    this.uploadDio.options
      ..connectTimeout = connectTimeout
      ..sendTimeout = uploadTimeout
      ..receiveTimeout = transferTimeout;
  }

  static const connectTimeout = Duration(seconds: 10);
  static const transferTimeout = Duration(seconds: 20);
  static const uploadTimeout = Duration(seconds: 60);

  /// Key of the request `extra` holding the [AuthScope].
  static const authScopeKey = 'askida.auth_scope';

  final TokenStore _tokens;

  /// API client (interceptors installed). Exposed for test adapters.
  final Dio dio;

  /// Bare client for presigned storage URLs: never carries the bearer token.
  final Dio uploadDio;

  TokenStore get tokens => _tokens;

  Future<Object?> get(
    String path, {
    Map<String, Object?>? query,
    AuthScope auth = AuthScope.user,
  }) => _send('GET', path, query: query, auth: auth);

  Future<Object?> post(
    String path, {
    Object? data,
    AuthScope auth = AuthScope.user,
  }) => _send('POST', path, data: data, auth: auth);

  Future<Object?> put(
    String path, {
    Object? data,
    AuthScope auth = AuthScope.user,
  }) => _send('PUT', path, data: data, auth: auth);

  Future<Object?> patch(
    String path, {
    Object? data,
    AuthScope auth = AuthScope.user,
  }) => _send('PATCH', path, data: data, auth: auth);

  Future<Object?> delete(
    String path, {
    Object? data,
    AuthScope auth = AuthScope.user,
  }) => _send('DELETE', path, data: data, auth: auth);

  /// PUTs raw bytes to a presigned storage URL with the headers the server
  /// returned. No API headers or token are sent.
  Future<void> putBytes(
    Uri url,
    Uint8List bytes, {
    required String mime,
    Map<String, String> headers = const {},
  }) async {
    try {
      await uploadDio.putUri<void>(
        url,
        data: Stream<List<int>>.value(bytes),
        options: Options(
          headers: {
            ...headers,
            Headers.contentTypeHeader: mime,
            Headers.contentLengthHeader: bytes.length,
          },
        ),
      );
    } on DioException catch (error) {
      throw problemFromDioException(error);
    }
  }

  Future<Object?> _send(
    String method,
    String path, {
    required AuthScope auth,
    Map<String, Object?>? query,
    Object? data,
  }) async {
    assert(!path.startsWith('/'), 'paths are relative to the base URL');
    try {
      final response = await dio.request<Object?>(
        path,
        data: data,
        queryParameters: query == null
            ? null
            : {
                for (final e in query.entries)
                  if (e.value != null) e.key: e.value,
              },
        options: Options(method: method, extra: {authScopeKey: auth}),
      );
      return response.data;
    } on DioException catch (error) {
      throw problemFromDioException(error);
    }
  }
}

class _ApiInterceptor extends Interceptor {
  new({
    required this.tokens,
    required this.languageTag,
    required this.requestId,
    required this.onUnauthenticated,
  });

  final TokenStore tokens;
  final String Function() languageTag;
  final RequestIdSource requestId;
  final UnauthenticatedCallback? onUnauthenticated;

  static AuthScope _scopeOf(RequestOptions options) =>
      options.extra[ApiClient.authScopeKey] as AuthScope? ?? AuthScope.none;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    options.headers
      ..['Accept'] = 'application/json'
      ..['Accept-Language'] = languageTag()
      ..['X-Request-Id'] = requestId()
      ..remove('Authorization');
    var scope = _scopeOf(options);
    if (scope == AuthScope.directory) {
      // Record the token actually sent, so a 401 clears that one only.
      final user = await tokens.readUser();
      scope = user != null && user.isNotEmpty ? AuthScope.user : AuthScope.anon;
      options.extra[ApiClient.authScopeKey] = scope;
    }
    final token = switch (scope) {
      AuthScope.none || AuthScope.directory => null,
      AuthScope.user => await tokens.readUser(),
      AuthScope.anon => await tokens.readAnon(),
    };
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final scope = _scopeOf(err.requestOptions);
    final response = err.response;
    if (response?.statusCode == 401 && scope != AuthScope.none) {
      final problem = problemFromResponse(response!);
      if (problem.code == 'auth.unauthenticated') {
        if (scope == AuthScope.user) {
          await tokens.clearUser();
        } else {
          await tokens.clearAnon();
        }
        onUnauthenticated?.call(scope);
      }
    }
    handler.next(err);
  }
}

/// Maps any dio failure to an [ApiProblem].
ApiProblem problemFromDioException(DioException error) {
  final response = error.response;
  if (response != null) return problemFromResponse(response);
  return switch (error.type) {
    DioExceptionType.connectionTimeout ||
    DioExceptionType.sendTimeout ||
    DioExceptionType.receiveTimeout ||
    DioExceptionType.transformTimeout => const ApiProblem(
      code: ApiProblem.networkTimeout,
      status: 0,
    ),
    DioExceptionType.cancel => const ApiProblem(
      code: ApiProblem.cancelled,
      status: 0,
    ),
    DioExceptionType.connectionError || DioExceptionType.badCertificate =>
      const ApiProblem(code: ApiProblem.networkOffline, status: 0),
    DioExceptionType.badResponse => const ApiProblem(
      code: ApiProblem.badResponse,
      status: 0,
    ),
    DioExceptionType.unknown => ApiProblem(
      code: error.error is SocketException
          ? ApiProblem.networkOffline
          : ApiProblem.badResponse,
      status: 0,
    ),
  };
}

/// Parses a problem+json body; a body without a `code` falls back to a code
/// derived from the status, so the UI never shows raw server text.
ApiProblem problemFromResponse(Response<Object?> response) {
  final status = response.statusCode ?? 0;
  final retryAfter = int.tryParse(response.headers.value('retry-after') ?? '');
  var body = response.data;
  if (body is String && body.trimLeft().startsWith('{')) {
    try {
      body = jsonDecode(body);
    } on FormatException {
      body = null;
    }
  }
  if (body is Map<String, dynamic> && body['code'] is String) {
    try {
      return ApiProblem.fromJson({
        ...body,
        'status': body['status'] is int ? body['status'] : status,
      }).copyWith(retryAfter: retryAfter);
    } on Object {
      // Fall through to the status mapping below.
    }
  }
  return ApiProblem(
    code: _codeForStatus(status),
    status: status,
    retryAfter: retryAfter,
  );
}

String _codeForStatus(int status) => switch (status) {
  401 => 'auth.unauthenticated',
  403 => 'forbidden',
  404 => 'not_found',
  405 => 'method_not_allowed',
  409 => 'conflict',
  413 => 'payload_too_large',
  415 => 'unsupported_media_type',
  422 => 'validation.failed',
  429 => 'rate_limited',
  503 => 'service_unavailable',
  >= 500 => 'server_error',
  _ => 'bad_request',
};
