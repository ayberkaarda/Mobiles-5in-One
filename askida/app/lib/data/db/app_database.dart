import 'dart:convert';
import 'dart:math' as math;

import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/models/shop.dart';
import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_database.g.dart';

/// Shops seen in lists or detail screens. Public data only: the owner
/// shape (phone, masked tax/IBAN) is never cached.
@DataClassName('CachedShopRow')
class CachedShops extends Table {
  TextColumn get id => text()();
  TextColumn get slug => text().unique()();
  RealColumn get lat => real()();
  RealColumn get lng => real()();

  /// `ShopSummary` JSON (distance removed; it depends on the query point).
  TextColumn get summaryJson => text()();

  /// `PublicShop` JSON without items, once the detail was opened.
  TextColumn get detailJson => text().nullable()();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Items of cached shop details.
@DataClassName('CachedItemRow')
class CachedItems extends Table {
  TextColumn get id => text()();
  TextColumn get shopId => text().references(CachedShops, #id)();
  TextColumn get itemJson => text()();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// The merchant's redemptions of the last 30 days (item name, time, role):
/// nothing about who collected.
@DataClassName('RedemptionLogRow')
class RedemptionLog extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get shopId => text()();
  TextColumn get itemName => text()();
  DateTimeColumn get redeemedAt => dateTime()();
  TextColumn get redeemedByRole => text().nullable()();

  @override
  List<Set<Column<Object>>> get uniqueKeys => [
    {shopId, redeemedAt, itemName},
  ];
}

@DriftDatabase(tables: [CachedShops, CachedItems, RedemptionLog])
class AppDatabase extends _$AppDatabase {
  new(super.e);

  /// The on-device database file `askida`.
  factory open() => AppDatabase(driftDatabase(name: 'askida'));

  /// Shop and item rows are served for this long.
  static const cacheTtl = Duration(hours: 24);

  /// Redemption log rows are kept for this long.
  static const redemptionRetention = Duration(days: 30);

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
    },
  );

  // ---------------------------------------------------------------- shops

  /// Stores list rows (keeps any detail already cached for the same shop).
  Future<void> upsertShopSummaries(
    List<ShopSummary> shops,
    DateTime now,
  ) async {
    await batch((b) {
      for (final shop in shops) {
        final summary = shop.copyWith(distanceM: null).toJson();
        b.insert(
          cachedShops,
          CachedShopsCompanion.insert(
            id: shop.id,
            slug: shop.slug,
            lat: shop.location.lat,
            lng: shop.location.lng,
            summaryJson: jsonEncode(summary),
            cachedAt: now,
          ),
          onConflict: DoUpdate(
            (old) => CachedShopsCompanion(
              slug: Value(shop.slug),
              lat: Value(shop.location.lat),
              lng: Value(shop.location.lng),
              summaryJson: Value(jsonEncode(summary)),
              cachedAt: Value(now),
            ),
          ),
        );
      }
    });
  }

  /// Fresh cached shops within [radiusM] of the point, nearest first, with
  /// the distance recomputed for this point.
  Future<List<ShopSummary>> shopsNear(
    double lat,
    double lng, {
    required int radiusM,
    required DateTime now,
    bool hasAvailable = false,
  }) async {
    final rows =
        await (select(cachedShops)..where(
              (t) => t.cachedAt.isBiggerThanValue(now.subtract(cacheTtl)),
            ))
            .get();
    final result = <ShopSummary>[];
    for (final row in rows) {
      final distance = distanceMeters(lat, lng, row.lat, row.lng).round();
      if (distance > radiusM) continue;
      final shop = ShopSummary.fromJson(
        jsonDecode(row.summaryJson) as Map<String, dynamic>,
      ).copyWith(distanceM: distance);
      if (hasAvailable && shop.availableCount <= 0) continue;
      result.add(shop);
    }
    result.sort((a, b) => a.distanceM!.compareTo(b.distanceM!));
    return result;
  }

