import 'package:freezed_annotation/freezed_annotation.dart';

part 'user.freezed.dart';
part 'user.g.dart';

/// Account kind; recipients never have accounts.
enum UserKind { donor, merchant }

/// `User` resource of `GET me`, `PATCH me` and every token body.
@freezed
abstract class User with _$User {
  const factory({
    required String id,
    required String email,
    required String name,
    required UserKind kind,
    required bool emailVerified,
  }) = _User;

  factory fromJson(Map<String, dynamic> json) => _$UserFromJson(json);
}
