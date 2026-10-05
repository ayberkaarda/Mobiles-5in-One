import 'package:askida/data/models/user.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Rules the auth forms share with the server (Phase 1 contract):
/// passwords of 10 to 128 characters, e-mails up to 254 characters, the
/// 6-digit code of the verification and reset mails.
abstract final class AuthRules {
  static const int passwordMin = 10;
  static const int passwordMax = 128;
  static const int emailMax = 254;
  static const int nameMax = 100;
  static const int codeLength = 6;

  /// Version of the KVKK notice the user accepts at registration. The
  /// notice itself is a sample text until the legal copy exists.
  static const String kvkkTextVersion = '2026-10-sample';

  static final RegExp _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
  static final RegExp _code = RegExp(r'^\d{6}$');

  static bool isEmail(String value) {
    final email = value.trim();
    return email.length <= emailMax && _email.hasMatch(email);
  }

  static bool isPassword(String value) =>
      value.length >= passwordMin && value.length <= passwordMax;

  static bool isCode(String value) => _code.hasMatch(value.trim());

  /// E-mails travel trimmed and lowercased (the server normalises them the
  /// same way).
  static String normaliseEmail(String value) => value.trim().toLowerCase();
}

/// `device_name` sent with every sign-in. It names the app and platform
/// only; nothing about the person or the device model.
final deviceNameProvider = Provider<String>(
  (ref) => 'Askıda ${ref.watch(devicePlatformProvider)}',
);

/// A `from` location is followed only when it is an in-app path (no scheme,
/// no host, not the auth screens themselves).
String? safeReturnLocation(String? from) {
  if (from == null || from.isEmpty) return null;
  if (!from.startsWith('/') || from.startsWith('//')) return null;
  final uri = Uri.tryParse(from);
  if (uri == null || uri.hasScheme || uri.hasAuthority) return null;
  if (uri.path == AppPaths.auth || uri.path.startsWith('${AppPaths.auth}/')) {
    return null;
  }
  return from;
}

/// Where a fresh sign-in continues: the guarded screen the user came from,
/// otherwise the home of the account's mode.
String homeAfterSignIn(User user, {String? from}) =>
    safeReturnLocation(from) ??
    (user.kind == UserKind.merchant
        ? AppMode.merchant.path
        : AppMode.donor.path);

/// Auth locations with their query parameters.
abstract final class AuthPaths {
  static const register = '${AppPaths.auth}/register';
  static const forgot = '${AppPaths.auth}/forgot';
  static const reset = '${AppPaths.auth}/reset';
  static const verify = '${AppPaths.auth}/verify';

  static String _with(String path, Map<String, String?> query) {
    final params = {
      for (final e in query.entries)
        if (e.value != null && e.value!.isNotEmpty) e.key: e.value!,
    };
    return Uri(
      path: path,
      queryParameters: params.isEmpty ? null : params,
    ).toString();
  }

  static String signIn({String? from}) =>
      _with(AppPaths.auth, {'from': safeReturnLocation(from)});

  static String registerWith({String? from, UserKind? kind}) =>
      _with(register, {'from': safeReturnLocation(from), 'kind': kind?.name});

  static String forgotWith({String? email}) => _with(forgot, {'email': email});

  static String resetWith({required String email}) =>
      _with(reset, {'email': email});

  static String verifyWith({required String email, String? next}) =>
      _with(verify, {'email': email, 'next': safeReturnLocation(next)});
}
