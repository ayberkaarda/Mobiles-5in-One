import 'package:askida/core/platform/media_picker.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/merchant/domain/redemption_days.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_providers.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_media_picker.dart';
import '../../fakes/fake_shops_repository.dart';
import '../../helpers/test_database.dart';
import 'merchant_harness.dart';

const _offline = ApiProblem(code: ApiProblem.networkOffline, status: 0);
const _forbidden = ApiProblem(code: 'forbidden', status: 403);
const _notFound = ApiProblem(code: 'not_found', status: 404);

void main() {
  group('merchantShopProvider', () {
    test('nobody signed in: no shop and no server call', () async {
      final h = MerchantHarness(session: const SessionState(restored: true));
      final c = h.container();
      expect(await c.read(merchantShopProvider.future), isNull);
      expect(h.shops.calls, isEmpty);
    });

    test('a donor never gets a merchant shop', () async {
      final h = MerchantHarness(session: donorSession);
      expect(await h.container().read(merchantShopProvider.future), isNull);
      expect(h.shops.calls, isEmpty);
    });

    test('merchant who is not in any shop', () async {
      final h = MerchantHarness(role: null);
      expect(await h.container().read(merchantShopProvider.future), isNull);
      expect(h.shops.calls, ['myShops']);
    });

    test('owner: the listing, then the owner shape', () async {
      final h = MerchantHarness(state: VerificationState.verified);
      final shop = await h.container().read(merchantShopProvider.future);
      expect(shop!.role, ShopRole.owner);
      expect(shop.owner, isNotNull);
      expect(shop.verification, VerificationState.verified);
      expect(shop.offline, isFalse);
      expect(h.shops.calls, ['myShops', 'bySlug']);
    });

    test('staff: the role comes from the listing, no owner shape', () async {
      final h = MerchantHarness(role: ShopRole.staff);
      final shop = await h.container().read(merchantShopProvider.future);
      expect(shop!.role, ShopRole.staff);
      expect(shop.owner, isNull);
      expect(shop.id, ownerShop().id);
      expect(shop.verification, VerificationState.pending);
      expect(h.shops.calls, ['myShops']);
    });

    test('an owned shop wins over a staff membership', () async {
      final h = MerchantHarness();
      h.shops.staffShops = [
        myShopFor(ownerShop(), ShopRole.staff).copyWith(
          id: 'other-shop',
          slug: 'a-first-by-name',
          name: 'A Lokantası',
        ),
      ];
      final shop = await h.container().read(merchantShopProvider.future);
      expect(shop!.isOwner, isTrue);
      expect(shop.id, ownerShop().id);
    });

    test('a removed membership is gone on the next load', () async {
      final h = MerchantHarness(role: ShopRole.staff);
      final c = h.container();
      expect(await c.read(merchantShopProvider.future), isNotNull);
      h.shops.staffShops = [];
      await c.read(merchantShopProvider.notifier).reload();
      expect(c.read(merchantShopProvider).value, isNull);
    });

    test('offline owner shape: the listing keeps the dashboard', () async {
      final h = MerchantHarness()..shops.failNext('bySlug', _offline);
      final shop = await h.container().read(merchantShopProvider.future);
      expect(shop!.offline, isTrue);
      expect(shop.role, ShopRole.owner);
      expect(shop.name, ownerShop().name);
    });

    test('a failing listing surfaces as an error', () async {
      for (final problem in [_offline, _forbidden]) {
        final h = MerchantHarness()..shops.failNext('myShops', problem);
        await expectLater(
          h.container().read(merchantShopProvider.future),
          throwsA(isA<ApiProblem>()),
        );
      }
    });

    test('other owner shape failures surface as errors', () async {
      for (final problem in [
        _notFound,
        const ApiProblem(code: 'server_error', status: 500),
      ]) {
        final h = MerchantHarness()..shops.failNext('bySlug', problem);
        await expectLater(
          h.container().read(merchantShopProvider.future),
          throwsA(isA<ApiProblem>()),
        );
      }
    });

    test('registered publishes the new shop as its owner', () async {
      final h = MerchantHarness(role: null);
      final c = h.container();
      expect(await c.read(merchantShopProvider.future), isNull);
      await c.read(merchantShopProvider.notifier).registered(ownerShop());
      final shop = c.read(merchantShopProvider).value!;
      expect(shop.isOwner, isTrue);
      expect(shop.slug, ownerShop().slug);
      expect(shop.owner, ownerShop());
    });
  });

  group('catalog', () {
    test('loads, adds, edits and switches items', () async {
      final h = MerchantHarness();
      final c = h.container();
      final items = await c.read(catalogProvider.future);
      expect(items.map((i) => i.name), ['Ekmek', 'Simit']);

      final notifier = c.read(catalogProvider.notifier);
      await notifier.add(
        const ItemDraft(
          name: 'Mercimek çorbası',
          category: ItemCategory.corba,
          priceMinor: 4500,
          dailyCap: 20,
          active: true,
        ),
      );
      expect(c.read(catalogProvider).value, hasLength(3));

      final simit = items[1];
      await notifier.setActive(simit, active: true);
      expect(
        c
            .read(catalogProvider)
            .value!
            .firstWhere((i) => i.id == simit.id)
            .active,
        isTrue,
      );
      expect(h.shops.calls, containsAllInOrder(['createItem', 'updateItem']));
    });
  });

  group('redemption log', () {
    test('fetches the day, keeps it on the device, reads it back', () async {
      final db = testDatabase();
      addTearDown(db.close);
      final h = MerchantHarness();
      final c = h.container(database: db, now: DateTime(2026, 10, 4, 10));
      final day = LogDay.of(DateTime(2026, 10, 4));

      final view = await c.read(redemptionLogProvider(day).future);
      expect(view.offline, isFalse);
      expect(view.rows.map((r) => r.item.name), ['Ekmek', 'Mercimek çorbası']);
      expect(
        await db.redemptionsBetween(ownerShop().id, day.start, day.end),
        hasLength(2),
      );
    });

    test('offline: the device log is shown and marked', () async {
      final db = testDatabase();
      addTearDown(db.close);
      final h = MerchantHarness();
      final c = h.container(database: db, now: DateTime(2026, 10, 4, 10));
      final day = LogDay.of(DateTime(2026, 10, 4));
      await c.read(redemptionLogProvider(day).future);
      c.invalidate(redemptionLogProvider(day));
      h.hooks.failNext('redemptions', _offline);

      final view = await c.read(redemptionLogProvider(day).future);
      expect(view.offline, isTrue);
      expect(view.rows, hasLength(2));
    });

    test('staff may read the log; other failures are errors', () async {
      final db = testDatabase();
      addTearDown(db.close);
      final h = MerchantHarness()..hooks.failNext('redemptions', _forbidden);
      final c = h.container(database: db);
      await expectLater(
        c.read(redemptionLogProvider(LogDay.of(DateTime(2026, 10, 4))).future),
        throwsA(isA<ApiProblem>()),
      );
    });
  });

  test('payouts come newest day first', () async {
    final h = MerchantHarness();
    final rows = await h.container().read(payoutsProvider.future);
    expect(rows.map((p) => p.day), ['2026-10-04', '2026-10-03']);
  });

  group('redeem', () {
    test('a valid code: the item is handed over and logged', () async {
      final db = testDatabase();
      addTearDown(db.close);
      final h = MerchantHarness();
      final c = h.container(database: db);
      await c.read(merchantShopProvider.future);
      final sub = c.listen(redeemControllerProvider, (_, _) {});
      addTearDown(sub.close);

      await c
          .read(redeemControllerProvider.notifier)
          .submit(h.hooks.reservation.code.toLowerCase());

      final state = c.read(redeemControllerProvider);
      expect(state, isA<RedeemDone>());
      expect((state as RedeemDone).result.item.name, 'Ekmek');
      final logged = await db.redemptionsBetween(
        ownerShop().id,
        DateTime(2026),
        DateTime(2027),
      );
      expect(logged.single.redeemedByRole, 'owner');
    });

    test('input that cannot be a code never reaches the server', () async {
      final h = MerchantHarness();
      final c = h.container();
      await c.read(merchantShopProvider.future);
      final sub = c.listen(redeemControllerProvider, (_, _) {});
      addTearDown(sub.close);

      await c.read(redeemControllerProvider.notifier).submit('hello');

      final state = c.read(redeemControllerProvider);
      expect(state, isA<RedeemFailed>());
      expect((state as RedeemFailed).problem, isNull);
      expect(h.hooks.calls, isEmpty);
    });

    test(
      'a refused code shows the problem; a second scan is ignored',
      () async {
        final h = MerchantHarness();
        final c = h.container();
        await c.read(merchantShopProvider.future);
        final sub = c.listen(redeemControllerProvider, (_, _) {});
        addTearDown(sub.close);
        final notifier = c.read(redeemControllerProvider.notifier);

        await notifier.submit('ZZZZ ZZZZ');
        final failed = c.read(redeemControllerProvider) as RedeemFailed;
        expect(failed.problem!.code, 'hook.code_invalid');

        // Done: further scans of the same QR do nothing until reset.
        await notifier.submit(h.hooks.reservation.code);
        expect(c.read(redeemControllerProvider), isA<RedeemDone>());
        await notifier.submit(h.hooks.reservation.code);
        expect(h.hooks.callCount('redeem'), 2);

        notifier.reset();
        expect(c.read(redeemControllerProvider), isA<RedeemIdle>());
      },
    );
  });

  group('documents', () {
    test('pick -> presign -> PUT -> confirm', () async {
      final h = MerchantHarness()..picker.next = FakeMediaPicker.sampleJpeg();
      final c = h.container();
      await c.read(merchantShopProvider.future);
      final sub = c.listen(documentsControllerProvider, (_, _) {});
      addTearDown(sub.close);

      await c
          .read(documentsControllerProvider.notifier)
          .upload(DocumentKind.isletmeBelgesi, DocumentSource.camera);

      final state = c.read(documentsControllerProvider);
      expect(state.uploaded.single.kind, DocumentKind.isletmeBelgesi);
      expect(state.uploaded.single.state, DocumentState.uploaded);
      expect(h.shops.calls, [
        'myShops',
        'bySlug',
        'presignDocument',
        'uploadDocument',
        'confirmDocument',
      ]);
      expect(h.shops.uploads.values.single, 6);
      expect(h.picker.sources, [DocumentSource.camera]);
    });

    test('a closed picker changes nothing', () async {
      final h = MerchantHarness();
      final c = h.container();
      await c.read(merchantShopProvider.future);
      final sub = c.listen(documentsControllerProvider, (_, _) {});
      addTearDown(sub.close);
      await c
          .read(documentsControllerProvider.notifier)
          .upload(DocumentKind.vergiLevhasi, DocumentSource.gallery);
      expect(c.read(documentsControllerProvider).uploaded, isEmpty);
      expect(h.shops.calls, ['myShops', 'bySlug']);
    });

    test('unsupported files and server refusals are reported', () async {
      final h = MerchantHarness()
        ..picker.failure = const UnsupportedDocument('size');
      final c = h.container();
      await c.read(merchantShopProvider.future);
      final sub = c.listen(documentsControllerProvider, (_, _) {});
      addTearDown(sub.close);
      final notifier = c.read(documentsControllerProvider.notifier);

      await notifier.upload(DocumentKind.vergiLevhasi, DocumentSource.gallery);
      expect(c.read(documentsControllerProvider).failure, DocumentFailure.size);

      h.picker
        ..failure = null
        ..next = FakeMediaPicker.sampleJpeg();
      h.shops.failNext(
        'confirmDocument',
        const ApiProblem(code: 'unsupported_media_type', status: 415),
      );
      await notifier.upload(DocumentKind.vergiLevhasi, DocumentSource.gallery);
      final state = c.read(documentsControllerProvider);
      expect(state.problem!.code, 'unsupported_media_type');
      expect(state.busy, isFalse);
      expect(state.uploaded, isEmpty);
    });

    test('at most three documents per session', () async {
      final h = MerchantHarness()..picker.next = FakeMediaPicker.sampleJpeg();
      final c = h.container();
      await c.read(merchantShopProvider.future);
      final sub = c.listen(documentsControllerProvider, (_, _) {});
      addTearDown(sub.close);
      final notifier = c.read(documentsControllerProvider.notifier);
      for (var i = 0; i < 4; i++) {
        await notifier.upload(DocumentKind.vergiLevhasi, DocumentSource.camera);
      }
      final state = c.read(documentsControllerProvider);
      expect(state.uploaded, hasLength(3));
      expect(state.failure, DocumentFailure.limit);
      expect(h.shops.callCount('presignDocument'), 3);
    });
  });

  test('fixture sanity: owner and public shapes share the shop id', () {
    expect(
      FakeShopsRepository.samplePublicShop().id,
      FakeShopsRepository.sampleOwnerShop().id,
    );
  });
}
