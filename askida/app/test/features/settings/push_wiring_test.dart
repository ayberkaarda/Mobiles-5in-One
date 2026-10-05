import 'package:askida/core/push/push_message.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/settings/presentation/settings_controller.dart';
import 'package:askida/routing/app_router.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../fakes/fake_auth_repository.dart';
import '../../helpers/pump_app.dart';
import '../donor/donor_harness.dart';

/// A router with plain stand-ins for the screens push can open, so the
/// test sees exactly where a payload leads.
GoRouter _stubRouter() => GoRouter(
  initialLocation: '/recipient',
  routes: [
    for (final path in [
      '/recipient',
      '/donor',
      '/donor/donations',
      '/merchant',
      '/merchant/redemptions',
    ])
      GoRoute(path: path, builder: (_, _) => Text('at $path')),
    GoRoute(
      path: '/donor/donation/:id',
      builder: (_, state) => Text('at donation ${state.pathParameters['id']}'),
    ),
  ],
);

void main() {
  testWidgets('no transport: nothing is registered (Noop default)', (
    tester,
  ) async {
    final h = DonorHarness();
    final app = await tester.pumpAskida(
      overrides: h.overrides,
      session: DonorHarness.donorSession,
    );
    expect(h.push.inits, 1);
    expect(h.pushRepo.registered, isEmpty);
    expect(
      app.container.read(pushControllerProvider),
      PushRegistration.unavailable,
    );
  });

  testWidgets('a token is registered when an account signs in', (tester) async {
    final h = DonorHarness();
    final token = 'push-${DateTime.now().microsecondsSinceEpoch}';
    h.push.nextToken = token;
    final app = await tester.pumpAskida(overrides: h.overrides);
    expect(
      app.container.read(pushControllerProvider),
      PushRegistration.waitingForAccount,
    );
    expect(h.pushRepo.registered, isEmpty);

    app.container
        .read(sessionProvider.notifier)
        .signedIn(FakeAuthRepository.sampleDonor());
    await tester.pumpAndSettle();
    expect(h.pushRepo.registered, [('android', token)]);
    expect(
      app.container.read(pushControllerProvider),
      PushRegistration.registered,
    );

    // The same account is not registered twice.
    app.container
        .read(sessionProvider.notifier)
        .userUpdated(FakeAuthRepository.sampleDonor());
    await tester.pumpAndSettle();
    expect(h.pushRepo.registered, hasLength(1));
  });

  testWidgets('a failed registration is reported, not thrown', (tester) async {
    final h = DonorHarness();
    h.push.nextToken = 'push-${DateTime.now().microsecondsSinceEpoch}';
    h.pushRepo.failAlways(
      'registerToken',
      const ApiProblem(code: 'server_error', status: 500),
    );
    final app = await tester.pumpAskida(
      overrides: h.overrides,
      session: DonorHarness.donorSession,
    );
    expect(app.container.read(pushControllerProvider), PushRegistration.failed);
  });

  group('tapping a notification opens its screen', () {
    // Server data shapes (openapi `PushData`); ids are UUIDs.
    const shopId = '0199b3c2-7a10-7c3e-9f41-2d5e8a6b1c90';
    const donationId = '0199b3c2-7a10-7c3e-9f41-2d5e8a6b1c91';
    final cases = <String, (Map<String, Object?>, String)>{
      "merchant 'Yeni askı' (hooks.issued) -> redemptions": (
        {
          'title': 'Yeni askı',
          'body': '2 Ekmek askıya bırakıldı.',
          'data': {
            'type': 'hooks.issued',
            'shop_id': shopId,
            'item': 'Ekmek',
            'count': '2',
          },
        },
        'at /merchant/redemptions',
      ),
      "donor 'Askın alındı' (hook.redeemed) -> receipt": (
        {
          'title': 'Askın alındı',
          'body': 'Köşe Fırını içindeki askından 1 Ekmek alındı.',
          'data': {
            'type': 'hook.redeemed',
            'donation_id': donationId,
            'shop_id': shopId,
            'item': 'Ekmek',
            'shop': 'Köşe Fırını',
          },
        },
        'at donation $donationId',
      ),
      'donor payload with a broken donation id -> history': (
        {
          'data': {
            'type': 'hook.redeemed',
            'donation_id': 'abc-1',
            'shop_id': shopId,
            'item': 'Ekmek',
            'shop': 'Köşe Fırını',
          },
        },
        'at /donor/donations',
      ),
      'untyped payload -> stays': (
        {
          'title': 'Yeni askı',
          'data': {'item': 'Ekmek', 'count': '2'},
        },
        'at /recipient',
      ),
      'unknown payload -> stays': ({'title': 'Başka bir şey'}, 'at /recipient'),
    };
    for (final MapEntry(key: name, value: (payload, expected))
        in cases.entries) {
      testWidgets(name, (tester) async {
        final h = DonorHarness();
        final router = _stubRouter();
        addTearDown(router.dispose);
        await tester.pumpAskida(
          overrides: [
            ...h.overrides,
            appRouterProvider.overrideWithValue(router),
          ],
        );
        expect(find.text('at /recipient'), findsOneWidget);

        h.push.deliver(PushMessage.fromPayload(payload));
        await tester.pumpAndSettle();
        expect(find.text(expected), findsOneWidget);
        // No payload carries anything about who took the item.
        expect(find.textContaining('anon'), findsNothing);
      });
    }
  });
}
