import 'package:freezed_annotation/freezed_annotation.dart';

part 'api_problem.freezed.dart';
part 'api_problem.g.dart';

/// `{field, code}` of a `validation.failed` problem. The rule code is
/// snake case (`required`, `email`, `max`, ...); the value is never echoed.
@freezed
abstract class FieldError with _$FieldError {
  const factory({required String field, required String code}) = _FieldError;

  factory fromJson(Map<String, dynamic> json) => _$FieldErrorFromJson(json);
}

/// The single error type every repository throws.
///
/// Parsed from `application/problem+json` (`{type, title, status, code,
/// request_id, errors}`) or built on the device for transport failures
/// (codes under `network.` and `client.`). The UI maps [code], never
/// [title], to copy.
@freezed
abstract class ApiProblem with _$ApiProblem implements Exception {
  const factory({
    required String code,
    required int status,
    String? title,
    String? type,
    String? requestId,
    @JsonKey(name: 'errors')
    @Default(<FieldError>[])
    List<FieldError> fieldErrors,

    /// Seconds from the `Retry-After` header (429), when present.
    @JsonKey(includeFromJson: false, includeToJson: false) int? retryAfter,
  }) = _ApiProblem;

  const new _();

  factory fromJson(Map<String, dynamic> json) => _$ApiProblemFromJson(json);

  /// No connection to the server.
  static const String networkOffline = 'network.offline';

  /// The server did not answer in time.
  static const String networkTimeout = 'network.timeout';

  /// The server answered something the app cannot read.
  static const String badResponse = 'client.bad_response';

  /// The request was cancelled by the app.
  static const String cancelled = 'client.cancelled';

  bool get isValidation => code == 'validation.failed';

  /// Rule codes reported for [field].
  List<String> codesFor(String field) => [
    for (final error in fieldErrors)
      if (error.field == field) error.code,
  ];
}
