import 'package:askida/data/models/user.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'auth_session.freezed.dart';
part 'auth_session.g.dart';

/// Token body of `auth/register`, `auth/login`, `auth/apple`, `auth/google`:
/// `{token, token_type, expires_at, abilities, user}`.
@freezed
abstract class AuthSession with _$AuthSession {
  const factory({
    required String token,
    required String tokenType,
    required DateTime expiresAt,
    required List<String> abilities,
    required User user,
  }) = _AuthSession;

  factory fromJson(Map<String, dynamic> json) => _$AuthSessionFromJson(json);
}

/// Token body of `anon/attest`: the same shape without a user. The anon id
/// itself never reaches the device.
@freezed
abstract class AnonSession with _$AnonSession {
  const factory({
    required String token,
    required String tokenType,
    required List<String> abilities,
    DateTime? expiresAt,
  }) = _AnonSession;

  factory fromJson(Map<String, dynamic> json) => _$AnonSessionFromJson(json);
}

/// `DELETE me` answer (202): `{status: "pending", grace_until}`.
@freezed
abstract class DeletionPending with _$DeletionPending {
  const factory({required String status, required DateTime graceUntil}) =
      _DeletionPending;

  factory fromJson(Map<String, dynamic> json) =>
      _$DeletionPendingFromJson(json);
}
