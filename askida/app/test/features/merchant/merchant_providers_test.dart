import 'package:askida/core/platform/media_picker.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/merchant/domain/merchant_shop.dart';
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
    test('nobody signed in: no shop and no store read', () async {
      final h = MerchantHarness(session: const SessionState(restored: true));
      final c = h.container();
      expect(await c.read(merchantShopProvider.future), isNull);
      expect(h.shops.calls, isEmpty);
    });

    test('a donor never gets a merchant shop', () async {
      final h = MerchantHarness(session: donorSession);
      expect(await h.container().read(merchantShopProvider.future), isNull);
    });

    test('merchant without a linked shop', () async {
      final h = MerchantHarness(role: null);
      expect(await h.container().read(merchantShopProvider.future), isNull);
      expect(h.shops.calls, isEmpty);
    });

    test('owner: the owner shape with the verification state', () async {
      final h = MerchantHarness(state: VerificationState.verified);
      final shop = await h.container().read(merchantShopProvider.future);
      expect(shop!.role, MerchantRole.owner);
      expect(shop.verification, VerificationState.verified);
      expect(shop.offline, isFalse);
    });

    test('staff: the public shape means staff', () async {
      final h = MerchantHarness(role: MerchantRole.staff);
      final shop = await h.container().read(merchantShopProvider.future);
      expect(shop!.role, MerchantRole.staff);
      expect(shop.owner, isNull);
      expect(shop.verification, isNull);
    });

    test('a role change seen on the server updates the stored link', () async {
      // Stored as staff, but the server answers the owner shape.
      final h = MerchantHarness(role: MerchantRole.staff);
      h.shops.ownShop = ownerShop();
      final shop = await h.container().read(merchantShopProvider.future);
      expect(shop!.role, MerchantRole.owner);
      expect(h.store.links[merchantUser.id]!.role, MerchantRole.owner);
    });

    test('a closed shop or a removed member forgets the link', () async {
      for (final problem in [_notFound, _forbidden]) {
        final h = MerchantHarness()..shops.failNext('bySlug', problem);
        expect(await h.container().read(merchantShopProvider.future), isNull);
        expect(h.store.links, isEmpty);
      }
    });

    test('offline: the stored link keeps the dashboard working', () async {
      final h = MerchantHarness()..shops.failNext('bySlug', _offline);
      final shop = await h.container().read(merchantShopProvider.future);
      expect(shop!.offline, isTrue);
      expect(shop.role, MerchantRole.owner);
      expect(h.store.links, isNotEmpty);
    });

    test('other failures surface as errors', () async {
      final h = MerchantHarness()
        ..shops.failNext(
          'bySlug',
          const ApiProblem(code: 'server_error', status: 500),
        );
      final c = h.container();
      await expectLater(
        c.read(merchantShopProvider.future),
        throwsA(isA<ApiProblem>()),
      );
    });

    test('registered stores the link and publishes the shop', () async {
      final h = MerchantHarness(role: null);
      final c = h.container();
      expect(await c.read(merchantShopProvider.future), isNull);
      await c.read(merchantShopProvider.notifier).registered(ownerShop());
      expect(c.read(merchantShopProvider).value!.isOwner, isTrue);
      expect(h.store.links[merchantUser.id]!.slug, ownerShop().slug);
    });

    test('link as staff checks membership through the catalog', () async {
      final h = MerchantHarness(role: null);
      final c = h.container();
      await c.read(merchantShopProvider.future);
      final shop = await c
          .read(merchantShopProvider.notifier)
          .link('https://askida.app/dukkan/${ownerShop().slug}');
      expect(shop.role, MerchantRole.staff);
      expect(h.shops.calls, containsAllInOrder(['bySlug', 'items']));
      expect(h.store.links[merchantUser.id]!.role, MerchantRole.staff);
    });

    test('link to a shop the account is not a member of', () async {
      final h = MerchantHarness(role: null)
        ..shops.failNext('items', _forbidden);
      final c = h.container();
      await c.read(merchantShopProvider.future);
      await expectLater(
        c.read(merchantShopProvider.notifier).link(ownerShop().slug),
        throwsA(isA<NotShopMember>()),
      );
      expect(h.store.links, isEmpty);
    });

    test('link as owner needs no membership check', () async {
      final h = MerchantHarness(role: null)..shops.ownShop = ownerShop();
      final c = h.container();
      await c.read(merchantShopProvider.future);
      final shop = await c
          .read(merchantShopProvider.notifier)
          .link(ownerShop().slug);
      expect(shop.isOwner, isTrue);
      expect(h.shops.calls, isNot(contains('items')));
    });

    test('unlink forgets the shop on this device only', () async {
      final h = MerchantHarness();
      final c = h.container();
      await c.read(merchantShopProvider.future);
      await c.read(merchantShopProvider.notifier).unlink();
      expect(c.read(merchantShopProvider).value, isNull);
      expect(h.store.links, isEmpty);
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
      expect(h.shops.calls, ['bySlug']);
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
