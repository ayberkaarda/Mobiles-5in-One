import 'dart:math';

/// Produces the `X-Request-Id` of each request.
typedef RequestIdSource = String Function();

final Random _random = Random.secure();

/// A random (version 4) UUID; matches the server's accepted pattern
/// `^[A-Za-z0-9._-]{8,64}$`.
String randomRequestId() {
  final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
