import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/core/push/push_message.dart';
import 'package:askida/core/push/push_service.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/data/session.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_router.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../fakes/fake_auth_repository.dart';
import '../fakes/fake_identity_provider.dart';
import '../fakes/fake_push_service.dart';

void main() {
  // The exact data the server sends (openapi `PushDataHooksIssued` and
  // `PushDataHookRedeemed` examples), with the notification title/body.
  const shopId = '0199b3c2-7a10-7c3e-9f41-2d5e8a6b1c90';
  const donationId = '0199b3c2-7a10-7c3e-9f41-2d5e8a6b1c91';
  final newHooks = PushMessage.fromPayload(const {
    'title': 'Yeni askı',
    'body': '2 Ekmek askıya bırakıldı.',
    'data': {
      'type': 'hooks.issued',
      'shop_id': shopId,
      'item': 'Ekmek',
      'count': '2',
    },
  });
  final redeemed = PushMessage.fromPayload(const {
    'title': 'Askın alındı',
    'body': 'Çınar Fırını içindeki askından 1 Ekmek alındı.',
    'data': {
      'type': 'hook.redeemed',
      'donation_id': donationId,
      'shop_id': shopId,
      'item': 'Ekmek',
      'shop': 'Çınar Fırını',
    },
  });

  group('push routing model', () {
    test('hooks.issued opens the merchant redemptions list', () {
      expect(pushKindOf(newHooks), PushKind.newHooks);
      expect(routeForPush(newHooks), '/merchant/redemptions');
    });

    test('hook.redeemed opens the donation', () {
      expect(pushKindOf(redeemed), PushKind.redeemed);
      expect(routeForPush(redeemed), '/donor/donation/$donationId');
    });

    test('a flat data map (data-only transport) routes the same', () {
      final message = PushMessage.fromPayload(const {
        'type': 'hook.redeemed',
        'donation_id': donationId,
        'shop_id': shopId,
        'item': 'Ekmek',
        'shop': 'Çınar Fırını',
      });
      expect(message.data['type'], 'hook.redeemed');
      expect(routeForPush(message), '/donor/donation/$donationId');
    });

    test('a missing or non-UUID donation id falls back to history', () {
      for (final id in [null, '../../admin', 'abc-1', '$donationId/x']) {
        expect(
          routeForPush(
            PushMessage(data: {'type': 'hook.redeemed', 'donation_id': ?id}),
          ),
          '/donor/donations',
          reason: '$id',
        );
      }
    });

    test('the type decides, not the title or other keys', () {
      // Shapes without `type` (an older server) open nothing.
      expect(
        routeForPush(
          const PushMessage(
            title: 'Yeni askı',
            data: {'item': 'Ekmek', 'count': '2'},
          ),
        ),
        isNull,
      );
      expect(
        routeForPush(
          const PushMessage(
            title: 'Askın alındı',
            data: {'item': 'Ekmek', 'shop': 'Çınar Fırını'},
          ),
        ),
        isNull,
      );
      expect(
        routeForPush(const PushMessage(data: {'type': 'hooks.unknown'})),
        isNull,
      );
    });

    test('unknown pushes open nothing', () {
      expect(routeForPush(const PushMessage(title: 'Merhaba')), isNull);
      expect(routeForPush(PushMessage.fromPayload(const {})), isNull);
    });

    test('payloads carry exactly the documented keys, no recipient data', () {
      expect(newHooks.data.keys.toSet(), {'type', 'shop_id', 'item', 'count'});
      expect(redeemed.data.keys.toSet(), {
        'type',
        'donation_id',
        'shop_id',
        'item',
        'shop',
      });
    });
  });

  testWidgets('tapping a push opens the right screen', (tester) async {
    var session = SessionState(
      user: FakeAuthRepository.sampleMerchant(),
      hasUserToken: true,
      restored: true,
    );
    final router = buildAppRouter(
      readSession: () => session,
      childRoutesFor: (mode) => [
        if (mode == AppMode.merchant)
          GoRoute(
            path: 'redemptions',
            builder: (context, state) => const Text('redemptions screen'),
          ),
        if (mode == AppMode.donor)
          GoRoute(
            path: 'donation/:id',
            builder: (context, state) =>
                Text('donation ${state.pathParameters['id']}'),
          ),
      ],
      topLevelRoutes: const [],
    );
    addTearDown(router.dispose);
    final push = FakePushService();
    addTearDown(push.close);
    push.onMessage.listen((message) => openPush(router, message));
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp.router(
          theme: AskidaTheme.light(),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: const Locale('tr', 'TR'),
          routerConfig: router,
        ),
      ),
    );

    push.deliver(newHooks);
    await tester.pumpAndSettle();
    expect(find.text('redemptions screen'), findsOneWidget);

    session = SessionState(
      user: FakeAuthRepository.sampleDonor(),
      hasUserToken: true,
      restored: true,
    );
    push.deliver(redeemed);
    await tester.pumpAndSettle();
    expect(find.text('donation $donationId'), findsOneWidget);
  });

  group('defaults of the platform seams', () {
    test('noop push: no token, no messages, registration skipped', () async {
      const push = NoopPushService();
      await push.init();
      expect(push.token, isNull);
      expect(await push.onMessage.isEmpty, isTrue);
    });

    test('providers default to noop push and unconfigured identity', () async {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(pushServiceProvider), isA<NoopPushService>());
      await expectLater(
        container.read(identityProviderProvider).signInWithGoogle(),
        throwsA(isA<IdentityUnavailable>()),
      );
    });

    test('fake push hands out the scripted token after init', () async {
      final push = FakePushService(nextToken: 'device-push-value');
      expect(push.token, isNull);
      await push.init();
      expect(push.token, 'device-push-value');
      await push.close();
    });

    test('fake identity answers credentials or the scripted failure', () async {
      final identity = FakeIdentityProvider();
      final credential = await identity.signInWithApple();
      expect(credential.provider, IdentityProviderKind.apple);
      expect(credential.rawNonce, isNotEmpty);
      identity.failure = const IdentityCancelled();
      await expectLater(
        identity.signInWithGoogle(),
        throwsA(isA<IdentityCancelled>()),
      );
    });
  });
}
