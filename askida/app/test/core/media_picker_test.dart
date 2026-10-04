import 'dart:typed_data';

import 'package:askida/core/platform/media_picker.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';

import '../fakes/fake_media_picker.dart';

Uint8List _jpeg([int extra = 4]) =>
    Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, ...List.filled(extra, 0)]);

Uint8List _png() => Uint8List.fromList([
  0x89,
  0x50,
  0x4E,
  0x47,
  0x0D,
  0x0A,
  0x1A,
  0x0A,
  0,
  0,
  0,
  0x0D,
]);

void main() {
  test('sniffs JPEG and PNG, refuses the rest', () {
    expect(sniffImageMime(_jpeg()), 'image/jpeg');
    expect(sniffImageMime(_png()), 'image/png');
    expect(sniffImageMime(Uint8List.fromList('%PDF-1.7'.codeUnits)), isNull);
    expect(sniffImageMime(Uint8List(2)), isNull);
  });

  test('maps the source and returns bytes with the sniffed type', () async {
    ImageSource? asked;
    final picker = ImagePickerMediaPicker(
      pick: (source) async {
        asked = source;
        return XFile.fromData(_png(), name: 'belge.png', path: 'belge.png');
      },
    );

    final doc = await picker.pickDocument(source: DocumentSource.camera);

    expect(asked, ImageSource.camera);
    expect(doc!.mime, 'image/png');
    expect(doc.name, 'belge.png');
    expect(doc.size, 12);
  });

  test('closing the picker returns null', () async {
    final picker = ImagePickerMediaPicker(pick: (_) async => null);
    expect(await picker.pickDocument(source: DocumentSource.gallery), isNull);
  });

  test('a file that is not JPEG/PNG is refused', () async {
    final picker = ImagePickerMediaPicker(
      pick: (_) async =>
          XFile.fromData(Uint8List.fromList('GIF89a'.codeUnits), name: 'x.png'),
    );
    await expectLater(
      picker.pickDocument(source: DocumentSource.gallery),
      throwsA(isA<UnsupportedDocument>().having((e) => e.reason, 'r', 'type')),
    );
  });

  test('a file over 5 MB is refused', () async {
    final picker = ImagePickerMediaPicker(
      pick: (_) async => XFile.fromData(_jpeg(maxDocumentBytes), name: 'b.jpg'),
    );
    await expectLater(
      picker.pickDocument(source: DocumentSource.gallery),
      throwsA(isA<UnsupportedDocument>().having((e) => e.reason, 'r', 'size')),
    );
  });

  test('fake records sources and answers the scripted file', () async {
    final fake = FakeMediaPicker(next: FakeMediaPicker.sampleJpeg());
    final doc = await fake.pickDocument(source: DocumentSource.gallery);
    expect(doc!.mime, 'image/jpeg');
    expect(fake.sources, [DocumentSource.gallery]);
  });
}
