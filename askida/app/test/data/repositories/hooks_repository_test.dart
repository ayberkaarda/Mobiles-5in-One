import 'package:askida/core/http/api_client.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/repositories/impl/dio_hooks_repository.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/fake_api.dart';
import '../../helpers/fixtures.dart';

void main() {
  const shopId = '0192a4c1-7000-7a10-9b3c-000000000001';
  const itemId = '0192a4c1-8000-7a10-9b3c-000000000011';

  test('reserve uses the anon token and reads the bare body', () async {
    final anon = dummyToken('anon');
    final api = FakeApi(userToken: dummyToken(), anonToken: anon);
    api.adapter.onPost(
      'hooks/reserve',
      (s) => s.reply(201, fixture('reservation')),
      data: {'shop_id': shopId, 'item_id': itemId},
    );

    final reservation = await DioHooksRepository(api.client)
        .reserve(shopId, itemId);

    expect(reservation.code, 'K7M2QX9R');
    expect(reservation.shop.id, shopId);
    expect(api.last.headers['Authorization'], 'Bearer $anon');
  });

  test('reserve caps surface as their own codes', () async {
    final api = FakeApi(anonToken: dummyToken('anon'))
      ..replyProblem('POST', 'hooks/reserve', 'problem_anon_daily_cap');
    await expectLater(
      DioHooksRepository(api.client).reserve(shopId, itemId),
      throwsA(
        isA<ApiProblem>()
            .having((p) => p.code, 'code', 'anon.daily_cap')
            .having((p) => p.status, 'status', 409),
      ),
    );
    expect(api.unauthenticated, isEmpty);
  });

  test('redeem uses the user token and returns the message', () async {
    final user = dummyToken();
    final api = FakeApi(userToken: user, anonToken: dummyToken('anon'));
    api.adapter.onPost(
      'shops/$shopId/redeem',
      (s) => s.reply(200, fixture('redeem_result')),
      data: {'code': 'k7m2-qx9r'},
    );

    final result = await DioHooksRepository(api.client)
        .redeem(shopId, 'k7m2-qx9r');

    expect(result.message, '1 ekmek verildi');
    expect(api.last.headers['Authorization'], 'Bearer $user');
  });

  test('redemptions passes the day and reads meta', () async {
    final api = FakeApi(userToken: dummyToken());
    api.adapter.onGet(
      'shops/$shopId/redemptions',
      (s) => s.reply(200, fixture('redemptions')),
      queryParameters: {'day': '2026-10-04'},
    );

    final day = await DioHooksRepository(api.client)
        .redemptions(shopId, day: DateTime(2026, 10, 4));

    expect(day.day, '2026-10-04');
    expect(day.count, 2);
    expect(day.redemptions.first.item.name, 'Ekmek');
  });

  test('redemptions without a day sends no day parameter', () async {
    final api = FakeApi(userToken: dummyToken());
    api.adapter.onGet(
      'shops/$shopId/redemptions',
      (s) => s.reply(200, fixture('redemptions')),
    );
    await DioHooksRepository(api.client).redemptions(shopId);
    expect(api.last.queryParameters, isEmpty);
    expect(api.last.extra[ApiClient.authScopeKey], AuthScope.user);
  });
}
