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
  // The exact payloads the server builds today (title, body, data).
  final newHooks = PushMessage.fromPayload(const {
    'title': 'Yeni askı',
    'body': '3 ekmek askıya bırakıldı.',
    'data': {'item': 'ekmek', 'count': '3'},
  });
  final redeemed = PushMessage.fromPayload(const {
    'title': 'Askın alındı',
    'body': '[ÖRNEK] Köşe Fırını içindeki askından 1 ekmek alındı.',
    'data': {'item': 'ekmek', 'shop': '[ÖRNEK] Köşe Fırını'},
  });

  group('push routing model', () {
    test('merchant new hooks open the redemptions list', () {
      expect(pushKindOf(newHooks), PushKind.newHooks);
      expect(routeForPush(newHooks), '/merchant/redemptions');
    });

    test('donor collected unit opens the donations', () {
      expect(pushKindOf(redeemed), PushKind.redeemed);
      expect(routeForPush(redeemed), '/donor/donations');
    });

    test('an explicit type and donation id win', () {
      final message = PushMessage.fromPayload(const {
        'type': 'hook.redeemed',
        'donation_id': 'abc-1',
      });
      expect(message.data, {'type': 'hook.redeemed', 'donation_id': 'abc-1'});
      expect(routeForPush(message), '/donor/donation/abc-1');
      expect(
        routeForPush(const PushMessage(data: {'type': 'hooks.issued'})),
        '/merchant/redemptions',
      );
    });

    test('a hostile donation id is not used as a path', () {
      expect(
        routeForPush(
          const PushMessage(
            data: {'type': 'hook.redeemed', 'donation_id': '../../admin'},
          ),
        ),
        '/donor/donations',
      );
    });

    test('unknown pushes open nothing', () {
      expect(routeForPush(const PushMessage(title: 'Merhaba')), isNull);
      expect(routeForPush(PushMessage.fromPayload(const {})), isNull);
    });

    test('payloads carry no recipient data', () {
      for (final message in [newHooks, redeemed]) {
        expect(
          message.data.keys,
          everyElement(isIn(['item', 'count', 'shop'])),
        );
      }
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
            path: 'donations',
            builder: (context, state) => const Text('donations screen'),
          ),
      ],
      topLevelRoutes: const [],
    );
    addTearDown(router.dispose);
    final push = FakePushService();
    addTearDown(push.close);
    push.onMessage.listen((message) => openPush(router, message));
    await tester.pumpWidget(
      MaterialApp.router(
        theme: AskidaTheme.light(),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        locale: const Locale('tr', 'TR'),
        routerConfig: router,
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
    expect(find.text('donations screen'), findsOneWidget);
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
