import 'dart:async';

import 'package:askida/core/qr/qr_scanner.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// [QrScanner] driven by the test: `scan('K7M2QX9R')`.
class FakeQrScanner implements QrScanner {
  final StreamController<String> _codes = StreamController.broadcast();
  final ValueNotifier<bool> _torch = ValueNotifier(false);
  bool running = false;
  bool disposed = false;

  void scan(String value) => _codes.add(value);

  @override
  Stream<String> get codes => _codes.stream;

  @override
  ValueListenable<bool> get torchOn => _torch;

  @override
  Future<void> start() async => running = true;

  @override
  Future<void> stop() async => running = false;

  @override
  Future<void> toggleTorch() async => _torch.value = !_torch.value;

  @override
  Widget preview() => const SizedBox.expand(key: ValueKey('fake-qr-preview'));

  @override
  Future<void> dispose() async {
    disposed = true;
    await _codes.close();
    _torch.dispose();
  }
}
