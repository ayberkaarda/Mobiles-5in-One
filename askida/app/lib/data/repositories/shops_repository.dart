import 'dart:typed_data';

import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/shop_document.dart';

/// Shops, their catalog and onboarding documents. Every method throws
/// `ApiProblem`.
abstract interface class ShopsRepository {
  /// `GET shops?near=lat,lng&radius=&hasAvailable=&cursor=` (verified shops,
  /// nearest first). Recipients pass coordinates already rounded to two
  /// decimals.
  Future<ShopPage> nearby(
    double lat,
    double lng, {
    int radiusM = 3000,
    bool hasAvailable = false,
    String? cursor,
  });

  /// `GET shops/{slug}`: public detail, or the owner shape for the owner.
  Future<ShopDetails> bySlug(String slug);

  /// `GET me/shops` (merchant): every shop where the account is owner or
  /// staff, with its role, ordered by name; empty when it has none.
  Future<List<MyShop>> myShops();

  /// `POST shops` (merchant): the new shop starts `pending`.
  Future<OwnerShop> create(ShopDraft draft);

  /// `PATCH shops/{id}` (owner): sensitive changes send it back to review.
  Future<OwnerShop> update(String shopId, ShopDraft changes);

  /// `GET shops/{id}/items` (owner or staff), inactive items included.
  Future<List<Item>> items(String shopId);

  /// `POST shops/{id}/items` (owner).
  Future<Item> createItem(String shopId, ItemDraft draft);

  /// `PATCH shops/{id}/items/{itemId}` (owner).
  Future<Item> updateItem(String shopId, String itemId, ItemDraft changes);

  /// `POST shops/{id}/documents/presign` (owner): a pending document and a
  /// 5-minute presigned PUT.
  Future<PresignedDocument> presignDocument(
    String shopId, {
    required DocumentKind kind,
    required String mime,
    required int size,
  });

  /// PUTs [bytes] to the presigned [url] (no API token is sent there).
  Future<void> uploadDocument(
    Uri url,
    Uint8List bytes,
    String mime, {
    Map<String, String> headers = const {},
  });

  /// `POST shops/{id}/documents/{documentId}/confirm`: server-side checks;
  /// a refused file is deleted by the server.
  Future<ShopDocument> confirmDocument(String shopId, String documentId);
}
