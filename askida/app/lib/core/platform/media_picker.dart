import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

/// Where a shop document photo comes from.
enum DocumentSource { camera, gallery }

/// A picked document, ready for `ShopsRepository.presignDocument` +
/// `uploadDocument` (the server checks size and magic bytes again).
@immutable
class PickedDocument {
  const new({required this.bytes, required this.mime, required this.name});

  final Uint8List bytes;

  /// `image/jpeg` or `image/png`, decided from the file's leading bytes.
  final String mime;
  final String name;

  int get size => bytes.length;
}

/// The picked file is not a JPEG/PNG or is larger than [maxDocumentBytes].
class UnsupportedDocument implements Exception {
  const new(this.reason);

  /// `type` or `size`.
  final String reason;

  @override
  String toString() => 'UnsupportedDocument($reason)';
}

/// Server limit for one document (5 MB).
const int maxDocumentBytes = 5 * 1024 * 1024;

/// Picks a document photo for the shop onboarding.
abstract interface class MediaPicker {
  /// Null when the user closed the picker. Throws [UnsupportedDocument]
  /// for a non-JPEG/PNG file or one over [maxDocumentBytes].
  Future<PickedDocument?> pickDocument({required DocumentSource source});
}

/// `image/jpeg` / `image/png` from the leading bytes, or null.
String? sniffImageMime(Uint8List bytes) {
  if (bytes.length >= 3 &&
      bytes[0] == 0xFF &&
      bytes[1] == 0xD8 &&
      bytes[2] == 0xFF) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (bytes.length >= png.length) {
    for (var i = 0; i < png.length; i++) {
      if (bytes[i] != png[i]) return null;
    }
    return 'image/png';
  }
  return null;
}

/// Opens the platform picker; returns the chosen file or null.
typedef XFilePick = Future<XFile?> Function(ImageSource source);

/// [MediaPicker] over `image_picker` (camera or gallery; original quality,
/// so the server-side byte checks see the real file).
class ImagePickerMediaPicker implements MediaPicker {
  new({XFilePick? pick})
    : _pick = pick ?? ((source) => ImagePicker().pickImage(source: source));

  final XFilePick _pick;

  @override
  Future<PickedDocument?> pickDocument({required DocumentSource source}) async {
    final file = await _pick(switch (source) {
      DocumentSource.camera => ImageSource.camera,
      DocumentSource.gallery => ImageSource.gallery,
    });
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    if (bytes.length > maxDocumentBytes) {
      throw const UnsupportedDocument('size');
    }
    final mime = sniffImageMime(bytes);
    if (mime == null) throw const UnsupportedDocument('type');
    return PickedDocument(bytes: bytes, mime: mime, name: file.name);
  }
}

final mediaPickerProvider = Provider<MediaPicker>(
  (ref) => ImagePickerMediaPicker(),
);
