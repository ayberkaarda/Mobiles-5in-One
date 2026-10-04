import 'dart:typed_data';

import 'package:askida/core/time/clock.dart';
import 'package:askida/data/db/app_database.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/data/repositories/shops_repository.dart';

/// Read-through cache over a [ShopsRepository].
///
/// * [nearby] and [bySlug]: the network first; fresh answers are stored
///   (24 h TTL). When the device is offline or the server does not answer,
///   cached rows inside the TTL are served; with nothing cached the problem
///   is rethrown.
/// * [watchNearby]: stale-while-revalidate for lists: emits the cached
///   list at once (if any), then the network answer.
/// * Owner shapes and every write go straight to the network.
class CachedShopsRepository implements ShopsRepository {
  new(this._remote, this._db, {this._clock = DateTime.now});

  final ShopsRepository _remote;
  final AppDatabase _db;
  final Clock _clock;

  static bool _isTransport(ApiProblem problem) =>
      problem.status == 0 ||
      problem.code == 'server_error' ||
      problem.code == 'service_unavailable';

  @override
  Future<ShopPage> nearby(
    double lat,
    double lng, {
    int radiusM = 3000,
    bool hasAvailable = false,
    String? cursor,
  }) async {
    try {
      final page = await _remote.nearby(
        lat,
        lng,
        radiusM: radiusM,
        hasAvailable: hasAvailable,
        cursor: cursor,
      );
      await _db.upsertShopSummaries(page.shops, _clock());
      return page;
    } on ApiProblem catch (problem) {
      if (cursor != null || !_isTransport(problem)) rethrow;
      final cached = await _db.shopsNear(
        lat,
        lng,
        radiusM: radiusM,
        now: _clock(),
        hasAvailable: hasAvailable,
      );
      if (cached.isEmpty) rethrow;
      return ShopPage(shops: cached, radius: radiusM);
    }
  }

  /// Cached list first (when present), then the network list. A network
  /// failure after a cached emission ends the stream quietly; without a
  /// cached emission the problem is delivered as an error.
  Stream<ShopPage> watchNearby(
    double lat,
    double lng, {
    int radiusM = 3000,
    bool hasAvailable = false,
  }) async* {
    final cached = await _db.shopsNear(
      lat,
      lng,
      radiusM: radiusM,
      now: _clock(),
      hasAvailable: hasAvailable,
    );
    if (cached.isNotEmpty) yield ShopPage(shops: cached, radius: radiusM);
    try {
      final page = await _remote.nearby(
        lat,
        lng,
        radiusM: radiusM,
        hasAvailable: hasAvailable,
      );
      await _db.upsertShopSummaries(page.shops, _clock());
      yield page;
    } on ApiProblem {
      if (cached.isEmpty) rethrow;
    }
  }

  @override
  Future<ShopDetails> bySlug(String slug) async {
    try {
      final details = await _remote.bySlug(slug);
      if (details is PublicShopDetails) {
        await _db.upsertShopDetail(details.shop, _clock());
      }
      return details;
    } on ApiProblem catch (problem) {
      if (!_isTransport(problem)) rethrow;
      final cached = await _db.shopDetailBySlug(slug, _clock());
      if (cached == null) rethrow;
      return PublicShopDetails(cached);
    }
  }

  @override
  Future<OwnerShop> create(ShopDraft draft) => _remote.create(draft);

  @override
  Future<OwnerShop> update(String shopId, ShopDraft changes) =>
      _remote.update(shopId, changes);

  @override
  Future<List<Item>> items(String shopId) => _remote.items(shopId);

  @override
  Future<Item> createItem(String shopId, ItemDraft draft) =>
      _remote.createItem(shopId, draft);

  @override
  Future<Item> updateItem(String shopId, String itemId, ItemDraft changes) =>
      _remote.updateItem(shopId, itemId, changes);

  @override
  Future<PresignedDocument> presignDocument(
    String shopId, {
    required DocumentKind kind,
    required String mime,
    required int size,
  }) => _remote.presignDocument(shopId, kind: kind, mime: mime, size: size);

  @override
  Future<void> uploadDocument(
    Uri url,
    Uint8List bytes,
    String mime, {
    Map<String, String> headers = const {},
  }) => _remote.uploadDocument(url, bytes, mime, headers: headers);

  @override
  Future<ShopDocument> confirmDocument(String shopId, String documentId) =>
      _remote.confirmDocument(shopId, documentId);
}
