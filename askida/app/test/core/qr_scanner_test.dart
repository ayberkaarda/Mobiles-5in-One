import 'package:askida/core/qr/qr_scanner.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../fakes/fake_qr_scanner.dart';

void main() {
  test('capture payloads are trimmed, de-duplicated and never empty', () {
    const capture = BarcodeCapture(
      barcodes: [
        Barcode(rawValue: ' K7M2QX9R '),
        Barcode(rawValue: 'K7M2QX9R'),
        Barcode(rawValue: ''),
        Barcode(),
        Barcode(rawValue: 'A1B2C3D4'),
      ],
    );
    expect(codesFromCapture(capture), ['K7M2QX9R', 'A1B2C3D4']);
    expect(codesFromCapture(const BarcodeCapture()), isEmpty);
  });

  test('fake scanner emits codes, toggles the torch and disposes', () async {
    final scanner = FakeQrScanner();
    final seen = <String>[];
    final sub = scanner.codes.listen(seen.add);

    await scanner.start();
    scanner.scan('K7M2QX9R');
    await scanner.toggleTorch();
    await Future<void>.delayed(Duration.zero);

    expect(scanner.running, isTrue);
    expect(seen, ['K7M2QX9R']);
    expect(scanner.torchOn.value, isTrue);
    expect(scanner.preview(), isA<Widget>());

    await sub.cancel();
    await scanner.dispose();
    expect(scanner.disposed, isTrue);
  });
}
