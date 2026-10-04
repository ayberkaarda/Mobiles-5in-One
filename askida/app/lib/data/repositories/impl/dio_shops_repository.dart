import 'dart:typed_data';

import 'package:askida/core/http/api_client.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/data/repositories/impl/json_body.dart';
import 'package:askida/data/repositories/shops_repository.dart';

class DioShopsRepository implements ShopsRepository {
  new(this._api);

  final ApiClient _api;

  @override
  Future<ShopPage> nearby(
    double lat,
    double lng, {
    int radiusM = 3000,
    bool hasAvailable = false,
    String? cursor,
  }) async {
    final answer = await _api.get(
      'shops',
      query: {
        'near': '$lat,$lng',
        'radius': radiusM,
        if (hasAvailable) 'hasAvailable': 1,
        'cursor': cursor,
      },
      auth: AuthScope.directory,
    );
    return parse<ShopPage>(() {
      final meta = metaOf(answer);
      return ShopPage(
        shops: listOf(answer).map(ShopSummary.fromJson).toList(),
        radius: meta['radius'] as int? ?? radiusM,
        nextCursor: meta['next_cursor'] as String?,
      );
    });
  }

  @override
  Future<ShopDetails> bySlug(String slug) async {
    final answer = await _api.get(
      'shops/${Uri.encodeComponent(slug)}',
      auth: AuthScope.directory,
    );
    return parse<ShopDetails>(() => ShopDetails.fromJson(objectOf(answer)));
  }

  @override
  Future<OwnerShop> create(ShopDraft draft) async {
    final answer = await _api.post('shops', data: draft.toJson());
    return parse<OwnerShop>(() => OwnerShop.fromJson(objectOf(answer)));
  }

  @override
  Future<OwnerShop> update(String shopId, ShopDraft changes) async {
    final answer = await _api.patch('shops/$shopId', data: changes.toJson());
    return parse<OwnerShop>(() => OwnerShop.fromJson(objectOf(answer)));
  }

  @override
  Future<List<MyShop>> myShops() async {
    final answer = await _api.get('me/shops');
    return parse<List<MyShop>>(
      () => listOf(answer).map(MyShop.fromJson).toList(),
    );
  }

  @override
  Future<List<Item>> items(String shopId) async {
    final answer = await _api.get('shops/$shopId/items');
    return parse<List<Item>>(() => listOf(answer).map(Item.fromJson).toList());
  }

  @override
  Future<Item> createItem(String shopId, ItemDraft draft) async {
    final answer = await _api.post('shops/$shopId/items', data: draft.toJson());
    return parse<Item>(() => Item.fromJson(objectOf(answer)));
  }

  @override
  Future<Item> updateItem(
    String shopId,
    String itemId,
    ItemDraft changes,
  ) async {
    final answer = await _api.patch(
      'shops/$shopId/items/$itemId',
      data: changes.toJson(),
    );
    return parse<Item>(() => Item.fromJson(objectOf(answer)));
  }

  @override
  Future<PresignedDocument> presignDocument(
    String shopId, {
    required DocumentKind kind,
    required String mime,
    required int size,
  }) async {
    final answer = await _api.post(
      'shops/$shopId/documents/presign',
      data: {
        'kind': switch (kind) {
          DocumentKind.vergiLevhasi => 'vergi_levhasi',
          DocumentKind.isletmeBelgesi => 'isletme_belgesi',
        },
        'mime': mime,
        'size': size,
      },
    );
    return parse<PresignedDocument>(
      () => PresignedDocument.fromJson(objectOf(answer)),
    );
  }

  @override
  Future<void> uploadDocument(
    Uri url,
    Uint8List bytes,
    String mime, {
    Map<String, String> headers = const {},
  }) => _api.putBytes(url, bytes, mime: mime, headers: headers);

  @override
  Future<ShopDocument> confirmDocument(String shopId, String documentId) async {
    final answer = await _api.post(
      'shops/$shopId/documents/$documentId/confirm',
    );
    return parse<ShopDocument>(() => ShopDocument.fromJson(objectOf(answer)));
  }
}
