import 'dart:typed_data';

import 'package:askida/core/platform/media_picker.dart';

/// [MediaPicker] returning [next] (null = the user closed the picker) or
/// throwing [failure].
class FakeMediaPicker implements MediaPicker {
  new({this.next});

  /// A tiny JPEG-looking document (leading bytes only).
  static PickedDocument sampleJpeg() => PickedDocument(
    bytes: Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]),
    mime: 'image/jpeg',
    name: 'vergi-levhasi.jpg',
  );

  PickedDocument? next;
  Exception? failure;
  final List<DocumentSource> sources = [];

  @override
  Future<PickedDocument?> pickDocument({required DocumentSource source}) async {
    sources.add(source);
    final error = failure;
    if (error != null) throw error;
    return next;
  }
}
