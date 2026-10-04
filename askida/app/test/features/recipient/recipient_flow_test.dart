import 'package:askida/core/attest/attest_channel.dart';
import 'package:askida/core/attest/attestation_service.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/session.dart';
import 'package:askida/design/widgets/code_tag.dart';
import 'package:askida/features/recipient/presentation/code_screen.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../helpers/pump_app.dart';
import 'recipient_helpers.dart';

Finder byKey(String key) => find.byKey(ValueKey(key));

void main() {
  group('shop detail', () {
    testWidgets('counts only, no prices, take on available items', (
      tester,
    ) async {
      final fakes = RecipientFakes();
      await tester.pumpAskida(
        overrides: fakes.overrides,
        initialLocation: '/recipient/shop/$sampleSlug',
      );

      expect(byKey('recipient-shop'), findsOneWidget);
      expect(find.text('[ÖRNEK] Köşe Fırını'), findsWidgets);
      expect(find.text('ÖRNEK'), findsOneWidget);
      expect(find.text('Şişli, İstanbul'), findsOneWidget);
      expect(find.text('9 askıda'), findsOneWidget);
      expect(find.text('3 askıda'), findsOneWidget);
      expect(find.textContaining('₺'), findsNothing);
      expect(byKey('recipient-take-$breadItemId'), findsOneWidget);
    });

    testWidgets('an unknown shop shows the mapped message and retry', (
      tester,
    ) async {
      final fakes = RecipientFakes();
      await tester.pumpAskida(
        overrides: fakes.overrides,
        initialLocation: '/recipient/shop/olmayan-dukkan',
      );
      expect(find.text('Aradığın kayıt bulunamadı.'), findsOneWidget);
      expect(find.text('Yeniden dene'), findsOneWidget);
    });
  });

  group('take from the hook', () {
    testWidgets('no identity yet: attest, come back, reserve, show code', (
      tester,
    ) async {
      final fakes = RecipientFakes();
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        initialLocation: '/recipient/shop/$sampleSlug',
        size: const Size(400, 1400),
      );

      await tester.tap(byKey('recipient-take-$breadItemId'));
      await tester.pumpAndSettle();
      expect(app.location, startsWith('/recipient/start?from='));
      expect(find.text('Kod almadan önce'), findsOneWidget);

      await tester.tap(byKey('recipient-attest'));
      await tester.pumpAndSettle();
      expect(fakes.anon!.calls, ['attest']);
      expect(app.container.read(sessionProvider).hasAnonToken, isTrue);
      expect(app.location, '/recipient/reserve/$sampleSlug/$breadItemId');
      expect(find.text('1 Ekmek'), findsOneWidget);

      await tester.tap(byKey('recipient-reserve-confirm'));
      await tester.pumpAndSettle();
      expect(fakes.hooks.calls, ['reserve']);
      expect(app.location, '/recipient/code');
      expect(find.text('K7M2 QX9R'), findsOneWidget);
      expect(find.text('Kalan süre 10:00'), findsOneWidget);
      expect(find.text("09:51'e kadar"), findsOneWidget);
      expect(find.byType(QrPanel), findsOneWidget);

      // Screenshot-safe: no distance, no address, no identity.
      expect(find.text('450 m'), findsNothing);
      expect(find.textContaining('Halaskargazi'), findsNothing);
      final token = await app.tokens.readAnon();
      expect(find.textContaining(token!), findsNothing);
    });

    testWidgets('daily limit: calm mapped message, no code', (tester) async {
      final fakes = RecipientFakes()
        ..hooks.failNext(
          'reserve',
          const ApiProblem(code: 'anon.daily_cap', status: 429),
        );
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        session: anonSession,
        initialLocation: '/recipient/reserve/$sampleSlug/$breadItemId',
      );

      await tester.tap(byKey('recipient-reserve-confirm'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Bugün için alabileceğin kadarını aldın. Yarın yeniden bakabilirsin.',
        ),
        findsOneWidget,
      );
      expect(app.location, '/recipient/reserve/$sampleSlug/$breadItemId');
      expect(app.container.read(activeCodeProvider), isNull);
    });

    testWidgets('one valid code at a time', (tester) async {
      final fakes = RecipientFakes();
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        session: anonSession,
      );
      app.container
          .read(activeCodeProvider.notifier)
          .hold(sampleReservation(), shopSlug: sampleSlug);
      app.router.go('/recipient/reserve/$sampleSlug/$breadItemId');
      await tester.pumpAndSettle();

      expect(byKey('recipient-reserve-holding'), findsOneWidget);
      expect(byKey('recipient-reserve-confirm'), findsNothing);
      await tester.tap(find.text('Kodu göster'));
      await tester.pumpAndSettle();
      expect(app.location, '/recipient/code');
      expect(fakes.hooks.calls, isEmpty);
    });

    testWidgets('the list leads back to a valid code', (tester) async {
      final fakes = RecipientFakes();
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        session: anonSession,
      );
      app.container
          .read(activeCodeProvider.notifier)
          .hold(sampleReservation(), shopSlug: sampleSlug);
      await tester.tap(byKey('recipient-pick-district'));
      await tester.pumpAndSettle();
      await tester.tap(byKey('district-İstanbul-Şişli'));
      await tester.pumpAndSettle();

      expect(byKey('recipient-active-code'), findsOneWidget);
      await tester.tap(byKey('recipient-active-code-open'));
      await tester.pumpAndSettle();
      expect(app.location, '/recipient/code');
    });

    testWidgets('no code in memory: explains and leads to the shops', (
      tester,
    ) async {
      final fakes = RecipientFakes();
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        session: anonSession,
        initialLocation: '/recipient/code',
      );
      expect(byKey('recipient-no-code'), findsOneWidget);
      await tester.tap(find.text('Dükkânlara dön'));
      await tester.pumpAndSettle();
      expect(app.location, '/recipient');
    });
  });

  group('anonymous entry', () {
    testWidgets('prod flavor without attestation: blocking message', (
      tester,
    ) async {
      final fakes = RecipientFakes()
        ..configureAnon = (anon) => anon.failNext(
          'attest',
          const AttestationUnavailable(AttestFailure.unsupported),
        );
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        initialLocation: '/recipient/code',
      );
      expect(app.location, '/recipient/start?from=%2Frecipient%2Fcode');

      await tester.tap(byKey('recipient-attest'));
      await tester.pumpAndSettle();
      expect(byKey('recipient-attest-blocked'), findsOneWidget);
      expect(app.container.read(sessionProvider).hasAnonToken, isFalse);

      await tester.tap(find.text('Dükkânlara dön'));
      await tester.pumpAndSettle();
      expect(app.location, '/recipient');
    });

    testWidgets('server refusal: mapped message, stays on the entry', (
      tester,
    ) async {
      final fakes = RecipientFakes()
        ..configureAnon = (anon) => anon.failNext(
          'attest',
          const ApiProblem(code: 'rate_limited', status: 429),
        );
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        initialLocation: '/recipient/start',
      );

      await tester.tap(byKey('recipient-attest'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Kısa sürede çok fazla istek gönderildi. Biraz sonra yeniden dene.',
        ),
        findsOneWidget,
      );
      expect(app.location, '/recipient/start');
    });

    testWidgets('a foreign "from" never leaves recipient mode', (tester) async {
      final fakes = RecipientFakes();
      final app = await tester.pumpAskida(
        overrides: fakes.overrides,
        initialLocation: '/recipient/start?from=%2Fmerchant%2Fredemptions',
      );
      await tester.tap(byKey('recipient-attest'));
      await tester.pumpAndSettle();
      expect(app.location, '/recipient');
    });
  });

  group('code screen', () {
    Future<RecipientFakes> pumpCode(
      WidgetTester tester, {
      double textScale = 1,
      Size? size,
    }) async {
      final fakes = RecipientFakes();
      final container = await tester.pumpScreen(
        const CodeScreen(),
        overrides: fakes.overrides,
        textScale: textScale,
        size: size ?? const Size(360, 1100),
      );
      container
          .read(activeCodeProvider.notifier)
          .hold(sampleReservation(), shopSlug: sampleSlug);
      await tester.pumpAndSettle();
      return fakes;
    }

    testWidgets('"Kodu esnafa göster": full brightness, restored on close', (
      tester,
    ) async {
      final fakes = await pumpCode(tester);

      await tester.tap(find.text('Kodu esnafa göster'));
      await tester.pumpAndSettle();
      expect(byKey('recipient-full-brightness'), findsOneWidget);
      expect(byKey('recipient-full-code'), findsOneWidget);
      expect(fakes.brightness.calls, [true]);

      await tester.tap(byKey('recipient-full-close'));
      await tester.pumpAndSettle();
      expect(byKey('recipient-full-brightness'), findsNothing);
      expect(fakes.brightness.calls, [true, false]);
    });

    for (final (scale, width) in [(1.0, 360.0), (1.3, 360.0), (1.3, 320.0)]) {
      testWidgets('no overflow at text scale $scale, $width px', (
        tester,
      ) async {
        await pumpCode(tester, textScale: scale, size: Size(width, 700));
        expect(tester.takeException(), isNull);
        await tester.drag(byKey('recipient-code'), const Offset(0, -900));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Kodu esnafa göster'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  });
}
