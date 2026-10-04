import 'package:askida/core/time/clock.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/design/widgets/mode_switcher.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fakes/fake_auth_repository.dart';
import '../fakes/fake_shops_repository.dart';
import '../helpers/pump_app.dart';

class _Probe extends ConsumerWidget {
  const new();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = ref.watch(clockProvider)();
    return Text(
      '${Theme.of(context).brightness.name} '
      '${MediaQuery.textScalerOf(context).scale(10)} '
      '${now.toIso8601String()} ${context.l10n.modeDonor}',
    );
  }
}

void main() {
  testWidgets('pumpAskida: real app, light, Turkish, nobody signed in', (
    tester,
  ) async {
    final app = await tester.pumpAskida();
    expect(find.byType(ModeSwitcher), findsOneWidget);
    expect(app.location, '/recipient');
    final session = app.container.read(sessionProvider);
    expect(session.restored, isTrue);
    expect(session.isSignedIn, isFalse);
  });

  testWidgets('pumpAskida: dark, 1.3 text, 320 px, signed-in merchant', (
    tester,
  ) async {
    final app = await tester.pumpAskida(
      brightness: Brightness.dark,
      textScale: 1.3,
      size: const Size(320, 640),
      session: SessionState(
        user: FakeAuthRepository.sampleMerchant(),
        hasUserToken: true,
        restored: true,
      ),
    );
    expect(tester.takeException(), isNull);
    expect(
      Theme.of(tester.element(find.byType(ModeSwitcher))).brightness,
      Brightness.dark,
    );
    expect(app.container.read(sessionProvider).isMerchant, isTrue);
  });

  testWidgets('pumpScreen: theme, text scale, clock and overrides', (
    tester,
  ) async {
    final shops = FakeShopsRepository();
    final container = await tester.pumpScreen(
      const _Probe(),
      brightness: Brightness.dark,
      textScale: 1.3,
      now: DateTime(2026, 1, 2, 3, 4),
      overrides: [shopsRepositoryProvider.overrideWithValue(shops)],
    );

    expect(
      find.text('dark 13.0 2026-01-02T03:04:00.000 Askıya bırak'),
      findsOneWidget,
    );
    expect(container.read(shopsRepositoryProvider), same(shops));
  });
}
