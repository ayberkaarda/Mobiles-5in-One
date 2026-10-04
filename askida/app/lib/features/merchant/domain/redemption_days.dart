import 'package:flutter/foundation.dart';

/// A calendar day of the redemption log. Days follow the device's local
/// calendar, which for the shops of this app is Europe/Istanbul, the same
/// calendar the server counts in.
@immutable
class LogDay {
  const new(this.year, this.month, this.day);

  factory of(DateTime moment) {
    final local = moment.toLocal();
    return LogDay(local.year, local.month, local.day);
  }

  final int year;
  final int month;
  final int day;

  /// Local midnight that starts this day.
  DateTime get start => DateTime(year, month, day);

  /// Local midnight that starts the next day (exclusive end).
  DateTime get end => DateTime(year, month, day + 1);

  /// `YYYY-MM-DD`.
  String get key =>
      '${year.toString().padLeft(4, '0')}-'
      '${month.toString().padLeft(2, '0')}-'
      '${day.toString().padLeft(2, '0')}';

  @override
  bool operator ==(Object other) =>
      other is LogDay &&
      other.year == year &&
      other.month == month &&
      other.day == day;

  @override
  int get hashCode => Object.hash(year, month, day);

  @override
  String toString() => key;
}

/// How far back the on-device log goes (the database keeps 30 days).
const int kLogDays = 30;

/// Today first, then the 29 days before it.
List<LogDay> recentLogDays(DateTime now) {
  final today = LogDay.of(now);
  return [
    for (var i = 0; i < kLogDays; i++)
      LogDay.of(DateTime(today.year, today.month, today.day - i)),
  ];
}
