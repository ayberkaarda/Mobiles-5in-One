import 'package:askida/data/db/app_database.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/repositories/impl/cached_shops_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fakes/fake_shops_repository.dart';
import '../helpers/test_database.dart';

void main() {
  const offline = ApiProblem(code: ApiProblem.networkOffline, status: 0);
  late AppDatabase db;
  late FakeShopsRepository remote;
  late DateTime now;
  late CachedShopsRepository repo;

  setUp(() {
    db = testDatabase();
    remote = FakeShopsRepository();
    now = DateTime.utc(2026, 10, 4, 9);
    repo = CachedShopsRepository(remote, db, clock: () => now);
  });
  tearDown(() => db.close());

  test('a network answer is returned and cached', () async {
    final page = await repo.nearby(41.06, 28.99, radiusM: 20000);
    expect(page.shops, hasLength(2));
    expect(await db.select(db.cachedShops).get(), hasLength(2));
  });

  test('offline, the cached list inside the TTL is served', () async {
    await repo.nearby(41.06, 28.99, radiusM: 20000);
    remote.failNext('nearby', offline);

    final page = await repo.nearby(41.06, 28.99, radiusM: 20000);

    expect(page.shops.map((s) => s.slug), [
      'ornek-kose-firini-sisli',
      'ornek-mahalle-lokantasi-kadikoy',
    ]);
    expect(page.nextCursor, isNull);
  });

  test('offline with an expired cache rethrows the problem', () async {
    await repo.nearby(41.06, 28.99, radiusM: 20000);
    now = now.add(const Duration(hours: 25));
    remote.failNext('nearby', offline);

    await expectLater(
      repo.nearby(41.06, 28.99, radiusM: 20000),
      throwsA(offline),
    );
  });

  test('a server refusal is never hidden by the cache', () async {
    await repo.nearby(41.06, 28.99, radiusM: 20000);
    const invalid = ApiProblem(code: 'validation.failed', status: 422);
    remote.failNext('nearby', invalid);
    await expectLater(
      repo.nearby(41.06, 28.99, radiusM: 20000),
      throwsA(invalid),
    );
  });

  test('watchNearby emits the cached list, then the fresh list', () async {
    await repo.nearby(41.06, 28.99, radiusM: 20000);
    remote.shops = [remote.shops.first.copyWith(availableCount: 30)];

    final pages = await repo.watchNearby(41.06, 28.99, radiusM: 20000).toList();

    expect(pages, hasLength(2));
    expect(pages.first.shops, hasLength(2));
    expect(pages.last.shops.single.availableCount, 30);
  });

  test('watchNearby with no cache and no network errors out', () async {
    remote.failNext('nearby', offline);
    await expectLater(
      repo.watchNearby(41.06, 28.99).toList(),
      throwsA(offline),
    );
  });

  test('watchNearby keeps the cached list when the refresh fails', () async {
    await repo.nearby(41.06, 28.99, radiusM: 20000);
    remote.failNext('nearby', offline);
    final pages = await repo.watchNearby(41.06, 28.99, radiusM: 20000).toList();
    expect(pages, hasLength(1));
  });

  test('a public detail is cached; offline it comes from the cache', () async {
    final slug = FakeShopsRepository.samplePublicShop().slug;
    await repo.bySlug(slug);
    remote.failNext('bySlug', offline);

    final cached = await repo.bySlug(slug);

    expect(cached, isA<PublicShopDetails>());
    expect((cached as PublicShopDetails).shop.items, hasLength(2));
  });

  test('the owner shape is never cached', () async {
    remote.ownShop = FakeShopsRepository.sampleOwnerShop().copyWith(
      slug: 'benim-dukkanim',
    );
    expect(await repo.bySlug('benim-dukkanim'), isA<OwnerShopDetails>());
    expect(await db.select(db.cachedShops).get(), isEmpty);
  });

  test('writes go straight to the network', () async {
    final shop = await repo.create(const ShopDraft(name: 'Fırın'));
    await repo.items(shop.id);
    expect(remote.calls, ['create', 'items']);
  });
}
