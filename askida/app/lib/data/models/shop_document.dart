import 'package:freezed_annotation/freezed_annotation.dart';

part 'shop_document.freezed.dart';
part 'shop_document.g.dart';

/// Document kinds of the shop onboarding.
@JsonEnum(fieldRename: FieldRename.snake)
enum DocumentKind { vergiLevhasi, isletmeBelgesi }

/// Upload state: `pending` until `confirm` accepted the stored bytes.
enum DocumentState { pending, uploaded }

@freezed
abstract class ShopDocument with _$ShopDocument {
  const factory({
    required String id,
    required DocumentKind kind,
    required String mime,
    required int size,
    required DocumentState state,
    DateTime? uploadedAt,
    DateTime? createdAt,
  }) = _ShopDocument;

  factory fromJson(Map<String, dynamic> json) => _$ShopDocumentFromJson(json);
}

/// Presigned PUT the client sends the file bytes to (5 minutes).
@freezed
abstract class DocumentUpload with _$DocumentUpload {
  const factory({
    required String method,
    required String url,
    required Map<String, String> headers,
    required DateTime expiresAt,
  }) = _DocumentUpload;

  factory fromJson(Map<String, dynamic> json) => _$DocumentUploadFromJson(json);
}

/// `POST shops/{id}/documents/presign` data: `{document, upload}`.
@freezed
abstract class PresignedDocument with _$PresignedDocument {
  const factory({
    required ShopDocument document,
    required DocumentUpload upload,
  }) = _PresignedDocument;

  factory fromJson(Map<String, dynamic> json) =>
      _$PresignedDocumentFromJson(json);
}
