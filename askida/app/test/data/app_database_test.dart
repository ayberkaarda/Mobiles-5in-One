import 'package:askida/data/db/app_database.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/models/shop.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/fixtures.dart';
import '../helpers/test_database.dart';

void main() {
  late AppDatabase db;
  final now = DateTime.utc(2026, 10, 4, 9);
  final shops = fixtureList('shops_nearby').map(ShopSummary.fromJson).toList();
  final detail = PublicShop.fromJson(fixtureData('shop_public'));

  setUp(() => db = testDatabase());
  tearDown(() => db.close());

  test('cached shops are served near a point, distance recomputed', () async {
    await db.upsertShopSummaries(shops, now);

    // A point next to the Şişli shop; Kadıköy is ~9 km away.
    final near = await db.shopsNear(41.06, 28.99, radiusM: 3000, now: now);
    expect(near.map((s) => s.slug), ['ornek-kose-firini-sisli']);
    expect(near.single.distanceM, lessThan(300));

    final wide = await db.shopsNear(41.06, 28.99, radiusM: 20000, now: now);
    expect(wide.map((s) => s.slug), [
      'ornek-kose-firini-sisli',
      'ornek-mahalle-lokantasi-kadikoy',
    ]);
    final available = await db.shopsNear(
      41.06,
      28.99,
      radiusM: 20000,
      now: now,
      hasAvailable: true,
    );
    expect(available, hasLength(1));
  });

  test('rows older than 24 hours are not served and are purged', () async {
    await db.upsertShopSummaries(shops, now);
    await db.upsertShopDetail(detail, now);
    final later = now.add(AppDatabase.cacheTtl + const Duration(minutes: 1));

    expect(
      await db.shopsNear(41.06, 28.99, radiusM: 20000, now: later),
      isEmpty,
    );
    expect(await db.shopDetailBySlug(detail.slug, later), isNull);

    final justInside = now.add(
      AppDatabase.cacheTtl - const Duration(minutes: 1),
    );
    expect(await db.shopDetailBySlug(detail.slug, justInside), isNotNull);

    await db.purgeExpired(later);
    expect(await db.select(db.cachedShops).get(), isEmpty);
    expect(await db.select(db.cachedItems).get(), isEmpty);
  });

  test('a detail round-trips with its items', () async {
    await db.upsertShopDetail(detail, now);
    final cached = await db.shopDetailBySlug(detail.slug, now);
    expect(cached, isNotNull);
    expect(cached!.items.map((i) => i.id), detail.items.map((i) => i.id));
    expect(cached.availableCount, 12);

    // A refreshed detail with fewer items replaces the old ones.
    await db.upsertShopDetail(
      detail.copyWith(items: [detail.items.first]),
      now,
    );
    expect((await db.shopDetailBySlug(detail.slug, now))!.items, hasLength(1));
  });

  test('list refresh keeps an already cached detail', () async {
    await db.upsertShopDetail(detail, now);
    await db.upsertShopSummaries(shops, now);
    expect(await db.shopDetailBySlug(detail.slug, now), isNotNull);
  });

  test('redemption log dedupes, filters by day and keeps 30 days', () async {
    final rows = fixtureList('redemptions').map(Redemption.fromJson).toList();
    await db.logRedemptions('shop-1', rows);
    await db.logRedemptions('shop-1', rows);
    await db.logRedemptions('shop-2', rows.take(1).toList());

    final day = await db.redemptionsBetween(
      'shop-1',
      DateTime.utc(2026, 10, 3, 21),
      DateTime.utc(2026, 10, 4, 21),
    );
    expect(day, hasLength(2));
    expect(day.first.redeemedAt.isAfter(day.last.redeemedAt), isTrue);
    expect(day.first.redeemedByRole, 'owner');

    await db.purgeExpired(DateTime.utc(2026, 11, 4, 7));
    expect(await db.select(db.redemptionLog).get(), isEmpty);
  });

  test('clearAll empties every table', () async {
    await db.upsertShopSummaries(shops, now);
    await db.upsertShopDetail(detail, now);
    await db.logRedemptions(
      'shop-1',
      fixtureList('redemptions').map(Redemption.fromJson).toList(),
    );

    await db.clearAll();

    expect(await db.select(db.cachedShops).get(), isEmpty);
    expect(await db.select(db.cachedItems).get(), isEmpty);
    expect(await db.select(db.redemptionLog).get(), isEmpty);
  });

  test('distance helper', () {
    expect(distanceMeters(41, 29, 41, 29), 0);
    // One degree of latitude is about 111 km.
    expect(distanceMeters(40, 29, 41, 29), closeTo(111195, 50));
  });
}
