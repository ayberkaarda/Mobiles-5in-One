import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Source of "now". Code that compares times (cache TTL, code expiry,
/// countdowns) reads the clock through [clockProvider] so tests can pin it.
typedef Clock = DateTime Function();

final clockProvider = Provider<Clock>((ref) => DateTime.now);
