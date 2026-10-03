import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Build-time configuration passed with
/// `--dart-define-from-file=env/<flavor>.json`.
///
/// The only key is `API_BASE_URL`; no secret ever travels through this path.
class AppEnv {
  const new({required this.apiBaseUrl});

  /// Reads the compile-time define and validates it.
  factory fromEnvironment() =>
      AppEnv.parse(const String.fromEnvironment(apiBaseUrlKey));

  /// Validates a raw `API_BASE_URL` value.
  factory parse(String rawApiBaseUrl) {
    final value = rawApiBaseUrl.trim();
    if (value.isEmpty) {
      throw const AppEnvException(
        '$apiBaseUrlKey is missing. Build with '
        '--dart-define-from-file=env/example.json (or env/dev.json).',
      );
    }
    final uri = Uri.tryParse(value);
    if (uri == null ||
        !(uri.isScheme('https') || uri.isScheme('http')) ||
        uri.host.isEmpty) {
      throw AppEnvException(
        '$apiBaseUrlKey must be an absolute http(s) URL, got "$value".',
      );
    }
    return AppEnv(apiBaseUrl: uri);
  }

  static const apiBaseUrlKey = 'API_BASE_URL';

  final Uri apiBaseUrl;
}

class AppEnvException implements Exception {
  const new(this.message);

  final String message;

  @override
  String toString() => 'AppEnvException: $message';
}

/// Overridden in `main()` with the validated build configuration.
final appEnvProvider = Provider<AppEnv>(
  (ref) => throw StateError('appEnvProvider must be overridden at startup.'),
);
