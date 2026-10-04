import 'dart:typed_data';

import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/data/repositories/shops_repository.dart';

import '../helpers/fixtures.dart';
import 'scriptable.dart';

/// In-memory [ShopsRepository] seeded from the fixtures.
class FakeShopsRepository with Scriptable implements ShopsRepository {
  new({List<ShopSummary>? shops, this.ownShop})
    : shops = shops ?? sampleShops() {
    details[samplePublicShop().slug] = PublicShopDetails(samplePublicShop());
    catalog[samplePublicShop().id] = sampleItems();
  }

  static List<ShopSummary> sampleShops() =>
      fixtureList('shops_nearby').map(ShopSummary.fromJson).toList();

  static PublicShop samplePublicShop() =>
      PublicShop.fromJson(fixtureData('shop_public'));

  static OwnerShop sampleOwnerShop() =>
      OwnerShop.fromJson(fixtureData('shop_owner'));

  static List<Item> sampleItems() =>
      fixtureList('items_owner').map(Item.fromJson).toList();

  /// What [nearby] returns (filtered by `hasAvailable`).
  List<ShopSummary> shops;

  /// slug -> detail answered by [bySlug].
  final Map<String, ShopDetails> details = {};

  /// shop id -> owner catalog.
  final Map<String, List<Item>> catalog = {};

  /// The merchant's own shop once created.
  OwnerShop? ownShop;

  /// Arguments of the last [nearby] call.
  ({double lat, double lng, int radiusM, bool hasAvailable, String? cursor})?
  lastNearby;

  /// Documents by id; uploads are stored as their byte length.
  final Map<String, ShopDocument> documents = {};
  final Map<Uri, int> uploads = {};

  static const _notFound = ApiProblem(code: 'not_found', status: 404);

  @override
  Future<ShopPage> nearby(
    double lat,
    double lng, {
    int radiusM = 3000,
    bool hasAvailable = false,
    String? cursor,
  }) async {
    record('nearby');
    lastNearby = (
      lat: lat,
      lng: lng,
      radiusM: radiusM,
      hasAvailable: hasAvailable,
      cursor: cursor,
    );
    return ShopPage(
      shops: [
        for (final shop in shops)
          if (!hasAvailable || shop.availableCount > 0) shop,
      ],
      radius: radiusM,
    );
  }

  @override
  Future<ShopDetails> bySlug(String slug) async {
    record('bySlug');
    final own = ownShop;
    if (own != null && own.slug == slug) return OwnerShopDetails(own);
    return details[slug] ?? (throw _notFound);
  }

  @override
  Future<OwnerShop> create(ShopDraft draft) async {
    record('create');
    final shop = sampleOwnerShop().copyWith(
      name: draft.name ?? sampleOwnerShop().name,
      type: draft.type ?? ShopType.other,
      address: draft.address ?? '',
      il: draft.il ?? '',
      ilce: draft.ilce ?? '',
      location: GeoPoint(lat: draft.lat ?? 0, lng: draft.lng ?? 0),
      listedOnWeb: draft.listedOnWeb ?? false,
      verificationState: VerificationState.pending,
    );
    ownShop = shop;
    catalog[shop.id] = [];
    return shop;
  }

  @override
  Future<OwnerShop> update(String shopId, ShopDraft changes) async {
    record('update');
    final shop = ownShop;
    if (shop == null || shop.id != shopId) throw _notFound;
    final updated = shop.copyWith(
      name: changes.name ?? shop.name,
      address: changes.address ?? shop.address,
      listedOnWeb: changes.listedOnWeb ?? shop.listedOnWeb,
    );
    ownShop = updated;
    return updated;
  }

  @override
  Future<List<Item>> items(String shopId) async {
    record('items');
    return List.unmodifiable(catalog[shopId] ?? (throw _notFound));
  }

  @override
  Future<Item> createItem(String shopId, ItemDraft draft) async {
    record('createItem');
    final list = catalog[shopId] ?? (throw _notFound);
    final item = Item(
      id: 'item-${list.length + 1}',
      shopId: shopId,
      name: draft.name ?? '',
      category: draft.category ?? ItemCategory.diger,
      categoryLabel: (draft.category ?? ItemCategory.diger).name,
      priceMinor: draft.priceMinor ?? 0,
      currency: 'TRY',
      dailyCap: draft.dailyCap ?? 1,
      active: draft.active ?? true,
    );
    list.add(item);
    return item;
  }

  @override
  Future<Item> updateItem(
    String shopId,
    String itemId,
    ItemDraft changes,
  ) async {
    record('updateItem');
    final list = catalog[shopId] ?? (throw _notFound);
    final index = list.indexWhere((i) => i.id == itemId);
    if (index < 0) throw _notFound;
    final item = list[index];
    final updated = item.copyWith(
      name: changes.name ?? item.name,
      category: changes.category ?? item.category,
      priceMinor: changes.priceMinor ?? item.priceMinor,
      dailyCap: changes.dailyCap ?? item.dailyCap,
      active: changes.active ?? item.active,
    );
    list[index] = updated;
    return updated;
  }

  @override
  Future<PresignedDocument> presignDocument(
    String shopId, {
    required DocumentKind kind,
    required String mime,
    required int size,
  }) async {
    record('presignDocument');
    final sample = PresignedDocument.fromJson(fixtureData('document_presign'));
    final presigned = sample.copyWith(
      document: sample.document.copyWith(
        id: 'doc-${documents.length + 1}',
        kind: kind,
        mime: mime,
        size: size,
      ),
      upload: sample.upload.copyWith(headers: {'Content-Type': mime}),
    );
    documents[presigned.document.id] = presigned.document;
    return presigned;
  }

  @override
  Future<void> uploadDocument(
    Uri url,
    Uint8List bytes,
    String mime, {
    Map<String, String> headers = const {},
  }) async {
    record('uploadDocument');
    uploads[url] = bytes.length;
  }

  @override
  Future<ShopDocument> confirmDocument(String shopId, String documentId) async {
    record('confirmDocument');
    final doc = documents[documentId] ?? (throw _notFound);
    final confirmed = doc.copyWith(
      state: DocumentState.uploaded,
      uploadedAt: DateTime.utc(2026, 10, 4, 6, 11),
    );
    documents[documentId] = confirmed;
    return confirmed;
  }
}
