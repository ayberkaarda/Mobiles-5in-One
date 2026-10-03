import 'package:askida/core/env/app_env.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppEnv.parse', () {
    test('accepts an absolute https URL', () {
      final env = AppEnv.parse('https://askida.app/api/v1');
      expect(env.apiBaseUrl, Uri.parse('https://askida.app/api/v1'));
    });

    test('accepts the local emulator URL and trims whitespace', () {
      final env = AppEnv.parse('  http://10.0.2.2:58080/api/v1 ');
      expect(env.apiBaseUrl.host, '10.0.2.2');
      expect(env.apiBaseUrl.port, 58080);
    });

    test('rejects an empty value', () {
      expect(() => AppEnv.parse(''), throwsA(isA<AppEnvException>()));
    });

    test('rejects a relative or non-http value', () {
      expect(() => AppEnv.parse('/api/v1'), throwsA(isA<AppEnvException>()));
      expect(
        () => AppEnv.parse('ftp://askida.app'),
        throwsA(isA<AppEnvException>()),
      );
    });
  });

  test('fromEnvironment fails fast when API_BASE_URL is not defined', () {
    // `flutter test` runs without --dart-define-from-file.
    expect(AppEnv.fromEnvironment, throwsA(isA<AppEnvException>()));
  });
}
