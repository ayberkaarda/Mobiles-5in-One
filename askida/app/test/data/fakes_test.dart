import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/session.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fakes/fake_anon_repository.dart';
import '../fakes/fake_auth_repository.dart';
import '../fakes/fake_donations_repository.dart';
import '../fakes/fake_hooks_repository.dart';
import '../fakes/fake_misc_repositories.dart';
import '../fakes/fake_shops_repository.dart';

class _Sink extends NoopSessionSink {
  final events = <String>[];
  @override
  void anonStored() => events.add('anonStored');
  @override
  void anonCleared() => events.add('anonCleared');
}

void main() {
  const offline = ApiProblem(code: 'network.offline', status: 0);

  test('scripted failures fire once, then the fake answers again', () async {
    final shops = FakeShopsRepository()..failNext('nearby', offline);
    await expectLater(shops.nearby(41, 29), throwsA(offline));
    expect((await shops.nearby(41, 29)).shops, hasLength(2));
    expect(shops.callCount('nearby'), 2);
  });

  test('failAlways keeps failing until cleared', () async {
    final impact = FakeImpactRepository()..failAlways('impact', offline);
    await expectLater(impact.impact(), throwsA(offline));
    await expectLater(impact.impact(), throwsA(offline));
    impact.clearFailures();
    expect((await impact.impact()).shops, 12);
  });

  test('auth fake registers, signs in and rejects wrong passwords', () async {
    final auth = FakeAuthRepository();
    await auth.register(
      email: 'a@example.com',
      password: 'uzun-bir-sifre',
      name: 'A',
      kind: FakeAuthRepository.sampleMerchant().kind,
      deviceName: 'test',
      kvkkTextVersion: '2026-10',
    );
    expect(await auth.tokens.readUser(), isNotNull);
    await auth.logout();
    await expectLater(
      auth.login('a@example.com', 'yanlis', 'test'),
      throwsA(isA<ApiProblem>()),
    );
    final session = await auth.login('a@example.com', 'uzun-bir-sifre', 'x');
    expect(session.token, isNotEmpty);
  });

  test('anon fake stores and clears the token through the sink', () async {
    final sink = _Sink();
    final anon = FakeAnonRepository(session: sink);
    await anon.attest();
    expect(await anon.tokens.readAnon(), isNotNull);
    await anon.deleteMe();
    expect(await anon.tokens.readAnon(), isNull);
    expect(sink.events, ['anonStored', 'anonCleared']);
    expect(anon.erasures, 1);
  });

  test('hooks fake redeems a code once, normalising input', () async {
    final hooks = FakeHooksRepository();
    final result = await hooks.redeem('shop', 'k7m2-qx9r');
    expect(result.message, '1 ekmek verildi');
    await expectLater(
      hooks.redeem('shop', 'K7M2QX9R'),
      throwsA(
        isA<ApiProblem>().having((p) => p.code, 'code', 'hook.code_invalid'),
      ),
    );
    expect((await hooks.redemptions('shop')).count, 3);
  });

  test('shops fake covers onboarding and catalog', () async {
    final shops = FakeShopsRepository();
    final own = await shops.create(const ShopDraft(name: 'Fırın'));
    expect(await shops.bySlug(own.slug), isA<OwnerShopDetails>());
    await shops.createItem(own.id, const ItemDraft(name: 'Ekmek'));
    expect(await shops.items(own.id), hasLength(1));
  });

  test(
    'donations fake creates an initiated donation and marks it paid',
    () async {
      final donations = FakeDonationsRepository();
      final checkout = await donations.create('shop', 'item', 2);
      expect(checkout.checkoutUrl, startsWith('https://askida.app/pay/'));
      donations.markPaid(checkout.donationId);
      expect((await donations.byId(checkout.donationId)).paidAt, isNotNull);
    },
  );

  test('push fake records registrations', () async {
    final push = FakePushRepository();
    await push.registerToken('android', 'value');
    expect(push.registered, [('android', 'value')]);
  });
}
