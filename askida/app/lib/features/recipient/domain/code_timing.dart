/// How long a one-time code stays valid, as the code screen shows it.
///
/// Rules (recorded for the docs):
/// * The code is shown exactly as issued and never fetched again: there is
///   no "refresh" while it is valid, so one device holds at most one code.
/// * The expiry comes from the server (`expires_at`); the device only counts
///   down to it with the app clock.
/// * At expiry the code screen replaces the tag with the expired state and
///   closes the full-brightness view. A new code can then be asked for from
///   the shop page; the server's daily limits decide whether it is issued.
abstract final class CodeTiming {
  /// Validity window the server issues codes with (spec: 10 minutes).
  static const Duration window = Duration(minutes: 10);

  /// Time left until [expiresAt]; never negative.
  static Duration remaining(DateTime expiresAt, DateTime now) {
    final left = expiresAt.difference(now);
    return left.isNegative ? Duration.zero : left;
  }

  /// True from the expiry instant on.
  static bool isExpired(DateTime expiresAt, DateTime now) =>
      !now.isBefore(expiresAt);

  /// `mm:ss`, seconds rounded up so the display reaches `00:00` only when
  /// the code has really expired.
  static String format(Duration left) {
    final seconds = (left.inMilliseconds / 1000).ceil();
    final minutes = seconds ~/ 60;
    final rest = seconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:'
        '${rest.toString().padLeft(2, '0')}';
  }

  /// Whole minutes left, rounded up (for the screen reader, which is told
  /// the time once a minute instead of every second).
  static int minutesLeft(Duration left) => (left.inSeconds / 60).ceil();
}
