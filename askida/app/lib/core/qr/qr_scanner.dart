import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Camera QR scanning for the merchant redemption screen.
abstract interface class QrScanner {
  /// Scanned QR payloads (non-empty, trimmed, consecutive duplicates
  /// dropped). The screen normalises them as codes.
  Stream<String> get codes;

  /// Whether the torch is on.
  ValueListenable<bool> get torchOn;

  Future<void> start();
  Future<void> stop();
  Future<void> toggleTorch();

  /// The camera preview (nothing in tests).
  Widget preview();

  Future<void> dispose();
}

/// Payloads of one capture, cleaned: empty values dropped, whitespace
/// trimmed, duplicates within the capture removed.
List<String> codesFromCapture(BarcodeCapture capture) => [
  for (final value in {
    for (final barcode in capture.barcodes) barcode.rawValue?.trim() ?? '',
  })
    if (value.isNotEmpty) value,
];

/// [QrScanner] over `mobile_scanner` (QR only, back camera, no duplicates).
class MobileQrScanner implements QrScanner {
  new({MobileScannerController? controller})
    : _controller =
          controller ??
          MobileScannerController(
            formats: const [BarcodeFormat.qrCode],
            detectionSpeed: DetectionSpeed.noDuplicates,
            autoStart: false,
          ) {
    _subscription = _controller.barcodes.listen(
      (capture) => codesFromCapture(capture).forEach(_codes.add),
    );
    _controller.addListener(_syncTorch);
  }

  final MobileScannerController _controller;
  final StreamController<String> _codes = StreamController.broadcast();
  final ValueNotifier<bool> _torch = ValueNotifier(false);
  late final StreamSubscription<BarcodeCapture> _subscription;

  void _syncTorch() =>
      _torch.value = _controller.value.torchState == TorchState.on;

  @override
  Stream<String> get codes => _codes.stream.distinct();

  @override
  ValueListenable<bool> get torchOn => _torch;

  @override
  Future<void> start() => _controller.start();

  @override
  Future<void> stop() => _controller.stop();

  @override
  Future<void> toggleTorch() => _controller.toggleTorch();

  @override
  Widget preview() => MobileScanner(controller: _controller);

  @override
  Future<void> dispose() async {
    _controller.removeListener(_syncTorch);
    await _subscription.cancel();
    await _codes.close();
    _torch.dispose();
    await _controller.dispose();
  }
}

/// A new scanner per screen; the screen disposes it.
final qrScannerFactoryProvider = Provider<QrScanner Function()>(
  (ref) => MobileQrScanner.new,
);
