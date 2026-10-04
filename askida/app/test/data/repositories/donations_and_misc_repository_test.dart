import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/data/repositories/impl/dio_donations_repository.dart';
import 'package:askida/data/repositories/impl/dio_misc_repositories.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/fake_api.dart';
import '../../helpers/fixtures.dart';

void main() {
  const shopId = '0192a4c1-7000-7a10-9b3c-000000000001';
  const itemId = '0192a4c1-8000-7a10-9b3c-000000000011';

  group('donations', () {
    test('create sends only shop, item and quantity', () async {
      final api = FakeApi(userToken: dummyToken());
      api.adapter.onPost(
        'donations',
        (s) => s.reply(201, fixture('donation_checkout')),
        data: {'shop_id': shopId, 'item_id': itemId, 'qty': 3},
      );

      final checkout = await DioDonationsRepository(api.client)
          .create(shopId, itemId, 3);

      expect(checkout.donationId, endsWith('0031'));
      expect((api.last.data as Map).keys, ['shop_id', 'item_id', 'qty']);
    });

    test('create also reads a data-wrapped answer', () async {
      final api = FakeApi(userToken: dummyToken());
      api.adapter.onPost(
        'donations',
        (s) => s.reply(201, {'data': fixture('donation_checkout')}),
        data: {'shop_id': shopId, 'item_id': itemId, 'qty': 1},
      );
      final checkout = await DioDonationsRepository(api.client)
          .create(shopId, itemId, 1);
      expect(checkout.checkoutUrl, startsWith('https://askida.app/pay/'));
    });

    test('caps surface as their own codes', () async {
      final api = FakeApi(userToken: dummyToken());
      api.adapter.onPost(
        'donations',
        (s) => s.reply(
          422,
          '{"type":"https://askida.app/problems/donation.tx_cap_exceeded",'
          '"title":"x","status":422,"code":"donation.tx_cap_exceeded",'
          '"request_id":"req-cap-1"}',
          headers: FakeApi.problemHeaders(),
        ),
        data: {'shop_id': shopId, 'item_id': itemId, 'qty': 20},
      );
      await expectLater(
        DioDonationsRepository(api.client).create(shopId, itemId, 20),
        throwsA(
          isA<ApiProblem>().having(
            (p) => p.code,
            'code',
            'donation.tx_cap_exceeded',
          ),
        ),
      );
    });

    test('list and byId', () async {
      final api = FakeApi(userToken: dummyToken());
      api.adapter
        ..onGet('donations', (s) => s.reply(200, fixture('donations')))
        ..onGet(
          'donations/0192a4c1-a000-7a10-9b3c-000000000031',
          (s) => s.reply(200, fixture('donation')),
        );
      final repo = DioDonationsRepository(api.client);

      final page = await repo.list();
      expect(page.donations.single.status, DonationStatus.paid);
      expect(page.nextCursor, isNull);
      final donation = await repo.byId('0192a4c1-a000-7a10-9b3c-000000000031');
      expect(donation.qty, 3);
      // openapi `Donation` nests the shop and the item.
      expect(donation.shopId, '0192a4c1-7000-7a10-9b3c-000000000001');
      expect(donation.shopName, '[ÖRNEK] Köşe Fırını');
      expect(donation.itemId, '0192a4c1-8000-7a10-9b3c-000000000011');
      expect(donation.itemName, 'Ekmek');
      expect(page.donations.single.shopName, '[ÖRNEK] Köşe Fırını');
    });
  });

  test('payouts list', () async {
    final api = FakeApi(userToken: dummyToken());
    api.adapter.onGet(
      'shops/$shopId/payouts',
      (s) => s.reply(200, fixture('payouts')),
    );
    final rows = await DioPayoutsRepository(api.client).payouts(shopId);
    expect(rows, hasLength(2));
    expect(rows.first.commissionMinor, 2250);
  });

  test('impact is public and drops ilce without il', () async {
    final api = FakeApi(userToken: dummyToken());
    api.adapter
      ..onGet(
        'impact',
        (s) => s.reply(200, fixture('impact')),
        queryParameters: {'il': 'İstanbul', 'ilce': 'Şişli'},
      )
      ..onGet('impact', (s) => s.reply(200, fixture('impact')));
    final repo = DioImpactRepository(api.client);

    final summary = await repo.impact(il: 'İstanbul', ilce: 'Şişli');
    expect(summary.level, ImpactLevel.il);
    expect(api.last.headers.containsKey('Authorization'), isFalse);

    await repo.impact(ilce: 'Şişli');
    expect(api.last.queryParameters, isEmpty);
  });

  test('push token registration', () async {
    final api = FakeApi(userToken: dummyToken());
    final pushValue = dummyToken('push');
    api.adapter.onPut(
      'me/push-token',
      (s) => s.reply(204, null),
      data: {'platform': 'android', 'token': pushValue},
    );
    await DioPushRepository(api.client).registerToken('android', pushValue);
    expect(api.last.method, 'PUT');
  });
}