  /// Stores a public detail and replaces its items.
  Future<void> upsertShopDetail(PublicShop shop, DateTime now) async {
    final detail = shop.copyWith(items: const []).toJson();
    final summary = ShopSummary(
      id: shop.id,
      slug: shop.slug,
      name: shop.name,
      type: shop.type,
      typeLabel: shop.typeLabel,
      address: shop.address,
      il: shop.il,
      ilce: shop.ilce,
      location: shop.location,
      isSample: shop.isSample,
      availableCount: shop.availableCount,
    );
    await transaction(() async {
      await into(cachedShops).insert(
        CachedShopsCompanion.insert(
          id: shop.id,
          slug: shop.slug,
          lat: shop.location.lat,
          lng: shop.location.lng,
          summaryJson: jsonEncode(summary.toJson()),
          detailJson: Value(jsonEncode(detail)),
          cachedAt: now,
        ),
        onConflict: DoUpdate(
          (old) => CachedShopsCompanion(
            slug: Value(shop.slug),
            lat: Value(shop.location.lat),
            lng: Value(shop.location.lng),
            summaryJson: Value(jsonEncode(summary.toJson())),
            detailJson: Value(jsonEncode(detail)),
            cachedAt: Value(now),
          ),
        ),
      );
      await (delete(cachedItems)..where((t) => t.shopId.equals(shop.id))).go();
      await batch((b) {
        b.insertAll(cachedItems, [
          for (final item in shop.items)
            CachedItemsCompanion.insert(
              id: item.id,
              shopId: shop.id,
              itemJson: jsonEncode(item.toJson()),
              cachedAt: now,
            ),
        ]);
      });
    });
  }

  /// The fresh cached public detail for [slug], items included.
  Future<PublicShop?> shopDetailBySlug(String slug, DateTime now) async {
    final row =
        await (select(cachedShops)..where(
              (t) =>
                  t.slug.equals(slug) &
                  t.cachedAt.isBiggerThanValue(now.subtract(cacheTtl)) &
                  t.detailJson.isNotNull(),
            ))
            .getSingleOrNull();
    if (row == null) return null;
    final items = await (select(
      cachedItems,
    )..where((t) => t.shopId.equals(row.id))).get();
    return PublicShop.fromJson(
      jsonDecode(row.detailJson!) as Map<String, dynamic>,
    ).copyWith(
      items: [
        for (final item in items)
          PublicItem.fromJson(
            jsonDecode(item.itemJson) as Map<String, dynamic>,
          ),
      ],
    );
  }

  // ---------------------------------------------------------- redemptions

  /// Adds rows from the server's redemption list (duplicates ignored).
  Future<void> logRedemptions(String shopId, List<Redemption> rows) async {
    await batch((b) {
      for (final row in rows) {
        b.insert(
          redemptionLog,
          RedemptionLogCompanion.insert(
            shopId: shopId,
            itemName: row.item.name,
            redeemedAt: row.redeemedAt,
            redeemedByRole: Value(row.redeemedByRole),
          ),
          mode: InsertMode.insertOrIgnore,
        );
      }
    });
  }

  /// Logged redemptions of [shopId] in `[from, to)`, newest first.
  Future<List<Redemption>> redemptionsBetween(
    String shopId,
    DateTime from,
    DateTime to,
  ) async {
    final rows =
        await (select(redemptionLog)
              ..where(
                (t) =>
                    t.shopId.equals(shopId) &
                    t.redeemedAt.isBiggerOrEqualValue(from) &
                    t.redeemedAt.isSmallerThanValue(to),
              )
              ..orderBy([(t) => OrderingTerm.desc(t.redeemedAt)]))
            .get();
    return [
      for (final row in rows)
        Redemption(
          item: NamedItem(name: row.itemName),
          redeemedAt: row.redeemedAt,
          redeemedByRole: row.redeemedByRole,
        ),
    ];
  }

  // ------------------------------------------------------------ retention

  /// Drops shop/item rows past the TTL and redemption rows past 30 days.
  Future<void> purgeExpired(DateTime now) async {
    final shopCutoff = now.subtract(cacheTtl);
    await transaction(() async {
      await (delete(
        cachedItems,
      )..where((t) => t.cachedAt.isSmallerOrEqualValue(shopCutoff))).go();
      final stale = selectOnly(cachedShops)
        ..addColumns([cachedShops.id])
        ..where(cachedShops.cachedAt.isSmallerOrEqualValue(shopCutoff));
      await (delete(cachedItems)..where((t) => t.shopId.isInQuery(stale))).go();
      await (delete(
        cachedShops,
      )..where((t) => t.cachedAt.isSmallerOrEqualValue(shopCutoff))).go();
      await (delete(redemptionLog)..where(
            (t) => t.redeemedAt.isSmallerThanValue(
              now.subtract(redemptionRetention),
            ),
          ))
          .go();
    });
  }

  /// Account or anon identity deleted: nothing stays on the device.
  Future<void> clearAll() async {
    await transaction(() async {
      await delete(cachedItems).go();
      await delete(cachedShops).go();
      await delete(redemptionLog).go();
    });
  }
}

/// Great-circle distance in metres (haversine).
double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
  const earthRadius = 6371000.0;
  double rad(double deg) => deg * math.pi / 180;
  final dLat = rad(lat2 - lat1);
  final dLng = rad(lng2 - lng1);
  final a =
      math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(rad(lat1)) *
          math.cos(rad(lat2)) *
          math.sin(dLng / 2) *
          math.sin(dLng / 2);
  return earthRadius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}
