import 'package:askida/data/models/reservation.dart';
import 'package:flutter/foundation.dart';

/// The one code this device holds right now. It lives in memory only: the
/// anonymous flow keeps no history, so closing the app forgets it.
@immutable
class ActiveCode {
  const new({required this.reservation, required this.shopSlug});

  final Reservation reservation;

  /// Slug of the shop the code is for, so the screen can lead back to it.
  final String shopSlug;

  String get code => reservation.code;

  /// Expiry in the device's local time (the server sends an offset).
  DateTime get expiresAt => reservation.expiresAt.toLocal();

  @override
  bool operator ==(Object other) =>
      other is ActiveCode &&
      other.reservation == reservation &&
      other.shopSlug == shopSlug;

  @override
  int get hashCode => Object.hash(reservation, shopSlug);
}
