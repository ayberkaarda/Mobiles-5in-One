import 'package:askida/data/models/api_problem.dart';

/// Wipes local data (the offline database) after an identity is erased.
typedef LocalDataEraser = Future<void> Function();

const ApiProblem _badResponse = ApiProblem(
  code: ApiProblem.badResponse,
  status: 0,
);

/// The object of a body: the `data` member for resource answers, the body
/// itself for bare answers (token bodies, reserve, redeem, checkout).
Map<String, dynamic> objectOf(Object? body) {
  if (body is Map<String, dynamic>) {
    final data = body['data'];
    if (data is Map<String, dynamic>) return data;
    return body;
  }
  throw _badResponse;
}

/// The `data` list of a collection answer.
List<Map<String, dynamic>> listOf(Object? body) {
  final data = body is Map<String, dynamic> ? body['data'] : null;
  if (data is List) {
    return [
      for (final row in data)
        if (row is Map<String, dynamic>) row else throw _badResponse,
    ];
  }
  throw _badResponse;
}

/// The `meta` member of a collection answer (empty when absent).
Map<String, dynamic> metaOf(Object? body) {
  final meta = body is Map<String, dynamic> ? body['meta'] : null;
  return meta is Map<String, dynamic> ? meta : const {};
}

/// Runs a model parser and turns any shape mismatch into
/// `client.bad_response`, so callers only ever see `ApiProblem`.
T parse<T>(T Function() read) {
  try {
    return read();
  } on ApiProblem {
    rethrow;
  } on Object {
    throw _badResponse;
  }
}

/// `YYYY-MM-DD` of [day] as given (callers pass Istanbul calendar days).
String isoDay(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-'
    '${day.month.toString().padLeft(2, '0')}-'
    '${day.day.toString().padLeft(2, '0')}';
